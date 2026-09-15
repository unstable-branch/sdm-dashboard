import { modelConfigSchema, modelConfigPartialSchema, enmevalTuneArgsSchema } from "@sdm/shared";

/** Config keys that are never accepted on a model/targets execution request. */
const FORBIDDEN_KEY_NAMES = new Set([
  "apiKey", "api_key", "apikey", "accessKey", "access_key",
  "token", "accessToken", "access_token", "secret", "password",
  "credential", "credentials",
  "opentopoApiKey", "opentopo_api_key", "openTopographyApiKey",
  "open_topography_api_key", "opentopographyApiKey", "opentopography_api_key",
  "opentopoKey", "opentopo_key", "openTopographyKey", "open_topography_key",
  "opentopographyKey", "opentopography_key", "opentopoToken", "opentopo_token",
  "elevationApiKey", "elevation_api_key", "demApiKey", "dem_api_key",
]);

function normalizedKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const FORBIDDEN_NORMALIZED_KEYS = new Set([...FORBIDDEN_KEY_NAMES].map(normalizedKey));

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_NORMALIZED_KEYS.has(key)
    || key.endsWith("apikey")
    || key.endsWith("apitoken")
    || key.includes("secret")
    || key.includes("credential");
}

export type ConfigPath = Array<string | number>;
export type ForbiddenConfigKey = { key: string; path: ConfigPath };

/** Walk JSON-shaped values without retaining or stringifying their values. */
export function findForbiddenConfigKey(value: unknown, path: ConfigPath = []): ForbiddenConfigKey | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenConfigKey(value[index], [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenKey(normalizedKey(key))) return { key, path: [...path, key] };
    const found = findForbiddenConfigKey(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

export class UnsafeExecutionConfigError extends Error {
  readonly code = "UNSAFE_EXECUTION_CONFIG";
  constructor(message = "Execution configuration is not allowed") {
    super(message);
    this.name = "UnsafeExecutionConfigError";
  }
}

export const CAMEL_TO_SNAKE: Record<string, string> = {
  modelId: "model_id",
  threshold: "threshold",
  source: "source",
  seed: "seed",
  backgroundN: "background_n",
  cvFolds: "cv_folds",
  cvStrategy: "cv_strategy",
  cvBlockSizeKm: "cv_block_size_km",
  includeQuadratic: "include_quadratic",
  nCores: "n_cores",
  paReplicates: "pa_replicates",
  maskType: "mask_type",
  maskFile: "mask_file",
  maskBufferDeg: "mask_buffer_deg",
  maskBoundaryType: "mask_boundary_type",
  maskResolution: "mask_resolution",
  maskCountry: "mask_country",
  restrictBackground: "restrict_background",
  biasMethod: "bias_method",
  thickeningDistanceKm: "thickening_distance_km",
  targetGroupFile: "target_group_file",
  minSourceRecords: "min_source_records",
  mergeSmallSources: "merge_small_sources",
  thinByCell: "thin_by_cell",
  vifReduction: "vif_reduction",
  vifThreshold: "vif_threshold",
  climateMatching: "climate_matching",
  climateMatchingMethod: "climate_matching_method",
  futureProjection: "future_projection",
  futureProjection2: "future_projection2",
  futureWorldclimDir: "future_worldclim_dir",
  futureLabel: "future_label",
  futureWorldclimDir2: "future_worldclim_dir2",
  futureLabel2: "future_label2",
  autoDownloadClimate: "auto_download_climate",
  worldclimDir: "worldclim_dir",
  worldclimRes: "worldclim_res",
  useElevation: "use_elevation",
  elevationDemtype: "elevation_demtype",
  useSoil: "use_soil",
  soilVars: "soil_vars",
  soilDepths: "soil_depths",
  useUv: "use_uv",
  uvVars: "uv_vars",
  uvMonths: "uv_months",
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
  extrapolationMask: "extrapolation_mask",
  messThreshold: "mess_threshold",
  dnnArchitecture: "dnn_model_type",
  dnnNSeeds: "dnn_n_seeds",
  dnnDevice: "dnn_device",
  hiddenLayers: "hidden_layers",
  batchSize: "batch_size",
  predictBatchSize: "predict_batch_size",
  learningRate: "learning_rate",
  pythonDevice: "python_device",
  earlyStoppingPatience: "early_stopping_patience",
  validationFraction: "validation_fraction",
  nEstimators: "n_estimators",
  maxDepth: "max_depth",
  maxIterations: "max_iterations",
  gpuEnabled: "gpu_enabled",
  dnnFusedAdam: "dnn_fused_adam",
  dnnMcSamples: "dnn_mc_samples",
  dnnUncertaintyMethod: "dnn_uncertainty_method",
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
  xgbNRounds: "xgb_nrounds",
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
  gllvmFamily: "gllvm_family",
  gllvmNumLv: "gllvm_num_lv",
  gllvmNumRows: "gllvm_num_rows",
  gllvmLvCorr: "gllvm_lv_corr",
  multiEnsembleModels: "multi_ensemble_models",
  multiEnsembleBiomod2: "biomod2_models",
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
  dnnL2Lambda: "dnn_lambda",
  multiEnsembleExport: "multi_ensemble_export",
  multiEnsembleUncertainty: "multi_ensemble_uncertainty",
  chelsaExtras: "chelsa_extras",
  analysisCrs: "analysis_crs",
  generateTiles: "generate_tiles",
  generateCog: "generate_cog",
  speciesFilter: "species_filter",
  trainingExtent: "training_extent",
  tuningMethod: "tuning_method",
  enmevalAlgorithm: "enmeval_algorithm",
  enmevalPartitions: "enmeval_partitions",
  enmevalSelectionMetric: "enmeval_selection_metric",
  enmevalTuneArgs: "enmeval_tune_args",
  enmevalCategoricals: "enmeval_categoricals",
  enmevalNullIterations: "enmeval_null_iterations",
};



/** Explicitly persisted/executed model configuration keys. */
export const SAFE_MODEL_CONFIG_KEYS = new Set<string>([
  "species", "speciesFilter", "modelId", "biovars", "projectionExtent", "trainingExtent",
  "threshold", "source", "seed",
  ...Object.keys(CAMEL_TO_SNAKE),
]);

const SNAKE_TO_CAMEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([camel, snake]) => [snake, camel]),
);

function equalConfigValues(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** Convert the historical wire spelling to the canonical shared-schema spelling. */
export function canonicalizeExecutionConfig(input: unknown): Record<string, unknown> {
  const forbidden = findForbiddenConfigKey(input);
  if (forbidden) throw new UnsafeExecutionConfigError();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UnsafeExecutionConfigError();
  }
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const canonicalKey = SNAKE_TO_CAMEL[key] ?? key;
    if (Object.prototype.hasOwnProperty.call(canonical, canonicalKey) && !equalConfigValues(canonical[canonicalKey], value)) {
      throw new UnsafeExecutionConfigError();
    }
    canonical[canonicalKey] = value;
  }
  return canonical;
}

/** Project a validated/public config to the only keys allowed into execution state. */
export function projectSafeScienceConfig(input: unknown): Record<string, unknown> {
  const canonical = canonicalizeExecutionConfig(input);
  const parsed = modelConfigPartialSchema.safeParse(canonical);
  if (!parsed.success) throw new UnsafeExecutionConfigError();
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (SAFE_MODEL_CONFIG_KEYS.has(key)) projected[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(projected, "enmevalTuneArgs")) {
    const tuning = enmevalTuneArgsSchema.safeParse(projected.enmevalTuneArgs);
    if (!tuning.success) throw new UnsafeExecutionConfigError();
    projected.enmevalTuneArgs = tuning.data;
  }
  return projected;
}

/** Re-parse old persisted configs before retrying; never replay arbitrary JSON. */
export function revalidateHistoricalConfig(input: unknown): Record<string, unknown> {
  const canonical = canonicalizeExecutionConfig(input);
  if (typeof canonical.biovars === "string") {
    canonical.biovars = canonical.biovars.split(",").map((part) => Number(part.trim()));
  }
  for (const key of ["projectionExtent", "trainingExtent"]) {
    if (typeof canonical[key] === "string") {
      canonical[key] = canonical[key].split(",").map((part) => Number(part.trim()));
    }
  }
  const parsed = modelConfigSchema.safeParse(canonical);
  if (!parsed.success) throw new UnsafeExecutionConfigError();
  return projectSafeScienceConfig(parsed.data);
}

/** A response-safe projection; malformed/secret-bearing historical records are denied. */
export function sanitizeStoredConfig(input: unknown): Record<string, unknown> | null {
  try {
    const canonical = canonicalizeExecutionConfig(input);
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(canonical)) {
      if (SAFE_MODEL_CONFIG_KEYS.has(key)) projected[key] = value;
    }
    if (Object.prototype.hasOwnProperty.call(projected, "enmevalTuneArgs")) {
      const tuning = enmevalTuneArgsSchema.safeParse(projected.enmevalTuneArgs);
      if (!tuning.success) return null;
      projected.enmevalTuneArgs = tuning.data;
    }
    return projected;
  } catch { return null; }
}

export function publicConfigValidationError(): { error: string } {
  return { error: "Invalid execution configuration" };
}
