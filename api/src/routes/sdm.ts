import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob, getJobQueue } from "../services/queue.js";
import { db } from "../db/index.js";
import { runs, species, batches, projects, users } from "../db/schema.js";
import { eq, desc, count, and, inArray, sql } from "drizzle-orm";
import { GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";
import { modelRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { jobEventBus } from "../services/job-events.js";
import { buildModelPayload, cleanupDecryptedFiles, type ModelConfigRecord } from "../services/model-payload.js";

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
          startedAt: new Date(),
          config: config as any,
          jobId: null,
          pipelineRunId: (config as any).pipelineRunId || null,
          runNumber: maxRun.maxNum + 1,
        })
        .returning();

      const jobId = await enqueueSdmJob(
        { type: "model", payload: { ...buildModelPayload(config, run.id), runId: run.id } },
        user.id,
      );
      cleanupDecryptedFiles();

      await db
        .update(runs)
        .set({ bullmqId: jobId, status: "queued" })
        .where(eq(runs.id, run.id));

      jobEventBus.emitJobStatus({
        jobId: run.id,
        state: "queued",
        progress: 0,
        logs: ["Model run queued..."],
      });

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

    const result = await plumberClient.runModel(buildModelPayload(config, run.id));
    cleanupDecryptedFiles();

    const plumberJobId = (result as any).job_id;

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
    const isBusy = message.includes("Server busy") || message.includes("too many runs") || message.includes("max concurrent");
    return c.json({ error: message }, isBusy ? 429 : 502);
  }
});

sdmRoutes.get("/models", async (c) => {
  try {
    const models = await plumberClient.getModels();
    return c.json(models);
  } catch {
    return c.json([
      // Tier 1 — Core Standards
      { id: "glm", label: "GLM / Logistic Regression", maturity: "stable", available: true },
      { id: "gam", label: "GAM / Smooth Response Curves", maturity: "stable", available: true },
      { id: "maxnet", label: "MaxEnt (maxnet)", maturity: "stable", available: false, notes: "Requires maxnet package" },
      { id: "rf", label: "Random Forest (ranger)", maturity: "experimental", available: false, notes: "Requires ranger package" },
      { id: "brt", label: "BRT / Boosted Regression Trees (gbm)", maturity: "experimental", available: false, notes: "Requires gbm package" },
      { id: "xgboost", label: "XGBoost / Gradient Boosting", maturity: "experimental", available: false, notes: "Requires xgboost package" },

      // Tier 2 — Interpretable / Dependency-Free
      { id: "rangebag", label: "Rangebagging", maturity: "experimental", available: true },
      { id: "mars", label: "MARS / Multivariate Adaptive Regression Splines (earth)", maturity: "experimental", available: false, notes: "Requires earth package" },
      { id: "ann", label: "ANN / Artificial Neural Network (nnet)", maturity: "experimental", available: false, notes: "Requires nnet package" },
      { id: "cta", label: "CTA / Classification Tree Analysis (rpart)", maturity: "experimental", available: false, notes: "Requires rpart package" },
      { id: "fda", label: "FDA / Flexible Discriminant Analysis (mda)", maturity: "experimental", available: false, notes: "Requires mda + earth packages" },

      // Tier 3 — Ensembles
      { id: "ensemble_glm_rangebag", label: "Ensemble (GLM + Rangebagging)", maturity: "experimental", available: true },
      { id: "multi_ensemble", label: "Multi-Model Ensemble", maturity: "experimental", available: true },
      { id: "dnn", label: "DNN / Deep Neural Network (cito/torch)", maturity: "experimental", available: false, notes: "Requires cito + torch packages" },
      { id: "bioclim", label: "BIOCLIM / Mahalanobis Envelope", maturity: "experimental", available: true, notes: "Presence-only environmental envelope" },

      // Tier 4 — Rare Species
      { id: "esm_glm", label: "ESM — GLM (Rare Species)", maturity: "experimental", available: false, notes: "Requires ecospat + biomod2 packages" },
      { id: "esm_maxnet", label: "ESM — MaxEnt (Rare Species)", maturity: "experimental", available: false, notes: "Requires ecospat + biomod2 + maxnet packages" },
      { id: "biomod2", label: "biomod2 / Multi-Algorithm Ensemble", maturity: "experimental", available: false, notes: "Requires biomod2 package + sdm.enable_biomod2 option" },

      // Tier 5 — Bayesian / Heavy
      { id: "bart", label: "BART / Bayesian Additive Regression Trees (dbarts)", maturity: "experimental", available: false, notes: "Requires dbarts package" },
      { id: "brms", label: "brms / General Bayesian Model (Stan)", maturity: "experimental", available: false, notes: "Requires brms + cmdstanr packages (compilation: 5-15 min)" },
      { id: "inla_spde", label: "INLA / Bayesian Spatial Model (SPDE)", maturity: "experimental", available: false, notes: "Requires INLA package (install from r-inla-download.org)" },

      // Tier 6 — Niche / Specialised
      { id: "occupancy", label: "Occupancy Model (unmarked)", maturity: "experimental", available: false, notes: "Requires unmarked package + detection-history data" },
      { id: "dnn_multispecies", label: "Multi-Species DNN (cito)", maturity: "experimental", available: false, notes: "Requires cito + torch packages" },
      { id: "python_elapid", label: "Elapid — Python MaxEnt", maturity: "experimental", available: false, notes: "Requires Python + elapid package" },
      { id: "python_sklearn_rf", label: "Scikit-Learn Random Forest (Python)", maturity: "experimental", available: false, notes: "Requires Python + scikit-learn package" },
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
      backgroundN: 3000,
      cvFolds: 3,
      cvStrategy: "spatial_blocks",
      threshold: 0.5,
      nCores: 1,
      seed: 42,
      dnnArchitecture: "DNN_Medium",
      dnnNSeeds: 5,
      dnnDevice: "auto",
      dnnMultispeciesArchitecture: "DNN_Medium",
      dnnMultispeciesNSeeds: 3,
      brtNTrees: 2000,
      brtInteractionDepth: 3,
      brtShrinkage: 0.01,
      brtBagFraction: 0.75,
      ctaCp: 0.01,
      ctaMaxdepth: 10,
      ctaMinsplit: 20,
      marsDegree: 2,
      marsPenalty: 3.0,
      fdaDegree: 2,
      annSize: 5,
      annDecay: 0.01,
      annMaxit: 200,
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
          last_stage: runs.lastStage,
          metrics: runs.metrics,
          outputFiles: runs.outputFiles,
          error: runs.error,
          error_code: runs.errorCode,
          error_hint: runs.errorHint,
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
      last_stage: r.last_stage ?? null,
      metrics: r.metrics ?? null,
      output_files: r.outputFiles ?? null,
      error: r.error ?? null,
      error_code: r.error_code ?? null,
      error_hint: r.error_hint ?? null,
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
    }, 503);
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

    // Proactive Plumber check for running runs — fetches live progress_log and progress_json
    let plumberProgressJson: unknown = null;
    let plumberProgressLog: string[] = [];
    let effectiveStatus = run.status;
    if (run.status === "running" && run.jobId) {
      try {
        const plumberStatus = await plumberClient.getModelStatus(run.jobId, 8000);
        const ps = plumberStatus as any;
        plumberProgressJson = ps.progress_json ?? null;
        plumberProgressLog = Array.isArray(ps.progress_log) ? ps.progress_log as string[] : [];

        // Fire-and-forget: if Plumber reports terminal state, update DB in background
        // Only update if DB status is still running (guards against race with cancel)
        if (ps.status === "completed" || ps.status === "failed" || ps.status === "cancelled") {
          db.update(runs).set({
            status: ps.status,
            metrics: ps.status === "completed" ? ps.metrics ?? null : null,
            outputFiles: ps.status === "completed" ? ps.output_files ?? null : null,
            error: ps.error ?? null,
            errorCode: ps.error_code ?? null,
            errorHint: ps.error_hint ?? null,
            progressLog: plumberProgressLog.length > 0 ? plumberProgressLog : undefined,
            completedAt: new Date(),
          }).where(and(eq(runs.id, jobId), inArray(runs.status, ["running", "queued"]))).then(() => {
            jobEventBus.emitJobStatus({
              jobId: run.id,
              state: ps.status,
              progress: ps.status === "completed" ? 100 : 0,
              logs: Array.isArray(ps.progress_log) ? ps.progress_log as string[] : [],
              result: ps.status === "completed" ? ps : undefined,
              failedReason: ps.error ?? undefined,
            });
          }).catch(() => {});
        }
      } catch {
        // Plumber unreachable — fall through to DB response
      }
    } else if (run.status === "running" && !run.jobId && run.startedAt) {
      // Orphaned run: worker set status to running but never received a Plumber job ID.
      // If started more than 5 minutes ago, the worker likely crashed or all retries failed.
      const orphanThreshold = 5 * 60 * 1000;
      if (Date.now() - run.startedAt.getTime() > orphanThreshold) {
        db.update(runs)
          .set({
            status: "failed",
            error: "Model run did not start — worker was unable to connect to the model backend",
            errorCode: "WORKER_ORPHAN",
            completedAt: new Date(),
          })
          .where(eq(runs.id, jobId))
          .then(() => {
            jobEventBus.emitJobStatus({
              jobId: run.id,
              state: "failed",
              progress: 0,
              failedReason: "Model run did not start — worker was unable to connect to the model backend",
              error_code: "WORKER_ORPHAN",
            });
          })
          .catch(() => {});
        effectiveStatus = "failed";
      }
    }

    // Always return 200 when run data exists in DB — the response body fields (status, error_code, etc.)
    // tell the frontend whether the run failed. Using HTTP 4xx/5xx causes the frontend's apiGet to throw
    // and prevents the run state from being populated, blocking the failed run display UI.
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
        bullmqId: runs.bullmqId,
        status: runs.status,
      })
      .from(runs)
      .where(projectIds ? and(eq(runs.id, jobId), inArray(runs.projectId, projectIds)) : eq(runs.id, jobId))
      .limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    if (run.status !== "queued" && run.status !== "running") {
      return c.json({ error: `Run is already ${run.status} — cannot cancel` }, 409);
    }

    const queue = getJobQueue();
    if (queue && run.bullmqId) {
      const bullJob = await queue.getJob(run.bullmqId);
      if (bullJob) {
        const state = await bullJob.getState();
        if (state === "active") {
          await bullJob.discard();
        } else if (state === "waiting" || state === "delayed") {
          await bullJob.remove();
        }
      }
    }

    if (run.jobId) {
      const result = await plumberClient.cancelModel(run.jobId);
      await db.update(runs).set({ status: "cancelled", completedAt: new Date() }).where(and(eq(runs.id, jobId), inArray(runs.status, ["queued", "running"])));
      jobEventBus.emitJobStatus({
        jobId: run.id,
        state: "cancelled",
        progress: 0,
        logs: ["Model run cancelled by user."],
      });
      return c.json(result);
    }

    await db.update(runs).set({ status: "cancelled", completedAt: new Date() }).where(and(eq(runs.id, jobId), inArray(runs.status, ["queued", "running"])));
    jobEventBus.emitJobStatus({
      jobId: run.id,
      state: "cancelled",
      progress: 0,
      logs: ["Model run cancelled by user."],
    });
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
      .select({ id: runs.id, jobId: runs.jobId, bullmqId: runs.bullmqId, status: runs.status })
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
        if (queue && run.bullmqId) {
          const bullJob = await queue.getJob(run.bullmqId);
          if (bullJob) {
            const state = await bullJob.getState();
            if (state === "active") {
              await bullJob.discard();
            } else if (state === "waiting" || state === "delayed") {
              await bullJob.remove();
            }
          }
        }

        if (run.jobId) {
          await plumberClient.cancelModel(run.jobId).catch(() => console.warn("[sdm] Failed to cancel Plumber run", run.jobId));
        }

        await db.update(runs).set({ status: "cancelled" }).where(and(eq(runs.id, run.id), inArray(runs.status, ["queued", "running"])));
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
        projectId: runs.projectId,
        runStorageBytes: runs.runStorageBytes,
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
      await plumberClient.deleteModelOutputs(run.jobId).catch(() => console.warn("[sdm] Failed to delete Plumber outputs for run", run.jobId));
    }

    await db.delete(runs).where(eq(runs.id, runId));

    // Subtract run storage from user's quota
    if (run.runStorageBytes && run.runStorageBytes > 0 && run.projectId) {
      try {
        const [project] = await db
          .select({ ownerId: projects.ownerId })
          .from(projects)
          .where(eq(projects.id, run.projectId))
          .limit(1);
        if (project) {
          await db
            .update(users)
            .set({ storageUsedBytes: sql`greatest(0, ${users.storageUsedBytes} - ${run.runStorageBytes})` })
            .where(eq(users.id, project.ownerId));
        }
      } catch { /* best-effort */ }
    }

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
        await plumberClient.deleteModelOutputs(run.jobId).catch(() => console.warn("[sdm] Batch clear: failed to delete Plumber outputs for run", run.jobId));
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
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const { configs, name } = body;
    const user = c.get("user");
    const projectId = await ensureDefaultProject(user);

    if (!Array.isArray(configs) || configs.length === 0) {
      return c.json({ error: "configs must be a non-empty array" }, 400);
    }

    if (configs.length > 50) {
      return c.json({ error: "Batch limited to 50 configs per request" }, 400);
    }

    const [batch] = await db
      .insert(batches)
      .values({
        projectId,
        userId: user.id,
        name: name || `Batch ${new Date().toLocaleDateString()}`,
        totalJobs: configs.length,
        status: "running",
      })
      .returning();

    const jobIds: string[] = [];

    // Batch-insert all runs in one query
    const parsedConfigs = configs.map((config) => {
      const parsed = modelConfigSchema.safeParse(config);
      if (!parsed.success) throw new Error(`Invalid config: ${parsed.error.message}`);
      return parsed;
    });

    const insertedRuns = await db
      .insert(runs)
      .values(
        parsedConfigs.map((parsed) => ({
          speciesName: parsed.data.species,
          projectId,
          modelId: parsed.data.modelId,
          status: "queued" as const,
          config: parsed.data as any,
          parentRunId: batch.id,
          pipelineRunId: (parsed.data as any).pipelineRunId || null,
        }))
      )
      .returning();

    // Enqueue all jobs in parallel
    const enqueueResults = await Promise.allSettled(
      insertedRuns.map((run) => {
        const parsed = parsedConfigs[insertedRuns.indexOf(run)];
        const plumberPayload = { ...buildModelPayload(parsed.data, run.id), runId: run.id };
        return enqueueSdmJob({ type: "model", payload: plumberPayload }, user.id);
      })
    );

    cleanupDecryptedFiles();

    // Update runs with job IDs in parallel
    await Promise.all(
      insertedRuns.map((run, i) => {
        const queuedJobId = enqueueResults[i].status === "fulfilled" ? enqueueResults[i].value : null;
        jobIds.push(run.id);
        if (!queuedJobId) return Promise.resolve();
        return db
          .update(runs)
          .set({ bullmqId: queuedJobId })
          .where(eq(runs.id, run.id));
      })
    );

    return c.json({
      batch_id: batch.id,
      job_ids: jobIds,
      total: jobIds.length,
      message: `Batch of ${jobIds.length} runs started`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch run failed";
    return c.json({ error: message }, 500);
  }
});

sdmRoutes.get("/batch/:batchId", async (c) => {
  try {
    const batchId = c.req.param("batchId");
    const user = c.get("user");

    const [batch] = await db
      .select({
        id: batches.id,
        name: batches.name,
        status: batches.status,
        totalJobs: batches.totalJobs,
        completedJobs: batches.completedJobs,
        failedJobs: batches.failedJobs,
        createdAt: batches.createdAt,
        completedAt: batches.completedAt,
        projectId: batches.projectId,
      })
      .from(batches)
      .where(eq(batches.id, batchId));
    if (!batch) return c.json({ error: "Batch not found" }, 404);

    const projectIds = await getUserProjectIds(user);
    if (!projectIds?.includes(batch.projectId)) {
      return c.json({ error: "Batch not found" }, 404);
    }

    const runRows = await db
      .select({ id: runs.id, speciesName: runs.speciesName, modelId: runs.modelId, status: runs.status, metrics: runs.metrics, error: runs.error })
      .from(runs)
      .where(eq(runs.parentRunId, batchId));

    return c.json({
      batch: {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        total_jobs: batch.totalJobs,
        completed_jobs: batch.completedJobs,
        failed_jobs: batch.failedJobs,
        created_at: batch.createdAt,
        completed_at: batch.completedAt,
      },
      runs: runRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch status failed";
    return c.json({ error: message }, 500);
  }
});

sdmRoutes.post("/batch/:batchId/cancel", async (c) => {
  try {
    const batchId = c.req.param("batchId");
    const user = c.get("user");

    const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
    if (!batch) return c.json({ error: "Batch not found" }, 404);

    const projectIds = await getUserProjectIds(user);
    if (!projectIds?.includes(batch.projectId)) return c.json({ error: "Batch not found" }, 404);

    const runRows = await db.select().from(runs).where(eq(runs.parentRunId, batchId));
    const cancellable = runRows.filter(r => r.status === "queued" || r.status === "running");
    const queue = getJobQueue();

    for (const r of cancellable) {
      if (r.bullmqId && queue) await queue.remove(r.bullmqId);
      if (r.jobId) await plumberClient.cancelModel(r.jobId).catch(() => {});
      await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, r.id));
      jobEventBus.emitJobStatus({
        jobId: r.id,
        state: "cancelled",
        progress: 0,
        logs: ["Batch run cancelled by user."],
      });
    }

    await db.update(batches).set({ status: "cancelled", completedAt: new Date() }).where(eq(batches.id, batchId));

    return c.json({ ok: true, cancelled: cancellable.length, total: runRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch cancel failed";
    return c.json({ error: message }, 500);
  }
});

sdmRoutes.post("/batch/:batchId/retry", async (c) => {
  try {
    const batchId = c.req.param("batchId");
    const user = c.get("user");

    const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
    if (!batch) return c.json({ error: "Batch not found" }, 404);

    const projectIds = await getUserProjectIds(user);
    if (!projectIds?.includes(batch.projectId)) return c.json({ error: "Batch not found" }, 404);

    const failedRuns = await db
      .select()
      .from(runs)
      .where(and(eq(runs.parentRunId, batchId), eq(runs.status, "failed")));

    const retriedIds: string[] = [];
    for (const r of failedRuns) {
      const [updated] = await db.update(runs).set({ status: "queued", error: null, jobId: null, bullmqId: null }).where(eq(runs.id, r.id)).returning();
      const queuedJobId = await enqueueSdmJob(
        { type: "model", payload: buildModelPayload((r.config as unknown as ModelConfigRecord), r.id) },
        user.id,
      );
      if (queuedJobId) {
        await db.update(runs).set({ bullmqId: queuedJobId }).where(eq(runs.id, r.id));
      }
      jobEventBus.emitJobStatus({
        jobId: r.id,
        state: "queued",
        progress: 0,
        logs: ["Model run queued for retry..."],
      });
      retriedIds.push(r.id);
    }
    cleanupDecryptedFiles();

    if (retriedIds.length > 0) {
      await db.update(batches).set({ status: "running", failedJobs: 0 }).where(eq(batches.id, batchId));
    }

    return c.json({ ok: true, retried: retriedIds.length, job_ids: retriedIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch retry failed";
    return c.json({ error: message }, 500);
  }
});

sdmRoutes.get("/compare/:runId1/:runId2", async (c) => {
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

// ── Targets pipeline proxy routes ───────────────────────────────────────────

sdmRoutes.post("/targets/run", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const result = await plumberClient.targetsRun(body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Targets run failed";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.get("/targets/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const result = await plumberClient.targetsStatus(jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Targets status failed";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.get("/targets/results/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const result = await plumberClient.targetsResults(jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Targets results failed";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.get("/logs/:jobId", async (c) => {
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
