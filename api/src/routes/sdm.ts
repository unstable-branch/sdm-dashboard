import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob, getJobQueue } from "../services/queue.js";
import { db } from "../db/index.js";
import { runs, species, batches } from "../db/schema.js";
import { eq, desc, count, and, inArray, sql } from "drizzle-orm";
import { GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";
import { modelRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { jobEventBus } from "../services/job-events.js";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { decrypt } from "../services/encryption.js";

async function plumberJobId(runId: string): Promise<string> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error("Run not found");
  const pid = run.jobId;
  if (!pid) throw new Error("Run has no Plumber job ID");
  return pid;
}

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

function resolveEncryptedFile(filePath: string | undefined | null): string | null {
  if (!filePath || !filePath.endsWith(".enc")) return filePath ?? null;
  try {
    const ciphertext = readFileSync(filePath);
    const plaintext = decrypt(ciphertext);
    const resolvedPath = filePath.replace(/\.enc$/, "");
    writeFileSync(resolvedPath, plaintext);
    return resolvedPath;
  } catch {
    return filePath;
  }
}

function buildModelPayload(config: ModelConfigRecord, runId: string): Record<string, unknown> {
  const { biovars, projectionExtent, ...rest } = config;
  const occurrenceFile = resolveEncryptedFile(config.cleanedFilePath || config.occurrenceFile);
  const cleanedFile = resolveEncryptedFile(config.cleanedFilePath);
  return {
    ...rest,
    species: config.species,
    model_id: config.modelId,
    occurrence_file: occurrenceFile,
    cleaned_file_id: cleanedFile,
    biovars: Array.isArray(config.biovars) ? config.biovars.join(",") : "",
    projection_extent: Array.isArray(config.projectionExtent) ? config.projectionExtent.join(",") : "",
    output_dir: join("outputs", "jobs", runId),
  };
}
import type { AppEnv } from "../middleware/auth.js";

function normalizeConfig(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== "object") return null;
  const normalized = { ...(config as Record<string, unknown>) };
  if (typeof normalized.projection_extent === "string") {
    normalized.projectionExtent = normalized.projection_extent.split(",").map(Number);
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

      // Submit directly to Plumber (bypass BullMQ which crashes in dev)
      const plumberPayload = buildModelPayload(config as unknown as ModelConfigRecord, run.id);
      const plumberResult = await plumberClient.withUser(user.id).runModel(plumberPayload);
      const plumberJobId = (plumberResult as any).job_id as string | undefined;

      if (plumberJobId) {
        await db
          .update(runs)
          .set({ jobId: plumberJobId, status: "running", startedAt: new Date() })
          .where(eq(runs.id, run.id));
      }

      jobEventBus.emitJobStatus({
        jobId: run.id,
        state: "active",
        progress: 5,
        logs: ["Model run submitted to Plumber."],
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
      { id: "bioclim", label: "BIOCLIM / Mahalanobis envelope", maturity: "experimental", available: true, notes: "Presence-only environmental envelope" },
      { id: "inla_spde", label: "INLA / Bayesian spatial (SPDE)", maturity: "experimental", available: false, notes: "Requires INLA package (install from r-inla-download.org)" },
      { id: "bart", label: "BART / Bayesian Additive Regression Trees", maturity: "experimental", available: false, notes: "Requires dbarts package" },
      { id: "occupancy", label: "Occupancy (unmarked)", maturity: "experimental", available: false, notes: "Requires unmarked package + detection-history data" },
      { id: "brms", label: "brms / General Bayesian (Stan)", maturity: "experimental", available: false, notes: "Requires brms + cmdstanr packages (compilation: 5-15 min)" },
      { id: "python_elapid", label: "Elapid (Python MaxEnt)", maturity: "experimental", available: false, notes: "Requires Python + elapid package" },
      { id: "python_sklearn_rf", label: "sklearn Random Forest (Python)", maturity: "experimental", available: false, notes: "Requires Python + scikit-learn package" },
      { id: "brt", label: "BRT / Boosted Regression Trees (gbm)", maturity: "experimental", available: false, notes: "Requires gbm package" },
      { id: "cta", label: "CTA / Classification Tree Analysis (rpart)", maturity: "experimental", available: false, notes: "Requires rpart package" },
      { id: "mars", label: "MARS / Multivariate Adaptive Regression Splines (earth)", maturity: "experimental", available: false, notes: "Requires earth package" },
      { id: "fda", label: "FDA / Flexible Discriminant Analysis (mda)", maturity: "experimental", available: false, notes: "Requires mda + earth packages" },
      { id: "ann", label: "ANN / Artificial Neural Network (nnet)", maturity: "experimental", available: false, notes: "Requires nnet package" },
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
      { id: "dnn_multispecies", label: "Multi-species DNN (cito)", maturity: "experimental", available: false, notes: "Requires cito + torch packages" },
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
      dnnArchitecture: "DNN_Medium",
      dnnNSeeds: 5,
      dnnDevice: "auto",
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
            config: normalizeConfig(run.config),
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
          config: normalizeConfig(run.config),
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
          config: normalizeConfig(run.config),
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
      const result = await plumberClient.cancelModelRun(run.jobId);
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
          await plumberClient.cancelModelRun(run.jobId).catch(() => {});
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
          parentRunId: batch.id,
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
      .select()
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
      await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, r.id));
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
      const [updated] = await db.update(runs).set({ status: "queued", error: null, jobId: null }).where(eq(runs.id, r.id)).returning();
      const queuedJobId = await enqueueSdmJob(
        { type: "model", payload: buildModelPayload((r.config as unknown as ModelConfigRecord), r.id) },
        user.id,
      );
      if (queuedJobId) {
        await db.update(runs).set({ jobId: queuedJobId }).where(eq(runs.id, r.id));
      }
      retriedIds.push(r.id);
    }

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
