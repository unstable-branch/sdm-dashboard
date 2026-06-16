import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { decrypt } from "./encryption.js";

export type ModelConfigRecord = Record<string, unknown> & {
  species?: string;
  modelId?: string;
  cleanedFilePath?: string;
  occurrenceFile?: string;
  biovars?: number[];
  projectionExtent?: number[];
  trainingExtent?: number[];
  backgroundN?: number;
  cvFolds?: number;
};

const _decryptedFiles = new Set<string>();

export function cleanupDecryptedFiles(): void {
  for (const p of _decryptedFiles) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
  _decryptedFiles.clear();
}

function resolveEncryptedFile(filePath: string | undefined | null): string | null {
  if (!filePath || !filePath.endsWith(".enc")) return filePath ?? null;
  const resolvedPath = filePath.replace(/\.enc$/, "");
  try {
    const ciphertext = readFileSync(filePath);
    const plaintext = decrypt(ciphertext);
    writeFileSync(resolvedPath, plaintext);
    _decryptedFiles.add(resolvedPath);
    return resolvedPath;
  } catch {
    // If decryption failed but file was written, clean it up
    if (existsSync(resolvedPath)) {
      try { unlinkSync(resolvedPath); } catch { /* ignore */ }
    }
    return filePath;
  }
}

// Map of camelCase config keys to snake_case keys expected by Plumber
export const CAMEL_TO_SNAKE: Record<string, string> = {
  modelId: "model_id",
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
  worldclimDir: "worldclim_dir",
  worldclimRes: "worldclim_res",
  useElevation: "use_elevation",
  elevationDemtype: "elevation_demtype",
  opentopoApiKey: "opentopo_api_key",
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
  pipelineRunId: "pipeline_run_id",
  extrapolationMask: "extrapolation_mask",
  messThreshold: "mess_threshold",
  dnnArchitecture: "dnn_model_type",
  dnnNSeeds: "dnn_n_seeds",
  dnnDevice: "dnn_device",
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

export function buildModelPayload(config: ModelConfigRecord, runId: string): Record<string, unknown> {
  const { biovars, projectionExtent, trainingExtent, ...rest } = config;
  const occurrenceFile = resolveEncryptedFile(config.cleanedFilePath || config.occurrenceFile);
  const cleanedFile = resolveEncryptedFile(config.cleanedFilePath);
  // Convert remaining camelCase keys to snake_case for Plumber API
  const restSnake: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rest)) {
    restSnake[CAMEL_TO_SNAKE[key] || key] = val;
  }
  const payload: Record<string, unknown> = {
    ...restSnake,
    species: config.species,
    model_id: config.modelId,
    occurrence_file: occurrenceFile,
    biovars: Array.isArray(config.biovars) ? config.biovars.join(",") : "",
    projection_extent: Array.isArray(config.projectionExtent) ? config.projectionExtent.join(",") : "",
    training_extent: Array.isArray(config.trainingExtent) ? config.trainingExtent.join(",") : undefined,
    output_dir: join("outputs", "jobs", runId),
  };
  if (cleanedFile) {
    payload.cleaned_file_id = cleanedFile;
  }
  return payload;
}
