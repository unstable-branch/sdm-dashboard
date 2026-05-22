import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { db } from "../db/index.js";
import { runs, species, projectMembers } from "../db/schema.js";
import { eq, desc, count, and, inArray } from "drizzle-orm";
import { GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";
import { modelRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import { join } from "path";
import type { AppEnv } from "../middleware/auth.js";

export const sdmRoutes = new Hono<AppEnv>();

sdmRoutes.use("*", modelRateLimit);
sdmRoutes.use("/run", authMiddleware);
sdmRoutes.use("/batch", authMiddleware);
sdmRoutes.use("/cancel/*", authMiddleware);
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

    if (async) {
      let speciesId: string | undefined;
      const speciesName = config.species;

      try {
        let [sp] = await db.select().from(species).where(eq(species.name, speciesName)).limit(1);
        if (!sp) {
          [sp] = await db
            .insert(species)
            .values({ name: speciesName, occurrenceCount: 0 })
            .returning();
        }
        speciesId = sp.id;
      } catch {
        // Species tracking is best-effort; continue without it
      }

      const [run] = await db
        .insert(runs)
        .values({
          speciesId: speciesId ?? null,
          speciesName: speciesName ?? null,
          modelId: config.modelId,
          status: "queued",
          config: config as any,
          jobId: null,
        })
        .returning();

      const jobId = await enqueueSdmJob(
        {
          type: "model",
          payload: {
            runId: run.id,
          species: config.species,
          model_id: config.modelId,
          occurrence_file: config.occurrenceFile,
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

    const [run] = await db
      .insert(runs)
      .values({
        modelId: config.modelId,
        speciesName: config.species ?? null,
        status: "running",
        config: config as any,
      })
      .returning();

    const result = await plumberClient.runModel({
      species: config.species,
      model_id: config.modelId,
      occurrence_file: config.occurrenceFile,
      biovars: config.biovars.join(","),
      projection_extent: config.projectionExtent.join(","),
      background_n: config.backgroundN,
      cv_folds: config.cvFolds,
      cv_strategy: config.cvStrategy,
      threshold: config.threshold,
      include_quadratic: config.includeQuadratic,
      n_cores: config.nCores,
      seed: config.seed,
      worldclim_dir: config.worldclimDir,
      source: config.source,
      aggregation_factor: config.aggregationFactor,
      min_source_records: config.minSourceRecords,
      merge_small_sources: config.mergeSmallSources,
      thin_by_cell: config.thinByCell,
      use_elevation: config.useElevation,
      use_soil: config.useSoil,
      future_projection: config.futureProjection,
      future_worldclim_dir: config.futureWorldclimDir,
      future_label: config.futureLabel,
      vif_reduction: config.vifReduction,
      bias_method: config.biasMethod,
      pa_replicates: config.paReplicates,
      thickening_distance_km: config.thickeningDistanceKm,
    });

    const plumberJobId = (result as any).job_id;

    if (plumberJobId) {
      await db
        .update(runs)
        .set({ jobId: plumberJobId, status: "running" })
        .where(eq(runs.id, run.id));
    }

    return c.json({ ...result, runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model run failed";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.get("/models", async (c) => {
  try {
    const models = await plumberClient.getModels();
    return c.json(models);
  } catch {
    return c.json([
      { id: "glm", label: "GLM / Logistic regression", maturity: "stable" },
      { id: "gam", label: "GAM / Smooth response curves", maturity: "stable" },
      { id: "maxnet", label: "MaxEnt", maturity: "stable" },
      { id: "rf", label: "Random Forest", maturity: "stable" },
      { id: "xgboost", label: "XGBoost", maturity: "experimental" },
      { id: "rangebag", label: "Rangebagging", maturity: "experimental" },
      { id: "esm_glm", label: "ESM-GLM (rare species)", maturity: "stable" },
      { id: "esm_maxnet", label: "ESM-MaxNet (rare species)", maturity: "stable" },
      { id: "multi_ensemble", label: "Multi-model ensemble", maturity: "stable" },
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
    const offset = (page - 1) * limitVal;
    const user = c.get("user");

    const conditions = [];
    if (user) {
      const userProjects = await db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, user.id));
      const projectIds = userProjects.map((p) => p.projectId);
      if (projectIds.length > 0) {
        conditions.push(inArray(runs.projectId, projectIds));
      }
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
      started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
      completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
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
    const message = err instanceof Error ? err.message : "Failed to fetch runs";
    return c.json({ error: message }, 500);
  }
});

sdmRoutes.get("/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");

    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, jobId))
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

        if (plumberRunStatus === "completed" || plumberRunStatus === "failed") {
          await db
            .update(runs)
            .set({
              status: plumberRunStatus as any,
              metrics: plumberMetrics ?? null,
              outputFiles: plumberOutputFiles ?? null,
              error: plumberError ?? null,
              completedAt: plumberRunStatus === "completed" ? new Date() : null,
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
            progress_log: (plumberStatus as any).progress_log ?? [],
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
          progress_log: (plumberStatus as any).progress_log ?? [],
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
      progress_log: run.progressLog ?? [],
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
    const [run] = await db.select().from(runs).where(eq(runs.id, jobId)).limit(1);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
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

sdmRoutes.post("/batch", async (c) => {
  try {
    const body = await c.req.json();
    const { configs, parallel } = body;

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
          modelId: parsed.data.modelId,
          status: "queued",
          config: parsed.data as any,
        })
        .returning();

      const plumberPayload = {
        ...parsed.data,
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