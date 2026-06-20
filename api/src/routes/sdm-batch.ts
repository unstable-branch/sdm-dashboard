import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { getJobQueue } from "../services/queue.js";
import { db } from "../db/index.js";
import { runs, batches, users, projects } from "../db/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { modelRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { jobEventBus } from "../services/job-events.js";
import { buildModelPayload, cleanupDecryptedFiles, type ModelConfigRecord } from "../services/model-payload.js";
import { enqueueSdmJob } from "../services/queue.js";

export const sdmBatchRoutes = new Hono<AppEnv>();

sdmBatchRoutes.use("/batch", modelRateLimit);
sdmBatchRoutes.use("/batch", authMiddleware);
sdmBatchRoutes.use("/cancel-all", authMiddleware);
sdmBatchRoutes.use("/runs", authMiddleware);
sdmBatchRoutes.use("/runs/delete/*", authMiddleware);
sdmBatchRoutes.use("/runs/clear-all", authMiddleware);
sdmBatchRoutes.use("*", optionalAuth);

sdmBatchRoutes.get("/models", async (c) => {
  try {
    const models = await plumberClient.getModels();
    return c.json(models);
  } catch {
    return c.json([
      { id: "glm", label: "GLM / Logistic Regression", maturity: "stable", available: true },
      { id: "gam", label: "GAM / Smooth Response Curves", maturity: "stable", available: true },
      { id: "maxnet", label: "MaxEnt (maxnet)", maturity: "stable", available: false, notes: "Requires maxnet package" },
      { id: "rf", label: "Random Forest (ranger)", maturity: "experimental", available: false, notes: "Requires ranger package" },
      { id: "brt", label: "BRT / Boosted Regression Trees (gbm)", maturity: "experimental", available: false, notes: "Requires gbm package" },
      { id: "xgboost", label: "XGBoost / Gradient Boosting", maturity: "experimental", available: false, notes: "Requires xgboost package" },
      { id: "rangebag", label: "Rangebagging", maturity: "experimental", available: true },
      { id: "mars", label: "MARS / Multivariate Adaptive Regression Splines (earth)", maturity: "experimental", available: false, notes: "Requires earth package" },
      { id: "ann", label: "ANN / Artificial Neural Network (nnet)", maturity: "experimental", available: false, notes: "Requires nnet package" },
      { id: "cta", label: "CTA / Classification Tree Analysis (rpart)", maturity: "experimental", available: false, notes: "Requires rpart package" },
      { id: "fda", label: "FDA / Flexible Discriminant Analysis (mda)", maturity: "experimental", available: false, notes: "Requires mda + earth packages" },
      { id: "ensemble_glm_rangebag", label: "Ensemble (GLM + Rangebagging)", maturity: "experimental", available: true },
      { id: "multi_ensemble", label: "Multi-Model Ensemble", maturity: "experimental", available: true },
      { id: "dnn", label: "DNN / Deep Neural Network (cito/torch)", maturity: "experimental", available: false, notes: "Requires cito + torch packages" },
      { id: "bioclim", label: "BIOCLIM / Mahalanobis Envelope", maturity: "experimental", available: true, notes: "Presence-only environmental envelope" },
      { id: "esm_glm", label: "ESM — GLM (Rare Species)", maturity: "experimental", available: false, notes: "Requires ecospat + biomod2 packages" },
      { id: "esm_maxnet", label: "ESM — MaxEnt (Rare Species)", maturity: "experimental", available: false, notes: "Requires ecospat + biomod2 + maxnet packages" },
      { id: "biomod2", label: "biomod2 / Multi-Algorithm Ensemble", maturity: "experimental", available: false, notes: "Requires biomod2 package + sdm.enable_biomod2 option" },
      { id: "bart", label: "BART / Bayesian Additive Regression Trees (dbarts)", maturity: "experimental", available: false, notes: "Requires dbarts package" },
      { id: "brms", label: "brms / General Bayesian Model (Stan)", maturity: "experimental", available: false, notes: "Requires brms + cmdstanr packages (compilation: 5-15 min)" },
      { id: "inla_spde", label: "INLA / Bayesian Spatial Model (SPDE)", maturity: "experimental", available: false, notes: "Requires INLA package (install from r-inla-download.org)" },
      { id: "occupancy", label: "Occupancy Model (unmarked)", maturity: "experimental", available: false, notes: "Requires unmarked package + detection-history data" },
      { id: "dnn_multispecies", label: "Multi-Species DNN (cito)", maturity: "experimental", available: false, notes: "Requires cito + torch packages" },
      { id: "gllvm", label: "gllvm JSDM", maturity: "experimental", available: false, notes: "Requires gllvm package" },
      { id: "python_elapid", label: "Elapid — Python MaxEnt", maturity: "experimental", available: false, notes: "Requires Python + elapid package" },
      { id: "python_sklearn_rf", label: "Scikit-Learn Random Forest (Python)", maturity: "experimental", available: false, notes: "Requires Python + scikit-learn package" },
    ]);
  }
});

sdmBatchRoutes.get("/config/defaults", async (c) => {
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
      nCores: 8,
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

sdmBatchRoutes.post("/cancel-all", async (c) => {
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

    const cancelConditions: (ReturnType<typeof eq> | ReturnType<typeof inArray>)[] = [
      inArray(runs.status, statusValues as unknown as ("queued" | "running" | "completed" | "failed" | "cancelled")[]),
    ];
    if (projectIds) cancelConditions.push(inArray(runs.projectId, projectIds));
    const allRuns = await db
      .select({ id: runs.id, jobId: runs.jobId, bullmqId: runs.bullmqId, status: runs.status })
      .from(runs)
      .where(and(...cancelConditions));

    if (allRuns.length === 0) {
      return c.json({ ok: true, message: "No runs to cancel", cancelled: 0 });
    }

    const queue = getJobQueue();
    let cancelled = 0;

    // Batch DB update: cancel all qualifying runs in one query
    const runIds = allRuns.map((r) => r.id);
    const [updateResult] = await db
      .update(runs)
      .set({ status: "cancelled" })
      .where(and(inArray(runs.id, runIds), inArray(runs.status, ["queued", "running"])))
      .returning({ id: runs.id });
    cancelled = Array.isArray(updateResult) ? updateResult.length : 0;

    // Parallelize BullMQ and Plumber cancellations
    const cancelPromises = allRuns.map(async (run) => {
      if (queue && run.bullmqId) {
        try {
          const bullJob = await queue.getJob(run.bullmqId);
          if (bullJob) {
            const state = await bullJob.getState();
            if (state === "active") {
              await bullJob.discard();
            } else if (state === "waiting" || state === "delayed") {
              await bullJob.remove();
            }
          }
        } catch { /* best effort */ }
      }
      if (run.jobId) {
        await       plumberClient.cancelModel(run.jobId).catch((e: unknown) =>
        console.warn(`[batch] Cancel model run ${run.jobId} failed:`, e instanceof Error ? e.message : String(e))
      );
      }
    });
    await Promise.allSettled(cancelPromises);

    return c.json({ ok: true, message: `Cancelled ${cancelled}/${allRuns.length} runs`, cancelled, total: allRuns.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel runs";
    return c.json({ error: message }, 502);
  }
});

sdmBatchRoutes.post("/batch", async (c) => {
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

    const parsedConfigs = configs.map((config) => {
      const parsed = modelConfigSchema.safeParse(config);
      if (!parsed.success) throw new Error(`Invalid config: ${parsed.error.message}`);
      return parsed;
    });

    const [batch] = await db
      .insert(batches)
      .values({
        projectId,
        userId: user.id,
        name: name || `Batch ${new Date().toLocaleDateString()}`,
        totalJobs: parsedConfigs.length,
        status: "running",
      })
      .returning();

    const plumberPayload = await plumberClient.targetsRun({ configs: parsedConfigs.map(p => p.data) });

    const targetsJobId = plumberPayload.job_id as string | undefined;

    if (!targetsJobId) {
      throw new Error("Targets pipeline did not return a job ID");
    }

    // Create per-species run records so batch status/cancel/retry can work
    const runRecords = parsedConfigs.map((p) => ({
      projectId,
      parentRunId: batch.id,
      speciesName: p.data.species,
      modelId: p.data.modelId,
      config: p.data as unknown as Record<string, unknown>,
      status: "queued" as const,
      jobId: targetsJobId,
    }));

    if (runRecords.length > 0) {
      await db.insert(runs).values(runRecords);
    }

    await db
      .update(batches)
      .set({ jobId: targetsJobId })
      .where(eq(batches.id, batch.id));

    return c.json({
      batch_id: batch.id,
      job_id: targetsJobId,
      total: configs.length,
      message: `Batch of ${configs.length} configs started via targets pipeline`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch run failed";
    return c.json({ error: message }, 500);
  }
});

sdmBatchRoutes.get("/batch/:batchId", async (c) => {
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

    // Compute live completion counts from runs table rows (batches.* columns may be stale)
    const completedJobs = runRows.filter(r => r.status === "completed").length;
    const failedJobs = runRows.filter(r => r.status === "failed").length;

    return c.json({
      batch: {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        total_jobs: batch.totalJobs,
        completed_jobs: completedJobs,
        failed_jobs: failedJobs,
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

sdmBatchRoutes.post("/batch/:batchId/cancel", async (c) => {
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

    // Batch DB update: cancel all in one query
    const cancellableIds = cancellable.map(r => r.id);
    if (cancellableIds.length > 0) {
      await db.update(runs).set({ status: "cancelled" }).where(inArray(runs.id, cancellableIds));
    }

    // Parallelize BullMQ and Plumber cancellations
    await Promise.allSettled(cancellable.map(async (r) => {
      if (r.bullmqId && queue) await queue.remove(r.bullmqId).catch((e: unknown) =>
        console.warn(`[batch] Remove queue job ${r.bullmqId} failed:`, e instanceof Error ? e.message : String(e)));
      if (r.jobId) await plumberClient.cancelModel(r.jobId).catch((e: unknown) =>
        console.warn(`[batch] Cancel model run ${r.jobId} failed:`, e instanceof Error ? e.message : String(e)));
      jobEventBus.emitJobStatus({
        jobId: r.id,
        state: "cancelled",
        progress: 0,
        logs: ["Batch run cancelled by user."],
      });
    }));

    await db.update(batches).set({ status: "cancelled", completedAt: new Date() }).where(eq(batches.id, batchId));

    return c.json({ ok: true, cancelled: cancellable.length, total: runRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch cancel failed";
    return c.json({ error: message }, 500);
  }
});

sdmBatchRoutes.post("/batch/:batchId/retry", async (c) => {
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

    if (failedRuns.length === 0) {
      return c.json({ ok: true, retried: 0, message: "No failed runs to retry" });
    }

    // Check if this batch was a targets pipeline batch (all runs share the same jobId)
    const targetsJobId = batch.jobId;
    const isTargetsBatch = targetsJobId != null && targetsJobId.startsWith("targets-");

    if (isTargetsBatch) {
      // Cancel any still-running old targets job before starting a new one
      if (targetsJobId && targetsJobId !== "targets-none") {
        try {
          await plumberClient.cancelModel(targetsJobId);
        } catch (e: unknown) {
          console.warn(`[batch-retry] Cancel old targets job ${targetsJobId}:`,
            e instanceof Error ? e.message : String(e));
        }
      }

      // For targets batches, re-submit all failed configs as a new targets run
      const configs = failedRuns.map((r) => (r.config as unknown as ModelConfigRecord));

      const plumberPayload = await plumberClient.targetsRun({ configs });
      const newTargetsJobId = plumberPayload.job_id as string | undefined;
      if (!newTargetsJobId) throw new Error("Targets pipeline did not return a job ID");

      // Bulk-update all failed runs with the new targets job ID
      const retriedIds = failedRuns.map((r) => r.id);
      await db.update(runs).set({
        status: "queued",
        error: null,
        jobId: newTargetsJobId,
        bullmqId: null,
      }).where(inArray(runs.id, retriedIds));
      for (const id of retriedIds) {
        jobEventBus.emitJobStatus({
          jobId: id,
          state: "queued",
          progress: 0,
          logs: ["Targets pipeline re-submitted for retry..."],
        });
      }

      await db.update(batches).set({
        status: "running",
        jobId: newTargetsJobId,
        failedJobs: 0,
      }).where(eq(batches.id, batchId));

      return c.json({ ok: true, retried: retriedIds.length, job_id: newTargetsJobId });
    }

    // Legacy single-species batch retry: re-enqueue individual runs
    const retriedIds = failedRuns.map((r) => r.id);
    const bullmqIds = new Map<string, string>();
    await db.update(runs).set({ status: "queued", error: null, jobId: null, bullmqId: null }).where(inArray(runs.id, retriedIds));
    for (const r of failedRuns) {
      const queuedJobId = await enqueueSdmJob(
        { type: "model", payload: buildModelPayload((r.config as unknown as ModelConfigRecord), r.id) },
        user.id,
      );
      if (queuedJobId) {
        bullmqIds.set(r.id, queuedJobId);
      }
      jobEventBus.emitJobStatus({
        jobId: r.id,
        state: "queued",
        progress: 0,
        logs: ["Model run queued for retry..."],
      });
    }
    // Bulk-update bullmqId for runs that were enqueued
    const bullmqUpdates = Array.from(bullmqIds.entries());
    if (bullmqUpdates.length > 0) {
      await Promise.all(bullmqUpdates.map(([runId, bullmqId]) =>
        db.update(runs).set({ bullmqId }).where(eq(runs.id, runId))
      ));
    }
    if (retriedIds.length > 0) {
      await db.update(batches).set({ status: "running", failedJobs: 0 }).where(eq(batches.id, batchId));
    }

    return c.json({ ok: true, retried: retriedIds.length, job_ids: retriedIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch retry failed";
    return c.json({ error: message }, 500);
  } finally {
    cleanupDecryptedFiles();
  }
});

sdmBatchRoutes.delete("/runs/delete/:runId", async (c) => {
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

    if (run.jobId) {
      await plumberClient.deleteModelOutputs(run.jobId).catch(() => console.warn("[sdm] Failed to delete Plumber outputs for run", run.jobId));
    }

    await db.delete(runs).where(eq(runs.id, runId));

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

sdmBatchRoutes.post("/runs/clear-all", async (c) => {
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
      .select({ id: runs.id, jobId: runs.jobId, runStorageBytes: runs.runStorageBytes })
      .from(runs)
      .where(projectIds ? and(inArray(runs.status, statusesToDelete as unknown as ("queued" | "running" | "completed" | "failed" | "cancelled")[]), inArray(runs.projectId, projectIds)) : inArray(runs.status, statusesToDelete as unknown as ("queued" | "running" | "completed" | "failed" | "cancelled")[]));

    let deletedCount = 0;

    // Parallelize Plumber output deletions
    if (runsToDelete.length > 0) {
      await Promise.allSettled(
        runsToDelete.map((run) =>
          run.jobId
            ? plumberClient.deleteModelOutputs(run.jobId).catch((e: unknown) =>
              console.warn(`[batch] Delete outputs for ${run.jobId} failed:`, e instanceof Error ? e.message : String(e)))
            : Promise.resolve()
        )
      );
      deletedCount = runsToDelete.length;

      const storageFreed = runsToDelete.reduce((sum, r) => sum + (r.runStorageBytes ?? 0), 0);
      if (storageFreed > 0) {
        await db
          .update(users)
          .set({ storageUsedBytes: sql`GREATEST(${users.storageUsedBytes} - ${storageFreed}, 0)` })
          .where(eq(users.id, user.id));
      }

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
