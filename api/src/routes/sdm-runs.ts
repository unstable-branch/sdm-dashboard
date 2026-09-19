import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob, getJobQueue } from "../services/queue.js";
import type { PlumberModelStatus } from "../services/plumber-sync.js";
import { db } from "../db/index.js";
import { runs, species } from "../db/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";
import { modelRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { jobEventBus } from "../services/job-events.js";
import { buildModelPayload, cleanupDecryptedFiles } from "../services/model-payload.js";
import { completedRunFields } from "../services/completed-run.js";

async function plumberJobId(runId: string): Promise<string> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error("Run not found");
  const pid = run.jobId;
  if (!pid) throw new Error("Run has no Plumber job ID");
  return pid;
}

function normalizeConfig(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== "object") return null;
  const normalized = { ...(config as Record<string, unknown>) };
  const rawExtent = normalized.projectionExtent ?? normalized.projection_extent;
  if (typeof rawExtent === "string") {
    normalized.projectionExtent = rawExtent.split(",").map(Number);
  }
  return normalized;
}

export const sdmRunRoutes = new Hono<AppEnv>();

sdmRunRoutes.use("/run", modelRateLimit);
sdmRunRoutes.use("/run", authMiddleware);
sdmRunRoutes.use("/cancel/*", authMiddleware);
sdmRunRoutes.use("/status/*", authMiddleware);
sdmRunRoutes.use("*", optionalAuth);

sdmRunRoutes.post("/run", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const parsed = modelConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const config = parsed.data;
    const async = body.async === true;
    const user = c.get("user");
    const projectId = await ensureDefaultProject(user);

    if (async) {
      let speciesId: string | undefined;
      const speciesName = config.species;

      try {
        let [sp] = await db.select().from(species).where(and(eq(species.name, speciesName), eq(species.projectId, projectId))).limit(1);
        if (!sp) {
          [sp] = await db
            .insert(species)
            .values({ name: speciesName, projectId, occurrenceCount: 0 })
            .returning();
        }
        speciesId = sp.id;
      } catch (err) {
        console.warn("[sdm] Species insert failed (best-effort):", err instanceof Error ? err.message : err);
      }

      let insertedRun: typeof runs.$inferSelect | null = null;
      let attempts = 0;
      const maxAttempts = 5;

      while (!insertedRun && attempts < maxAttempts) {
        attempts++;
        try {
          const [maxRun] = await db
            .select({ maxNum: sql<number>`COALESCE(MAX(run_number), 0)` })
            .from(runs)
            .where(eq(runs.projectId, projectId));

          insertedRun = (await db
            .insert(runs)
            .values({
              speciesId: speciesId ?? null,
              projectId,
              speciesName: speciesName ?? null,
              modelId: config.modelId,
              status: "queued",
              startedAt: new Date(),
              config,
              jobId: null,
              pipelineRunId: (config as Record<string, unknown>).pipelineRunId as string || null,
              runNumber: maxRun.maxNum + 1,
            })
            .returning())[0];
        } catch (err) {
          if (attempts < maxAttempts && err instanceof Error && err.message.includes("unique")) {
            await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
            continue;
          }
          throw err;
        }
      }

      if (!insertedRun) {
        throw new Error("Failed to create run after multiple attempts due to concurrent requests");
      }

      const jobId = await enqueueSdmJob(
        { type: "model", payload: { ...buildModelPayload(config, insertedRun.id), runId: insertedRun.id } },
        user.id,
      );

      await db
        .update(runs)
        .set({ bullmqId: jobId, status: "queued" })
        .where(eq(runs.id, insertedRun.id));

      jobEventBus.emitJobStatus({
        jobId: insertedRun.id,
        state: "queued",
        progress: 0,
        logs: ["Model run queued..."],
      });

      return c.json({ jobId: insertedRun.id, queuedAt: new Date().toISOString() });
    }

    const [maxRun] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(run_number), 0)` })
      .from(runs)
      .where(eq(runs.projectId, projectId));

    const [run] = await db
      .insert(runs)
      .values({
        modelId: config.modelId,
        projectId,
        speciesName: config.species ?? null,
        status: "running",
        startedAt: new Date(),
        config,
        pipelineRunId: (config as Record<string, unknown>).pipelineRunId as string || null,
        runNumber: maxRun.maxNum + 1,
      })
      .returning();

    const result = await plumberClient.runModel(buildModelPayload(config, run.id));

    const plumberJobId = (result as { job_id?: string }).job_id;

    if (plumberJobId) {
      await db
        .update(runs)
        .set({ jobId: plumberJobId, status: "running", startedAt: new Date() })
        .where(eq(runs.id, run.id));
    }

    jobEventBus.emitJobStatus({
      jobId: run.id,
      state: "running",
      progress: 0,
      logs: ["Model run started (sync)..."],
    });

    return c.json({
      runId: run.id,
      jobId: plumberJobId,
      status: "running",
      message: "Model run started. Track progress via /runs or SSE.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model run failed";
    console.error(`[sdm] Model run failed: ${message}`);
    const isBusy = message.includes("Server busy") || message.includes("too many runs") || message.includes("max concurrent");
    return c.json({ error: message }, isBusy ? 429 : 502);
  } finally {
    cleanupDecryptedFiles();
  }
});

sdmRunRoutes.get("/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ error: "Run not found" }, 404);
    }

    const [run] = await db
      .select({
        id: runs.id,
        status: runs.status,
        jobId: runs.jobId,
        speciesName: runs.speciesName,
        modelId: runs.modelId,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        lastStage: runs.lastStage,
        config: runs.config,
        error: runs.error,
        errorCode: runs.errorCode,
        errorHint: runs.errorHint,
        metrics: runs.metrics,
        outputFiles: runs.outputFiles,
        provenance: runs.provenance,
        progressLog: runs.progressLog,
      })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, jobId), inArray(runs.projectId, projectIds)) : eq(runs.id, jobId))
      .limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    let plumberProgressJson: unknown = null;
    let plumberProgressLog: string[] = [];
    let effectiveStatus = run.status;
    if (run.status === "running" && run.jobId) {
      try {
        const plumberStatus = await plumberClient.getModelStatus(run.jobId, 8000);
        const ps = plumberStatus as unknown as PlumberModelStatus;
        plumberProgressJson = ps.progress_json ?? null;
        plumberProgressLog = Array.isArray(ps.progress_log) ? ps.progress_log : [];

        const validStatuses = ["completed", "failed", "cancelled"];
        if (ps.status && validStatuses.includes(ps.status)) {
          const status = ps.status as "completed" | "failed" | "cancelled";
          await db.update(runs).set({
            status,
            metrics: status === "completed" ? (ps.metrics ?? {}) : {},
            outputFiles: status === "completed" ? (ps.output_files ?? {}) : {},
            error: ps.error ? String(ps.error) : null,
            errorCode: ps.error_code ? String(ps.error_code) : null,
            errorHint: ps.error_hint ? String(ps.error_hint) : null,
            progressLog: plumberProgressLog.length > 0 ? plumberProgressLog : undefined,
            completedAt: new Date(),
          }).where(and(eq(runs.id, jobId), inArray(runs.status, ["running", "queued"])));
          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: ps.status as string,
            progress: ps.status === "completed" ? 100 : 0,
            logs: plumberProgressLog,
            result: ps.status === "completed" ? plumberStatus : undefined,
            failedReason: ps.error as string | undefined,
          });
        }
      } catch (err) {
        console.warn(`[sdm-status] Plumber poll failed for job ${run.jobId}:`, err instanceof Error ? err.message : String(err));
      }
    } else if (run.status === "running" && !run.jobId && run.startedAt) {
      const orphanThreshold = 10 * 60 * 1000;
      if (Date.now() - run.startedAt.getTime() > orphanThreshold) {
        await db.update(runs)
          .set({
            status: "failed",
            error: "Model run did not start — worker was unable to connect to the model backend",
            errorCode: "WORKER_ORPHAN",
            completedAt: new Date(),
          })
          .where(eq(runs.id, jobId));
        jobEventBus.emitJobStatus({
          jobId: run.id,
          state: "failed",
          progress: 0,
          failedReason: "Model run did not start — worker was unable to connect to the model backend",
          error_code: "WORKER_ORPHAN",
        });
        effectiveStatus = "failed";
      }
    }

    const dbProgressLog: string[] = Array.isArray(run.progressLog) ? run.progressLog as string[] : [];

    return c.json({
      id: run.id,
      status: effectiveStatus,
      species: run.speciesName,
      model_id: run.modelId,
      started_at: run.startedAt?.toISOString() ?? null,
      completed_at: run.completedAt?.toISOString() ?? null,
      error: run.error ?? null,
      error_code: run.errorCode ?? null,
      error_hint: run.errorHint ?? null,
      last_stage: run.lastStage ?? null,
      metrics: run.metrics ?? null,
      output_files: run.outputFiles ?? null,
      progress_log: plumberProgressLog.length > 0 ? plumberProgressLog : dbProgressLog,
      progress_json: plumberProgressJson ?? null,
      config: normalizeConfig(run.config),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get status";
    return c.json({ error: message }, 502);
  }
});

sdmRunRoutes.post("/cancel/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ error: "Run not found" }, 404);
    }
    const [run] = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        bullmqId: runs.bullmqId,
        status: runs.status,
      })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, jobId), inArray(runs.projectId, projectIds)) : eq(runs.id, jobId))
      .limit(1);

    if (!run) return c.json({ error: "Run not found" }, 404);

    // Cancellation is idempotent. Returning the persisted terminal state also
    // prevents retries from turning a completed run into cancelled.
    if (run.status !== "queued" && run.status !== "running") {
      return c.json({
        ok: true,
        status: run.status,
        message: `Run is already ${run.status}`,
      });
    }

    const queue = getJobQueue();
    let backendResult: { ok: boolean; message: string; status?: string } | null = null;
    let backendStatus: Record<string, unknown> | null = null;
    if (run.jobId) {
      try {
        backendResult = await plumberClient.cancelModel(run.jobId);
      } catch (cancelErr) {
        // A completion can race the cancel request. Probe before surfacing an
        // error so authoritative completion is not lost.
        try {
          backendStatus = await plumberClient.getModelStatus(run.jobId);
        } catch {
          throw cancelErr;
        }
      }

      if (!backendStatus) {
        try {
          backendStatus = await plumberClient.getModelStatus(run.jobId);
        } catch {
          // The R endpoint returns its reconciled terminal status even when a
          // follow-up status probe is temporarily unavailable.
          backendStatus = backendResult?.status ? { status: backendResult.status } : null;
        }
      }

      if (backendStatus?.status === "completed") {
        const completed = await completedRunFields(plumberClient, run.jobId, backendStatus);
        await db.update(runs).set({
          status: "completed",
          completedAt: new Date(),
          error: null,
          errorCode: null,
          errorHint: null,
          metrics: completed.metrics,
          outputFiles: completed.outputFiles,
          provenance: completed.provenance,
        }).where(and(eq(runs.id, jobId), inArray(runs.status, ["queued", "running", "failed", "cancelled"])));
        jobEventBus.emitJobStatus({
          jobId: run.id,
          state: "completed",
          progress: 100,
          logs: Array.isArray(backendStatus.progress_log) ? backendStatus.progress_log as string[] : ["Model run completed before cancellation."],
          result: backendStatus,
        });
        return c.json({ ok: true, status: "completed", message: "Run completed before cancellation" });
      }

      if (backendStatus?.status === "failed") {
        const error = typeof backendStatus.error === "string" ? backendStatus.error : "Model run failed before cancellation";
        const failedRows = await db.update(runs).set({
          status: "failed",
          completedAt: new Date(),
          error,
          errorCode: typeof backendStatus.error_code === "string" ? backendStatus.error_code : null,
          errorHint: typeof backendStatus.error_hint === "string" ? backendStatus.error_hint : null,
        }).where(and(eq(runs.id, jobId), inArray(runs.status, ["queued", "running"])))
          .returning({ id: runs.id });
        if (failedRows.length > 0) {
          return c.json({ ok: true, status: "failed", message: error });
        }

        const [reconciled] = await db
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, jobId))
          .limit(1);
        return c.json({
          ok: true,
          status: reconciled?.status ?? "failed",
          message: reconciled ? `Run is already ${reconciled.status}` : error,
        });
      }
    }

    // Do not discard queue ownership until the backend cancel/reconciliation
    // succeeds. If Plumber is unreachable, returning an error while leaving the
    // run recoverable is safer than stranding a DB row with no queue owner.
    if (queue && run.bullmqId) {
      try {
        const bullJob = await queue.getJob(run.bullmqId);
        if (bullJob) {
          const state = await bullJob.getState();
          if (state === "active") await bullJob.discard();
          else if (state === "waiting" || state === "delayed" || state === "prioritized") await bullJob.remove();
        }
      } catch (err) {
        // The DB/Plumber state remains authoritative if BullMQ changes between
        // inspection and removal.
        console.warn(`[sdm-cancel] BullMQ cleanup raced for run ${run.id}:`, err instanceof Error ? err.message : err);
      }
    }

    const cancelledRows = await db
      .update(runs)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(runs.id, jobId), inArray(runs.status, ["queued", "running"])))
      .returning({ id: runs.id });

    if (cancelledRows.length > 0) {
      jobEventBus.emitJobStatus({
        jobId: run.id,
        state: "cancelled",
        progress: 0,
        logs: ["Model run cancelled by user."],
      });
      return c.json({ ...(backendResult ?? { ok: true, message: "Run cancelled" }), status: "cancelled" });
    }

    const [reconciled] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, jobId))
      .limit(1);
    return c.json({
      ok: true,
      status: reconciled?.status ?? "cancelled",
      message: reconciled ? `Run is already ${reconciled.status}` : "Run cancellation reconciled",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel";
    return c.json({ error: message }, 502);
  }
});

sdmRunRoutes.get("/compare/:runId1/:runId2", async (c) => {
  try {
    const runId1 = c.req.param("runId1");
    const runId2 = c.req.param("runId2");
    const jobId1 = await plumberJobId(runId1);
    const jobId2 = await plumberJobId(runId2);
    const data = await plumberClient.getRunComparison(jobId1, jobId2);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Comparison unavailable";
    return c.json({ error: message }, 502);
  }
});

sdmRunRoutes.get("/future/scenarios", async (c) => {
  try {
    const scenarios = await plumberClient.getFutureScenarios();
    return c.json(scenarios);
  } catch {
    return c.json({
      available_scenarios: [],
      gcm_choices: GCM_CHOICES,
      ssp_choices: SSP_CHOICES,
      period_choices: TIME_PERIOD_CHOICES,
      message: "Plumber unavailable; returning static constants",
    });
  }
});

sdmRunRoutes.get("/logs/:jobId", async (c) => {
  try {
    const runId = c.req.param("jobId");
    const user = c.get("user");
    const projectIds = user ? await getUserProjectIds(user) : null;
    if (projectIds && projectIds.length === 0) {
      return c.json({ error: "Run not found" }, 404);
    }

    const [run] = await db
      .select({ id: runs.id, jobId: runs.jobId, status: runs.status })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, runId), inArray(runs.projectId, projectIds)) : eq(runs.id, runId))
      .limit(1);

    if (!run) return c.json({ error: "Run not found" }, 404);
    if (!run.jobId) return c.json({ id: runId, stderr: "", stdout: "", progress_log: "" });

    const result = await plumberClient.getModelLogs(run.jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get logs";
    return c.json({ error: message }, 502);
  }
});

sdmRunRoutes.get("/gpu/status", async (c) => {
  try {
    const status = await plumberClient.getGpuStatus();
    return c.json(status);
  } catch {
    try {
      const viaNvsmi = await fetch(`${process.env.PLUMBER_URL || "http://localhost:8000"}/api/v1/gpu/status`, {
        headers: { "X-Hono-Internal": process.env.PLUMBER_INTERNAL_KEY || "" },
        signal: AbortSignal.timeout(5000),
      });
      if (viaNvsmi.ok) {
        const data = await viaNvsmi.json();
        return c.json({ ...data, proxied: true });
      }
    } catch { /* fall through */ }
    return c.json({ available: false, message: "GPU status unavailable" });
  }
});
