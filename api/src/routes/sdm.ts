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
          payload: {
            runId: run.id,
          species: config.species,
          model_id: config.modelId,
          occurrence_file: config.cleanedFilePath || config.occurrenceFile,
          cleaned_file_id: config.cleanedFilePath || null,
          biovars: config.biovars.join(","),
          projection_extent: config.projectionExtent.join(","),
          background_n: config.backgroundN,
          cv_folds: config.cvFolds,
          cv_strategy: config.cvStrategy,
          cv_block_size_km: config.cvBlockSizeKm,
          threshold: config.threshold,
          include_quadratic: config.includeQuadratic,
          use_elevation: config.useElevation,
          elevation_demtype: config.elevationDemtype,
          opentopo_api_key: config.opentopoApiKey,
          use_soil: config.useSoil,
          soil_vars: config.soilVars,
          soil_depths: config.soilDepths,
          use_uv: config.useUv,
          uv_vars: config.uvVars,
          use_vegetation: config.useVegetation,
          veg_year: config.vegYear,
          veg_products: config.vegProducts,
          use_lulc: config.useLulc,
          lulc_year: config.lulcYear,
          use_hfp: config.useHfp,
          hfp_year: config.hfpYear,
          use_bioclim_season: config.useBioclimSeason,
          use_drought: config.useDrought,
          future_projection: config.futureProjection,
          future_worldclim_dir: config.futureWorldclimDir,
          future_label: config.futureLabel,
          vif_reduction: config.vifReduction,
          vif_threshold: config.vifThreshold,
          climate_matching: config.climateMatching,
          climate_matching_method: config.climateMatchingMethod,
          thin_by_cell: config.thinByCell,
          merge_small_sources: config.mergeSmallSources,
          min_source_records: config.minSourceRecords,
          bias_method: config.biasMethod,
          thickening_distance_km: config.thickeningDistanceKm,
          pa_replicates: config.paReplicates,
          maxnet_features: config.maxnetFeatures,
          maxnet_regmult: config.maxnetRegmult,
          aggregation_factor: config.aggregationFactor,
          n_cores: config.nCores,
          seed: config.seed,
          worldclim_dir: config.worldclimDir,
          worldclim_res: config.worldclimRes,
          source: config.source,
        },
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

    const result = await plumberClient.runModel({
      species: config.species,
      model_id: config.modelId,
      occurrence_file: config.cleanedFilePath || config.occurrenceFile,
      cleaned_file_id: config.cleanedFilePath || null,
      biovars: config.biovars.join(","),
      projection_extent: config.projectionExtent.join(","),
      background_n: config.backgroundN,
      cv_folds: config.cvFolds,
      cv_strategy: config.cvStrategy,
      cv_block_size_km: config.cvBlockSizeKm,
      threshold: config.threshold,
      include_quadratic: config.includeQuadratic,
      use_elevation: config.useElevation,
      elevation_demtype: config.elevationDemtype,
      opentopo_api_key: config.opentopoApiKey,
      use_soil: config.useSoil,
      soil_vars: config.soilVars,
      soil_depths: config.soilDepths,
      use_uv: config.useUv,
      uv_vars: config.uvVars,
      use_vegetation: config.useVegetation,
      veg_year: config.vegYear,
      veg_products: config.vegProducts,
      use_lulc: config.useLulc,
      lulc_year: config.lulcYear,
      use_hfp: config.useHfp,
      hfp_year: config.hfpYear,
      use_bioclim_season: config.useBioclimSeason,
      use_drought: config.useDrought,
      future_projection: config.futureProjection,
      future_worldclim_dir: config.futureWorldclimDir,
      future_label: config.futureLabel,
      vif_reduction: config.vifReduction,
      vif_threshold: config.vifThreshold,
      climate_matching: config.climateMatching,
      climate_matching_method: config.climateMatchingMethod,
      thin_by_cell: config.thinByCell,
      merge_small_sources: config.mergeSmallSources,
      min_source_records: config.minSourceRecords,
      bias_method: config.biasMethod,
      thickening_distance_km: config.thickeningDistanceKm,
      pa_replicates: config.paReplicates,
      maxnet_features: config.maxnetFeatures,
      maxnet_regmult: config.maxnetRegmult,
      aggregation_factor: config.aggregationFactor,
      n_cores: config.nCores,
      seed: config.seed,
      worldclim_dir: config.worldclimDir,
      worldclim_res: config.worldclimRes,
      source: config.source,
    });

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

    const allRuns = await db
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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(runs.createdAt))
      .limit(limitVal)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const formatted = allRuns.map((r) => ({
      id: r.id,
      species: r.species ?? null,
      model_id: r.model_id ?? null,
      status: r.status ?? "queued",
      started_at: r.started_at,
      completed_at: r.completed_at,
      metrics: r.metrics ?? null,
      output_files: r.outputFiles ?? null,
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
      .select()
      .from(runs)
      .where(projectIds ? and(eq(runs.id, jobId), inArray(runs.projectId, projectIds)) : eq(runs.id, jobId))
      .limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

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
      .select()
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
      .where(projectIds ? inArray(runs.projectId, projectIds) : undefined);

    const toCancel = allRuns.filter(r => statusValues.includes(r.status));

    if (toCancel.length === 0) {
      return c.json({ ok: true, message: "No runs to cancel", cancelled: 0 });
    }

    const queue = getJobQueue();
    let cancelled = 0;

    for (const run of toCancel) {
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

    return c.json({ ok: true, message: `Cancelled ${cancelled}/${toCancel.length} runs`, cancelled, total: toCancel.length });
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
      .select()
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
    const { configs, parallel } = body;
    const user = c.get("user");
    const projectId = await ensureDefaultProject(user);

    if (!Array.isArray(configs) || configs.length === 0) {
      return c.json({ error: "configs must be a non-empty array" }, 400);
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

      const data = parsed.data;
      const plumberPayload = {
        species: data.species,
        model_id: data.modelId,
        occurrence_file: data.cleanedFilePath || data.occurrenceFile,
        cleaned_file_id: data.cleanedFilePath || null,
        biovars: data.biovars.join(","),
        projection_extent: data.projectionExtent.join(","),
        background_n: data.backgroundN,
        cv_folds: data.cvFolds,
        cv_strategy: data.cvStrategy,
        cv_block_size_km: data.cvBlockSizeKm,
        threshold: data.threshold,
        include_quadratic: data.includeQuadratic,
        use_elevation: data.useElevation,
        elevation_demtype: data.elevationDemtype,
        opentopo_api_key: data.opentopoApiKey,
        use_soil: data.useSoil,
        soil_vars: data.soilVars,
        soil_depths: data.soilDepths,
        use_uv: data.useUv,
        uv_vars: data.uvVars,
        use_vegetation: data.useVegetation,
        veg_year: data.vegYear,
        veg_products: data.vegProducts,
        use_lulc: data.useLulc,
        lulc_year: data.lulcYear,
        use_hfp: data.useHfp,
        hfp_year: data.hfpYear,
        use_bioclim_season: data.useBioclimSeason,
        use_drought: data.useDrought,
        future_projection: data.futureProjection,
        future_worldclim_dir: data.futureWorldclimDir,
        future_label: data.futureLabel,
        vif_reduction: data.vifReduction,
        vif_threshold: data.vifThreshold,
        climate_matching: data.climateMatching,
        climate_matching_method: data.climateMatchingMethod,
        thin_by_cell: data.thinByCell,
        merge_small_sources: data.mergeSmallSources,
        min_source_records: data.minSourceRecords,
        bias_method: data.biasMethod,
        thickening_distance_km: data.thickeningDistanceKm,
        pa_replicates: data.paReplicates,
        maxnet_features: data.maxnetFeatures,
        maxnet_regmult: data.maxnetRegmult,
        aggregation_factor: data.aggregationFactor,
        n_cores: data.nCores,
        seed: data.seed,
        worldclim_dir: data.worldclimDir,
        worldclim_res: data.worldclimRes,
        source: data.source,
        output_dir: join("outputs", "jobs", run.id),
      };

      const plumberRes = await plumberClient.runModel(plumberPayload);
      const plumberJobId = (plumberRes as any).job_id;

      await db
        .update(runs)
        .set({ jobId: plumberJobId, status: "running", startedAt: new Date() })
        .where(eq(runs.id, run.id));

      jobIds.push(run.id);
    }

    return c.json({
      batch_id: `batch-${Date.now()}`,
      job_ids: jobIds,
      total: jobIds.length,
      message: `Batch of ${jobIds.length} runs started`,
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
