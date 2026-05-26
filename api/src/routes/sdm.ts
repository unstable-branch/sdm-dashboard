import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob, getJobQueue } from "../services/queue.js";
import { db } from "../db/index.js";
import { runs, species } from "../db/schema.js";
import { eq, desc, count, and, inArray, sql } from "drizzle-orm";
import { GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";
import { modelRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { join } from "path";

type ModelConfigRecord = Record<string, unknown> & {
  species?: string;
  modelId?: string;
  cleanedFilePath?: string;
  occurrenceFile?: string;
  biovars?: number[];
  projectionExtent?: number[];
  backgroundN?: number;
  cvFolds?: number;
};

function buildModelPayload(config: ModelConfigRecord, runId: string): Record<string, unknown> {
  const { biovars, projectionExtent, ...rest } = config;
  return {
    ...rest,
    species: config.species,
    model_id: config.modelId,
    occurrence_file: config.cleanedFilePath || config.occurrenceFile,
    cleaned_file_id: config.cleanedFilePath || null,
    biovars: Array.isArray(config.biovars) ? config.biovars.join(",") : "",
    projection_extent: Array.isArray(config.projectionExtent) ? config.projectionExtent.join(",") : "",
    output_dir: join("outputs", "jobs", runId),
  };
}
import type { AppEnv } from "../middleware/auth.js";

export const sdmRoutes = new Hono<AppEnv>();

sdmRoutes.use("/run", modelRateLimit);
sdmRoutes.use("/run", authMiddleware);
sdmRoutes.use("/batch", modelRateLimit);
sdmRoutes.use("/batch", authMiddleware);
sdmRoutes.use("/cancel/*", authMiddleware);
sdmRoutes.use("/cancel-all", authMiddleware);
sdmRoutes.use("/runs", authMiddleware);
sdmRoutes.use("/runs/delete/*", authMiddleware);
sdmRoutes.use("/runs/clear-all", authMiddleware);
sdmRoutes.use("/status/*", authMiddleware);
sdmRoutes.use("*", optionalAuth);

sdmRoutes.post("/run", async (c) => {
  try {
    const body = await c.req.json();
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
      } catch {
        // Species tracking is best-effort; continue without it
      }

      const [maxRun] = await db
        .select({ maxNum: sql<number>`COALESCE(MAX(run_number), 0)` })
        .from(runs)
        .where(eq(runs.projectId, projectId));

      const [run] = await db
        .insert(runs)
        .values({
          speciesId: speciesId ?? null,
          projectId,
          speciesName: speciesName ?? null,
          modelId: config.modelId,
          status: "queued",
          config: config as any,
          jobId: null,
          pipelineRunId: (config as any).pipelineRunId || null,
          runNumber: maxRun.maxNum + 1,
        })
        .returning();

      const jobId = await enqueueSdmJob(
        {
          type: "model",
          payload: buildModelPayload(config as unknown as ModelConfigRecord, run.id),
        }, user.id);

      if (jobId) {
        await db
          .update(runs)
          .set({ jobId })
          .where(eq(runs.id, run.id));
      }

      return c.json({ jobId: run.id, queuedAt: new Date().toISOString() });
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
        config: config as any,
        pipelineRunId: (config as any).pipelineRunId || null,
        runNumber: maxRun.maxNum + 1,
      })
      .returning();

    const result = await plumberClient.runModel(buildModelPayload(config as unknown as ModelConfigRecord, run.id));

    const plumberJobId = (result as any).job_id;

    if (plumberJobId) {
      await db
        .update(runs)
        .set({ jobId: plumberJobId, status: "running", startedAt: new Date() })
        .where(eq(runs.id, run.id));
    }

    // Fire-and-forget: plumber-sync polls Plumber and updates DB + SSE
    return c.json({
      runId: run.id,
      jobId: plumberJobId,
      status: "running",
      message: "Model run started. Track progress via /runs or SSE.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model run failed";
    console.error(`[sdm] Model run failed: ${message}`);
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.get("/models", async (c) => {
  try {
    const models = await plumberClient.getModels();
    return c.json(models);
  } catch {
    return c.json([
      { id: "glm", label: "GLM / Logistic regression", maturity: "stable", available: true },
      { id: "gam", label: "GAM / Smooth response curves", maturity: "stable", available: true },
      { id: "rangebag", label: "Rangebagging", maturity: "experimental", available: true },
      { id: "ensemble_glm_rangebag", label: "Ensemble (GLM + Rangebagging)", maturity: "experimental", available: true },
      { id: "multi_ensemble", label: "Multi-Model Ensemble", maturity: "experimental", available: true },
      { id: "maxnet", label: "MaxEnt (maxnet)", maturity: "stable", available: false, notes: "Requires maxnet package" },
      { id: "rf", label: "Random Forest (ranger)", maturity: "experimental", available: false, notes: "Requires ranger package" },
      { id: "xgboost", label: "BRT / XGBoost", maturity: "experimental", available: false, notes: "Requires xgboost package" },
      { id: "esm_glm", label: "ESM — GLM (rare species)", maturity: "experimental", available: false, notes: "Requires ecospat + biomod2 packages" },
      { id: "esm_maxnet", label: "ESM — MaxEnt (rare species)", maturity: "experimental", available: false, notes: "Requires ecospat + biomod2 + maxnet packages" },
      { id: "biomod2", label: "biomod2 (multi-algorithm)", maturity: "experimental", available: false, notes: "Requires biomod2 package + sdm.enable_biomod2 option" },
      { id: "dnn", label: "DNN (cito/torch)", maturity: "experimental", available: false, notes: "Requires cito + torch packages" },
    ]);
  }
});

sdmRoutes.get("/config/defaults", async (c) => {
  try {
    const defaults = await plumberClient.getConfigDefaults();
    return c.json(defaults);
  } catch {
    return c.json({
      biovars: [1, 4, 6, 12, 15, 18],
      backgroundN: 10000,
      cvFolds: 3,
      cvStrategy: "random",
      threshold: 0.5,
      nCores: 1,
      seed: 42,
      extentPresets: {
        aus_full: [112, 154, -44, -10],
        aus_north: [112, 154, -26, -10],
        aus_east: [138, 154, -44, -10],
        world: [-180, 180, -90, 90],
      },
    });
  }
});

sdmRoutes.get("/runs", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1", 10);
    const limitVal = parseInt(c.req.query("limit") || "20", 10);
    const statusFilter = c.req.query("status");
    const fields = c.req.query("fields");
    const offset = (page - 1) * limitVal;
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);

    const conditions = [];
    if (projectIds && projectIds.length === 0) {
      return c.json({
        runs: [],
        pagination: { page, limit: limitVal, total: 0, totalPages: 0 },
      });
    }
    if (projectIds) {
      conditions.push(inArray(runs.projectId, projectIds));
    }

    // DB-side status filtering
    if (statusFilter === "active") {
      conditions.push(inArray(runs.status, ["queued", "running"]));
    } else if (statusFilter && ["queued", "running", "completed", "failed", "cancelled"].includes(statusFilter)) {
      conditions.push(eq(runs.status, statusFilter as "queued" | "running" | "completed" | "failed" | "cancelled"));
    }

    const isSummary = fields === "summary";

    // Parallelize data + count queries (same WHERE clause)
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [allRuns, [{ total }]] = await Promise.all([
      db
        .select({
          id: runs.id,
          species: runs.speciesName,
          model_id: runs.modelId,
          status: runs.status,
          started_at: runs.startedAt,
          completed_at: runs.completedAt,
          metrics: runs.metrics,
          outputFiles: runs.outputFiles,
          error: runs.error,
        })
        .from(runs)
        .where(whereClause)
        .orderBy(desc(runs.createdAt))
        .limit(limitVal)
        .offset(offset),
      db
        .select({ total: count() })
        .from(runs)
        .where(whereClause),
    ]);

    const formatted = allRuns.map((r) => ({
      id: r.id,
      species: r.species ?? null,
      model_id: r.model_id ?? null,
      status: r.status ?? "queued",
      started_at: r.started_at,
      completed_at: r.completed_at,
      ...(!isSummary ? {
        metrics: r.metrics ?? null,
        output_files: r.outputFiles ?? null,
      } : {}),
      error: r.error ?? null,
    }));

    return c.json({
      runs: formatted,
      pagination: {
        page,
        limit: limitVal,
        total,
        totalPages: Math.ceil(total / limitVal),
      },
    });
  } catch (err) {
    console.error("[sdm-runs] Failed to fetch runs:", err);
    return c.json({
      runs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      warning: "Database unavailable — run history is temporarily inaccessible",
    }, 200);
  }
});

sdmRoutes.get("/status/:jobId", async (c) => {
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
        config: runs.config,
        error: runs.error,
        metrics: runs.metrics,
        outputFiles: runs.outputFiles,
        provenance: runs.provenance,
      })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, jobId), inArray(runs.projectId, projectIds)) : eq(runs.id, jobId))
      .limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const errCode = run.provenance && typeof run.provenance === "object" && "error_code" in (run.provenance as object)
      ? (run.provenance as Record<string, unknown>).error_code as string
      : undefined;
    const errHint = run.provenance && typeof run.provenance === "object" && "error_hint" in (run.provenance as object)
      ? (run.provenance as Record<string, unknown>).error_hint as string
      : undefined;

    if (run.status === "running" && run.jobId) {
      try {
        const plumberStatus = await plumberClient.getModelStatus(run.jobId);

        const plumberRunStatus = (plumberStatus as any).status;
        const plumberMetrics = (plumberStatus as any).metrics;
        const plumberOutputFiles = (plumberStatus as any).output_files;
        const plumberError = (plumberStatus as any).error;

        if (plumberRunStatus === "completed" || plumberRunStatus === "failed" || plumberRunStatus === "cancelled") {
          await db
            .update(runs)
            .set({
              status: plumberRunStatus as any,
              metrics: plumberRunStatus === "completed" ? plumberMetrics ?? null : null,
              outputFiles: plumberRunStatus === "completed" ? plumberOutputFiles ?? null : null,
              error: plumberError ?? null,
              completedAt: plumberRunStatus !== "running" ? new Date() : null,
              rCpuTimeMs: (plumberStatus as any).r_cpu_time_ms ?? null,
              rPeakMemoryMb: (plumberStatus as any).r_peak_memory_mb ?? null,
            })
            .where(eq(runs.id, jobId));

          return c.json({
            id: run.id,
            status: plumberRunStatus,
            species: run.speciesName,
            model_id: run.modelId,
            started_at: run.startedAt?.toISOString() ?? null,
            completed_at: plumberStatus && (plumberStatus as any).completed_at,
            error: plumberError ?? null,
            metrics: plumberMetrics ?? null,
            output_files: plumberOutputFiles ?? null,
            r_cpu_time_ms: (plumberStatus as any).r_cpu_time_ms ?? null,
            r_peak_memory_mb: (plumberStatus as any).r_peak_memory_mb ?? null,
            progress_log: Array.isArray((plumberStatus as any).progress_log) ? (plumberStatus as any).progress_log : [],
            config: run.config,
          });
        }

        return c.json({
          id: run.id,
          status: run.status,
          species: run.speciesName,
          model_id: run.modelId,
          started_at: run.startedAt?.toISOString() ?? null,
          completed_at: run.completedAt?.toISOString() ?? null,
          error: null,
          metrics: null,
          output_files: null,
          progress_log: Array.isArray((plumberStatus as any).progress_log) ? (plumberStatus as any).progress_log : [],
          config: run.config,
        });
      } catch {
        return c.json({
          id: run.id,
          status: run.status,
          species: run.speciesName,
          model_id: run.modelId,
          started_at: run.startedAt?.toISOString() ?? null,
          completed_at: run.completedAt?.toISOString() ?? null,
          error: null,
          metrics: null,
          output_files: null,
          progress_log: [],
          config: run.config,
        });
      }
    }

    return c.json({
      id: run.id,
      status: run.status,
      species: run.speciesName,
      model_id: run.modelId,
      started_at: run.startedAt?.toISOString() ?? null,
      completed_at: run.completedAt?.toISOString() ?? null,
      error: run.error ?? null,
      error_code: errCode ?? null,
      error_hint: errHint ?? null,
      metrics: run.metrics ?? null,
      output_files: run.outputFiles ?? null,
      progress_log: [],
      config: run.config,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get status";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.post("/cancel/:jobId", async (c) => {
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
        status: runs.status,
      })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, jobId), inArray(runs.projectId, projectIds)) : eq(runs.id, jobId))
      .limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const queue = getJobQueue();
    if (queue && run.jobId) {
      const bullJob = await queue.getJob(run.jobId);
      if (bullJob) {
        const state = await bullJob.getState();
        if (state === "active" || state === "waiting" || state === "delayed") {
          await bullJob.remove();
        }
      }
    }

    if (run.jobId) {
      const result = await plumberClient.cancelModel(run.jobId);
      await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, jobId));
      return c.json(result);
    }

    await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, jobId));
    return c.json({ ok: true, message: "Run cancelled" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.post("/cancel-all", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const statusFilter = (body.status as string) || "active";

    const statusValues = statusFilter === "active"
      ? ["queued", "running"]
      : [statusFilter];
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ ok: true, message: "No runs to cancel", cancelled: 0 });
    }

    const allRuns = await db
      .select({ id: runs.id, jobId: runs.jobId, status: runs.status })
      .from(runs)
      .where(and(
        inArray(runs.status, statusValues as any),
        projectIds ? inArray(runs.projectId, projectIds) : undefined,
      ));

    if (allRuns.length === 0) {
      return c.json({ ok: true, message: "No runs to cancel", cancelled: 0 });
    }

    const queue = getJobQueue();
    let cancelled = 0;

    for (const run of allRuns) {
      try {
        if (queue && run.jobId) {
          const bullJob = await queue.getJob(run.jobId);
          if (bullJob) {
            const state = await bullJob.getState();
            if (state === "active" || state === "waiting" || state === "delayed") {
              await bullJob.remove();
            }
          }
        }

        if (run.jobId) {
          await plumberClient.cancelModel(run.jobId).catch(() => {});
        }

        await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, run.id));
        cancelled++;
      } catch {
        // Continue with other runs even if one fails
      }
    }

    return c.json({ ok: true, message: `Cancelled ${cancelled}/${allRuns.length} runs`, cancelled, total: allRuns.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel runs";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.delete("/runs/delete/:runId", async (c) => {
  try {
    const runId = c.req.param("runId");
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
      })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, runId), inArray(runs.projectId, projectIds)) : eq(runs.id, runId))
      .limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    if (run.status === "running" || run.status === "queued") {
      return c.json({ error: "Cannot delete a running or queued run. Cancel it first." }, 400);
    }

    // Delegate filesystem deletion to Plumber (owns the output directory)
    if (run.jobId) {
      await plumberClient.deleteModelOutputs(run.jobId).catch(() => {});
    }

    await db.delete(runs).where(eq(runs.id, runId));

    return c.json({ ok: true, message: "Run deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete run";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.post("/runs/clear-all", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const includeCompleted = body.includeCompleted !== false;
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ ok: true, cleared: 0, directoriesDeleted: 0, message: "Cleared 0 runs" });
    }

    const statusesToDelete = ["failed", "cancelled"];
    if (includeCompleted) statusesToDelete.push("completed");

    const runsToDelete = await db
      .select({ id: runs.id, jobId: runs.jobId })
      .from(runs)
      .where(projectIds ? and(inArray(runs.status, statusesToDelete as any), inArray(runs.projectId, projectIds)) : inArray(runs.status, statusesToDelete as any));

    let deletedCount = 0;

    for (const run of runsToDelete) {
      // Delegate filesystem deletion to Plumber
      if (run.jobId) {
        await plumberClient.deleteModelOutputs(run.jobId).catch(() => {});
      }
      deletedCount++;
    }

    if (runsToDelete.length > 0) {
      await db.delete(runs).where(inArray(runs.id, runsToDelete.map((r) => r.id)));
    }

    return c.json({
      ok: true,
      cleared: runsToDelete.length,
      directoriesDeleted: deletedCount,
      message: `Cleared ${runsToDelete.length} runs`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clear runs";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.post("/batch", async (c) => {
  try {
    const body = await c.req.json();
    const { configs } = body;
    const user = c.get("user");
    const projectId = await ensureDefaultProject(user);

    if (!Array.isArray(configs) || configs.length === 0) {
      return c.json({ error: "configs must be a non-empty array" }, 400);
    }

    if (configs.length > 50) {
      return c.json({ error: "Batch limited to 50 configs per request" }, 400);
    }

    const jobIds: string[] = [];

    for (const config of configs) {
      const parsed = modelConfigSchema.safeParse(config);
      if (!parsed.success) {
        return c.json({ error: `Invalid config: ${parsed.error.message}` }, 400);
      }

      const [run] = await db
        .insert(runs)
        .values({
          speciesName: parsed.data.species,
          projectId,
          modelId: parsed.data.modelId,
          status: "queued",
          config: parsed.data as any,
          pipelineRunId: (parsed.data as any).pipelineRunId || null,
        })
        .returning();

      const queuedJobId = await enqueueSdmJob(
        {
          type: "model",
          payload: buildModelPayload(parsed.data as unknown as ModelConfigRecord, run.id),
        },
        user.id,
      );

      if (queuedJobId) {
        await db
          .update(runs)
          .set({ jobId: queuedJobId })
          .where(eq(runs.id, run.id));
      }

      jobIds.push(run.id);
    }

    return c.json({
      batch_id: `batch-${Date.now()}`,
      job_ids: jobIds,
      total: jobIds.length,
      message: `Batch of ${jobIds.length} runs started via queue`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch run failed";
    return c.json({ error: message }, 500);
  }
});

sdmRoutes.get("/future/scenarios", async (c) => {
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
