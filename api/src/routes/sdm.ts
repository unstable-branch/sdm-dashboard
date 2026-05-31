import { Hono } from "hono";
import { modelConfigSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob, getJobQueue } from "../services/queue.js";
import { db } from "../db/index.js";
import { runs, species, batches } from "../db/schema.js";
import { eq, desc, count, and, inArray, sql } from "drizzle-orm";
import { getErrorHttpStatus, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";
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

// Map of camelCase config keys to snake_case keys expected by Plumber
const CAMEL_TO_SNAKE: Record<string, string> = {
  modelId: "model_id",
  backgroundN: "background_n",
  cvFolds: "cv_folds",
  cvStrategy: "cv_strategy",
  cvBlockSizeKm: "cv_block_size_km",
  includeQuadratic: "include_quadratic",
  nCores: "n_cores",
  paReplicates: "pa_replicates",
  biasMethod: "bias_method",
  thickeningDistanceKm: "thickening_distance_km",
  minSourceRecords: "min_source_records",
  mergeSmallSources: "merge_small_sources",
  thinByCell: "thin_by_cell",
  vifReduction: "vif_reduction",
  vifThreshold: "vif_threshold",
  climateMatching: "climate_matching",
  climateMatchingMethod: "climate_matching_method",
  futureProjection: "future_projection",
  futureWorldclimDir: "future_worldclim_dir",
  futureLabel: "future_label",
  futureWorldclimDir2: "future_worldclim_dir2",
  futureLabel2: "future_label2",
  worldclimDir: "worldclim_dir",
  worldclimRes: "worldclim_res",
  useElevation: "use_elevation",
  elevationDemtype: "elevation_demtype",
  useSoil: "use_soil",
  soilVars: "soil_vars",
  soilDepths: "soil_depths",
  useUv: "use_uv",
  uvVars: "uv_vars",
  useVegetation: "use_vegetation",
  vegYear: "veg_year",
  vegProducts: "veg_products",
  useLulc: "use_lulc",
  lulcYear: "lulc_year",
  useHfp: "use_hfp",
  hfpYear: "hfp_year",
  useBioclimSeason: "use_bioclim_season",
  useDrought: "use_drought",
  droughtPeriods: "drought_periods",
  maxnetFeatures: "maxnet_features",
  maxnetRegmult: "maxnet_regmult",
  aggregationFactor: "aggregation_factor",
  occurrenceFile: "occurrence_file",
  cleanedFilePath: "cleaned_file_path",
  pipelineRunId: "pipeline_run_id",
  extrapolationMask: "extrapolation_mask",
  messThreshold: "mess_threshold",
  dnnArchitecture: "dnn_architecture",
  dnnNSeeds: "dnn_n_seeds",
  dnnDevice: "dnn_device",
  brtNTrees: "brt_n_trees",
  brtInteractionDepth: "brt_interaction_depth",
  brtShrinkage: "brt_shrinkage",
  brtBagFraction: "brt_bag_fraction",
  ctaCp: "cta_cp",
  ctaMaxdepth: "cta_maxdepth",
  ctaMinsplit: "cta_minsplit",
  marsDegree: "mars_degree",
  marsPenalty: "mars_penalty",
  marsNk: "mars_nk",
  fdaDegree: "fda_degree",
  fdaNprune: "fda_nprune",
  annSize: "ann_size",
  annDecay: "ann_decay",
  annMaxit: "ann_maxit",
  annRang: "ann_rang",
  rfNumTrees: "rf_num_trees",
  rfMtry: "rf_mtry",
  rfMinNodeSize: "rf_min_node_size",
  xgbMaxDepth: "xgb_max_depth",
  xgbEta: "xgb_eta",
  xgbNrounds: "xgb_nrounds",
  bartNtree: "bart_ntree",
  bartNdpost: "bart_ndpost",
  bartNskip: "bart_nskip",
  brmsChains: "brms_chains",
  brmsIter: "brms_iter",
  brmsWarmup: "brms_warmup",
  inlaMeshMaxEdge: "inla_mesh_max_edge",
  inlaMeshCutoff: "inla_mesh_cutoff",
  inlaPriorRange: "inla_prior_range",
  inlaPriorSigma: "inla_prior_sigma",
  rangebagNBags: "rangebag_n_bags",
  rangebagBagFraction: "rangebag_bag_fraction",
  rangebagVarsPerBag: "rangebag_vars_per_bag",
  detectionFormula: "detection_formula",
  detectionModelType: "detection_model_type",
  dnnMultispeciesArchitecture: "dnn_multispecies_architecture",
  dnnMultispeciesNSeeds: "dnn_multispecies_n_seeds",
  multiEnsembleModels: "multi_ensemble_models",
  multiEnsembleBiomod2: "multi_ensemble_biomod2",
  multiEnsembleWeighting: "multi_ensemble_weighting",
  multiEnsemblePower: "multi_ensemble_power",
  multiEnsembleMinAuc: "multi_ensemble_min_auc",
  multiEnsembleMinTss: "multi_ensemble_min_tss",
  biomod2Models: "biomod2_models",
  esmNRuns: "esm_n_runs",
  esmSplit: "esm_split",
  esmMinAuc: "esm_min_auc",
  esmWeightingMetric: "esm_weighting_metric",
  esmPower: "esm_power",
  esmBiovars: "esm_biovars",
  maxnetAutoTune: "maxnet_auto_tune",
  gamK: "gam_k",
  dnnDropout: "dnn_dropout",
  dnnL2Lambda: "dnn_l2_lambda",
  multiEnsembleExport: "multi_ensemble_export",
  multiEnsembleUncertainty: "multi_ensemble_uncertainty",
  chelsaExtras: "chelsa_extras",
  analysisCrs: "analysis_crs",
};

function buildModelPayload(config: ModelConfigRecord, runId: string): Record<string, unknown> {
  const { biovars, projectionExtent, ...rest } = config;
  const occurrenceFile = resolveEncryptedFile(config.cleanedFilePath || config.occurrenceFile);
  const cleanedFile = resolveEncryptedFile(config.cleanedFilePath);
  // Convert remaining camelCase keys to snake_case for Plumber API
  const restSnake: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rest)) {
    restSnake[CAMEL_TO_SNAKE[key] || key] = val;
  }
  return {
    ...restSnake,
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
          analysis_crs: config.analysisCrs,
          mask_type: config.maskType ?? "none",
          mask_file: config.maskFile ?? undefined,
          mask_buffer_deg: config.maskBufferDeg ?? undefined,
          future_worldclim_dir2: config.futureWorldclimDir2,
          future_label2: config.futureLabel2,
          chelsa_extras: config.chelsaExtras,
          multi_ensemble_models: config.multiEnsembleModels,
          multi_ensemble_weighting: config.multiEnsembleWeighting,
          multi_ensemble_power: config.multiEnsemblePower,
          multi_ensemble_min_auc: config.multiEnsembleMinAuc,
          multi_ensemble_min_tss: config.multiEnsembleMinTss,
          multi_ensemble_export: config.multiEnsembleExport,
          multi_ensemble_uncertainty: config.multiEnsembleUncertainty,
          biomod2_models: config.biomod2Models,
          uv_months: config.uvMonths,
          drought_periods: config.droughtPeriods,
          esm_min_auc: config.esmMinAuc,
          esm_power: config.esmPower,
          esm_weighting_metric: config.esmWeightingMetric,
          esm_biovars: config.esmBiovars,
          rangebag_n_bags: config.rangebagNBags,
          rangebag_bag_fraction: config.rangebagBagFraction,
          rangebag_vars_per_bag: config.rangebagVarsPerBag,
          maxnet_auto_tune: config.maxnetAutoTune,
          rf_num_trees: config.rfNumTrees,
          rf_mtry: config.rfMtry ?? null,
          rf_min_node_size: config.rfMinNodeSize,
          gam_k: config.gamK,
          xgb_max_depth: config.xgbMaxDepth,
          xgb_eta: config.xgbEta,
          xgb_nrounds: config.xgbNRounds,
          dnn_model_type: config.dnnArchitecture,
          dnn_dropout: config.dnnDropout,
          dnn_lambda: config.dnnL2Lambda,
        },
      }, user.id);

      await db
        .update(runs)
        .set({ jobId, status: "queued" })
        .where(eq(runs.id, run.id));

      jobEventBus.emitJobStatus({
        jobId: run.id,
        state: "active",
        progress: 5,
        logs: ["Model run queued for async processing."],
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
      analysis_crs: config.analysisCrs,
      mask_type: config.maskType ?? "none",
      mask_file: config.maskFile ?? undefined,
      mask_buffer_deg: config.maskBufferDeg ?? undefined,
      future_worldclim_dir2: config.futureWorldclimDir2,
      future_label2: config.futureLabel2,
      chelsa_extras: config.chelsaExtras,
      multi_ensemble_models: config.multiEnsembleModels?.join(","),
      multi_ensemble_weighting: config.multiEnsembleWeighting,
      multi_ensemble_power: config.multiEnsemblePower,
      multi_ensemble_min_auc: config.multiEnsembleMinAuc,
      multi_ensemble_min_tss: config.multiEnsembleMinTss,
      multi_ensemble_export: config.multiEnsembleExport,
      biomod2_models: config.biomod2Models,
      uv_months: config.uvMonths,
      drought_periods: config.droughtPeriods,
      esm_min_auc: config.esmMinAuc,
      esm_power: config.esmPower,
      esm_weighting_metric: config.esmWeightingMetric,
      esm_biovars: config.esmBiovars,
      rangebag_n_bags: config.rangebagNBags,
      rangebag_bag_fraction: config.rangebagBagFraction,
      rangebag_vars_per_bag: config.rangebagVarsPerBag,
      maxnet_auto_tune: config.maxnetAutoTune,
      rf_num_trees: config.rfNumTrees,
      rf_mtry: config.rfMtry ?? null,
      rf_min_node_size: config.rfMinNodeSize,
      gam_k: config.gamK,
      xgb_max_depth: config.xgbMaxDepth,
      xgb_eta: config.xgbEta,
      xgb_nrounds: config.xgbNRounds,
      dnn_model_type: config.dnnArchitecture,
      dnn_dropout: config.dnnDropout,
      dnn_lambda: config.dnnL2Lambda,
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

          const errCode = (plumberStatus as any).error_code as string | undefined;
          const httpStatus = plumberRunStatus === "failed" ? getErrorHttpStatus(errCode) : 200;

          return c.json({
            id: run.id,
            status: plumberRunStatus,
            species: run.speciesName,
            model_id: run.modelId,
            started_at: run.startedAt?.toISOString() ?? null,
            completed_at: plumberStatus && (plumberStatus as any).completed_at,
            error: plumberError ?? null,
            last_stage: run.lastStage ?? null,
            metrics: plumberMetrics ?? null,
            output_files: plumberOutputFiles ?? null,
            r_cpu_time_ms: (plumberStatus as any).r_cpu_time_ms ?? null,
            r_peak_memory_mb: (plumberStatus as any).r_peak_memory_mb ?? null,
            progress_log: Array.isArray((plumberStatus as any).progress_log) ? (plumberStatus as any).progress_log : [],
            config: normalizeConfig(run.config),
          }, httpStatus as any);
        }

        return c.json({
          id: run.id,
          status: run.status,
          species: run.speciesName,
          model_id: run.modelId,
          started_at: run.startedAt?.toISOString() ?? null,
          completed_at: run.completedAt?.toISOString() ?? null,
          error: null,
          last_stage: run.lastStage ?? null,
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
          last_stage: run.lastStage ?? null,
          metrics: null,
          output_files: null,
          progress_log: [],
          config: normalizeConfig(run.config),
        });
      }
    }

    const httpStatus = run.status === "failed" ? getErrorHttpStatus(errCode) : 200;

    return c.json({
      id: run.id,
      status: run.status,
      species: run.speciesName,
      model_id: run.modelId,
      started_at: run.startedAt?.toISOString() ?? null,
      completed_at: run.completedAt?.toISOString() ?? null,
      error: run.error ?? null,
      last_stage: run.lastStage ?? null,
      metrics: run.metrics ?? null,
      output_files: run.outputFiles ?? null,
      progress_log: [],
      config: normalizeConfig(run.config),
    }, httpStatus as any);
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
          await plumberClient.cancelModel(run.jobId).catch(() => console.warn("[sdm] Failed to cancel Plumber run", run.jobId));
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
      await plumberClient.deleteModelOutputs(run.jobId).catch(() => console.warn("[sdm] Failed to delete Plumber outputs for run", run.jobId));
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
        analysis_crs: data.analysisCrs,
        uv_months: data.uvMonths,
        drought_periods: data.droughtPeriods,
        chelsa_extras: data.chelsaExtras,
        esm_min_auc: data.esmMinAuc,
        esm_power: data.esmPower,
        esm_weighting_metric: data.esmWeightingMetric,
        esm_biovars: data.esmBiovars,
        rangebag_n_bags: data.rangebagNBags,
        rangebag_bag_fraction: data.rangebagBagFraction,
        rangebag_vars_per_bag: data.rangebagVarsPerBag,
        maxnet_auto_tune: data.maxnetAutoTune,
        rf_num_trees: data.rfNumTrees,
        rf_mtry: data.rfMtry ?? null,
        rf_min_node_size: data.rfMinNodeSize,
        gam_k: data.gamK,
        xgb_max_depth: data.xgbMaxDepth,
        xgb_eta: data.xgbEta,
        xgb_nrounds: data.xgbNRounds,
        dnn_model_type: data.dnnArchitecture,
        dnn_dropout: data.dnnDropout,
        dnn_lambda: data.dnnL2Lambda,
        output_dir: join("outputs", "jobs", run.id),
      };

      const queuedJobId = await enqueueSdmJob(
        { type: "model", payload: plumberPayload },
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
