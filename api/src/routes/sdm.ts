import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber";
import { enqueueSdmJob } from "../services/queue";

export const sdmRoutes = new Hono();

sdmRoutes.post("/run", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = modelConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const config = parsed.data;
    const async = body.async === true;

    if (async) {
      const jobId = await enqueueSdmJob({
        type: "model",
        payload: {
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
      });
      return c.json({ jobId, status: "queued" });
    }

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
      future_label: config.futureLabel,
      vif_reduction: config.vifReduction,
      bias_method: config.biasMethod,
      pa_replicates: config.paReplicates,
      thickening_distance_km: config.thickeningDistanceKm,
    });

    return c.json(result);
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
    const runs = await plumberClient.getModelRuns();
    return c.json(runs);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch runs";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.get("/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const status = await plumberClient.getModelStatus(jobId);
    return c.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get status";
    return c.json({ error: message }, 502);
  }
});

sdmRoutes.post("/cancel/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const result = await plumberClient.cancelModel(jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel";
    return c.json({ error: message }, 502);
  }
});
