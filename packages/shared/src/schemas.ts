import { z } from "zod";

const FORBIDDEN_EXECUTION_KEY_NAMES = new Set([
  "apiKey", "api_key", "apikey", "accessKey", "access_key",
  "token", "accessToken", "access_token", "secret", "password",
  "credential", "credentials",
  "opentopoApiKey", "opentopo_api_key", "openTopographyApiKey",
  "open_topography_api_key", "opentopographyApiKey", "opentopography_api_key",
  "opentopoKey", "opentopo_key", "openTopographyKey", "open_topography_key",
  "opentopographyKey", "opentopography_key", "opentopoToken", "opentopo_token",
  "elevationApiKey", "elevation_api_key", "demApiKey", "dem_api_key",
]);

function normalizedExecutionKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const FORBIDDEN_NORMALIZED_EXECUTION_KEYS = new Set(
  [...FORBIDDEN_EXECUTION_KEY_NAMES].map(normalizedExecutionKey),
);

const FORBIDDEN_CLIENT_PATH_KEYS = new Set([
  "occurrencefile", "occurrencefilepath", "occurrence_file", "occurrence_file_path",
  "cleanedfilepath", "cleaned_file_path", "cleanedfileid", "cleaned_file_id",
  "maskfile", "maskfilepath", "mask_file", "mask_file_path",
  "targetgroupfile", "targetgroupfilepath", "target_group_file", "target_group_file_path",
  "worldclimdir", "worldclim_dir", "futureworldclimdir", "future_worldclim_dir",
  "futureworldclimdir2", "future_worldclim_dir2",
]);

function isForbiddenExecutionKey(key: string): boolean {
  return FORBIDDEN_NORMALIZED_EXECUTION_KEYS.has(key)
    || key.endsWith("apikey")
    || key.endsWith("apitoken")
    || key.includes("secret")
    || key.includes("credential");
}

function findForbiddenExecutionKey(
  value: unknown,
  path: Array<string | number> = [],
  forbidden: (key: string) => boolean = (key) => isForbiddenExecutionKey(normalizedExecutionKey(key)),
): Array<string | number> | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenExecutionKey(value[index], [...path, index], forbidden);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden(key)) {
      return [...path, key];
    }
    const found = findForbiddenExecutionKey(child, [...path, key], forbidden);
    if (found) return found;
  }
  return null;
}

function rejectForbiddenExecutionKeys(input: unknown, ctx: z.RefinementCtx): unknown {
  const clientPath = findForbiddenExecutionKey(input, [], (key) => FORBIDDEN_CLIENT_PATH_KEYS.has(normalizedExecutionKey(key)));
  if (clientPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: clientPath, message: "Client filesystem paths are not accepted in execution configuration" });
    return z.NEVER;
  }
  const path = findForbiddenExecutionKey(input);
  if (path) {
    // Do not include the submitted key value in a validation issue.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "Credential fields are not accepted in execution configuration",
    });
    return z.NEVER;
  }
  return input;
}

export const enmevalTuneArgsSchema = z.object({
  // These are the only MaxEnt tuning dimensions supported by the UI/backend.
  fc: z.array(z.string().regex(/^[LQHP]{1,5}$/)).min(1).max(20).optional(),
  rm: z.array(z.number().finite().min(0.01).max(20)).min(1).max(20).optional(),
}).strict();

const modelConfigObjectSchema = z.object({
  species: z.string().min(1),
  speciesFilter: z.string().optional(),
  modelId: z.string().min(1),
  biovars: z.array(z.number().int().min(1).max(19)).min(2),
  projectionExtent: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-90).max(90),
  ]).refine(([xmin, xmax, ymin, ymax]) => xmin < xmax && ymin < ymax, {
    message: "Invalid extent: xmin must be < xmax and ymin must be < ymax",
  }).optional(),
  trainingExtent: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-90).max(90),
  ]).refine(([xmin, xmax, ymin, ymax]) => xmin < xmax && ymin < ymax, {
    message: "Invalid training extent: xmin must be < xmax and ymin must be < ymax",
  }).optional(),
  backgroundN: z.number().int().min(500).max(100000).default(10000),
  cvFolds: z.number().int().min(0).max(10).default(3),
  cvStrategy: z.enum(["random", "spatial_blocks"]).default("random"),
  cvBlockSizeKm: z.number().min(1).max(500).optional(),
  autoDownloadClimate: z.boolean().default(true),
  threshold: z.number().min(0.05).max(0.95).default(0.5),
  generateTiles: z.boolean().default(true),
  generateCog: z.boolean().default(true),
  maskType: z.enum(["none", "landmass", "ocean"]).optional().default("none"),
  maskAssetId: z.string().uuid().optional(),
  maskBufferDeg: z.number().min(0).optional(),
  maskBoundaryType: z.enum(["admin0", "land", "custom"]).optional().default("admin0"),
  maskResolution: z.enum(["auto", "10m", "50m", "110m"]).optional().default("auto"),
  maskCountry: z.string().optional().default("all"),
  restrictBackground: z.boolean().optional().default(false),
  includeQuadratic: z.boolean().default(true),
  useElevation: z.boolean().default(false),
  elevationDemtype: z.string().default("COP90"),
  useSoil: z.boolean().default(false),
  soilVars: z.array(z.string()).default(["sand", "clay", "phh2o"]),
  soilDepths: z.array(z.string()).default(["0-5cm", "30-60cm"]),
  useUv: z.boolean().default(false),
  uvVars: z.array(z.string()).default(["UVB1", "UVB2"]),
  useVegetation: z.boolean().default(false),
  vegYear: z.number().int().optional(),
  vegProducts: z.array(z.string()).default(["ndvi_annual_mean"]),
  useLulc: z.boolean().default(false),
  lulcYear: z.number().int().default(2020),
  useHfp: z.boolean().default(false),
  hfpYear: z.number().int().default(2020),
  useBioclimSeason: z.boolean().default(false),
  useDrought: z.boolean().default(false),
  futureProjection: z.boolean().default(false),
  futureLabel: z.string().default("Future climate"),
  futureProjection2: z.boolean().default(false).optional(),
  futureGcm: z.string().min(1).optional(),
  futureSsp: z.string().min(1).optional(),
  futurePeriod: z.string().min(1).optional(),
  futureGcm2: z.string().min(1).optional(),
  futureSsp2: z.string().min(1).optional(),
  futurePeriod2: z.string().min(1).optional(),
  futureClimateAssetId: z.string().uuid().optional(),
  futureClimateAssetId2: z.string().uuid().optional(),
  futureLabel2: z.string().default("Future climate 2").optional(),
  vifReduction: z.boolean().default(false),
  vifThreshold: z.number().min(1).max(20).default(10),
  climateMatching: z.boolean().default(false),
  climateMatchingMethod: z.enum(["mahalanobis", "standardised", "euclidean"]).default("mahalanobis"),
  extrapolationMask: z.boolean().default(true),
  messThreshold: z.number().default(0),
  thinByCell: z.boolean().default(true),
  mergeSmallSources: z.boolean().default(true),
  minSourceRecords: z.number().int().min(1).max(100).default(15),
  biasMethod: z.enum(["uniform", "target_group", "thickened"]).default("uniform"),
  thickeningDistanceKm: z.number().min(1).max(100).default(10),
  targetGroupAssetId: z.string().uuid().optional(),
  paReplicates: z.number().int().min(1).max(10).default(1),
  maxnetFeatures: z.enum(["l", "lq", "lqp", "lqh", "lqpht"]).default("lqp"),
  maxnetRegmult: z.number().min(0.1).max(10).default(1.0),
  tuningMethod: z.enum(["none", "enmeval"]).default("none").optional(),
  enmevalAlgorithm: z.enum(["maxnet", "bioclim"]).default("maxnet").optional(),
  enmevalPartitions: z.enum(["block", "checkerboard1", "checkerboard2", "randomkfold"]).default("block").optional(),
  enmevalSelectionMetric: z.enum(["auc.val.avg", "delta.AICc", "auc.diff.avg"]).default("auc.val.avg").optional(),
  enmevalTuneArgs: enmevalTuneArgsSchema.default({}).optional(),
  enmevalCategoricals: z.array(z.string()).optional(),
  enmevalNullIterations: z.number().int().min(10).max(1000).default(100).optional(),
  dnnArchitecture: z.enum(["DNN_Small", "DNN_Medium", "DNN_Large"]).default("DNN_Medium"),
  dnnNSeeds: z.number().int().min(1).max(20).default(5),
  dnnDevice: z.enum(["auto", "cpu", "gpu"]).default("auto"),
  hiddenLayers: z.array(z.number().int().min(1).max(4096)).min(1).max(10).optional(),
  batchSize: z.number().int().min(1).max(65536).optional(),
  predictBatchSize: z.number().int().min(1).max(262144).optional(),
  learningRate: z.number().finite().positive().max(1).optional(),
  pythonDevice: z.enum(["auto", "cpu", "cuda", "rocm", "mps"]).optional(),
  earlyStoppingPatience: z.number().int().min(0).max(1000).optional(),
  validationFraction: z.number().finite().min(0).max(0.9).optional(),
  nEstimators: z.number().int().min(1).max(10000).optional(),
  maxDepth: z.number().int().min(1).max(100).optional(),
  maxIterations: z.number().int().min(1).max(100000).optional(),
  dnnFusedAdam: z.enum(["auto", "always", "off"]).default("auto").optional(),
  brtNTrees: z.number().int().min(100).max(10000).default(2000),
  brtInteractionDepth: z.number().int().min(1).max(10).default(3),
  brtShrinkage: z.number().min(0.001).max(0.5).default(0.01),
  brtBagFraction: z.number().min(0.1).max(1).default(0.75),
  ctaCp: z.number().min(0.001).max(0.5).default(0.01),
  ctaMaxdepth: z.number().int().min(3).max(30).default(10),
  ctaMinsplit: z.number().int().min(2).max(100).default(20),
  marsDegree: z.number().int().min(1).max(5).default(2),
  marsPenalty: z.number().min(0).max(10).default(3.0),
  fdaDegree: z.number().int().min(1).max(5).default(2),
  annSize: z.number().int().min(2).max(50).default(5),
  annDecay: z.number().min(0.0001).max(1).default(0.01),
  annMaxit: z.number().int().min(50).max(1000).default(200),
  annRang: z.number().min(0.01).max(10).default(0.5),
  marsNk: z.number().int().min(1).max(100).optional(),
  fdaNprune: z.number().int().min(1).max(100).optional(),
  rfNumTrees: z.number().int().min(10).max(10000).default(500),
  rfMtry: z.number().int().min(1).max(100).optional(),
  rfMinNodeSize: z.number().int().min(1).max(100).default(10),
  xgbMaxDepth: z.number().int().min(1).max(20).default(6),
  xgbEta: z.number().min(0.001).max(1).default(0.3),
  xgbNrounds: z.number().int().min(10).max(10000).default(100),
  bartNtree: z.number().int().min(10).max(10000).default(200),
  bartNdpost: z.number().int().min(100).max(10000).default(1000),
  bartNskip: z.number().int().min(50).max(5000).default(500),
  brmsChains: z.number().int().min(1).max(8).default(4),
  brmsIter: z.number().int().min(500).max(10000).default(2000),
  brmsWarmup: z.number().int().min(100).max(5000).default(1000),
  inlaMeshMaxEdge: z.number().positive().optional(),
  inlaMeshCutoff: z.number().positive().optional(),
  inlaPriorRange: z.number().positive().optional(),
  inlaPriorSigma: z.number().positive().optional(),
  multiEnsembleModels: z.array(z.string()).optional(),
  multiEnsembleBiomod2: z.array(z.string()).optional(),
  multiEnsembleWeighting: z.enum(["equal", "auc", "tss"]).default("auc"),
  multiEnsemblePower: z.number().min(1).max(5).default(2),
  multiEnsembleMinAuc: z.number().min(0.5).max(1).default(0.7),
  multiEnsembleMinTss: z.number().min(0).max(1).default(0.5),
  rangebagNBags: z.number().int().min(10).max(1000).default(100),
  rangebagBagFraction: z.number().min(0.1).max(1).default(0.5),
  rangebagVarsPerBag: z.number().int().min(1).max(10).default(1),
  maxnetAutoTune: z.boolean().default(false),
  gamK: z.number().int().min(3).max(15).default(5),
  dnnDropout: z.number().min(0).max(0.5).default(0.3),
  dnnL2Lambda: z.number().min(0.0001).max(0.1).default(0.001),
  detectionFormula: z.string().default("~1"),
  detectionModelType: z.enum(["occu", "occuRN"]).default("occu"),
  dnnMultispeciesArchitecture: z.enum(["DNN_Small", "DNN_Medium", "DNN_Large"]).default("DNN_Medium"),
  dnnMultispeciesNSeeds: z.number().int().min(1).max(20).default(3),
  dnnMcSamples: z.number().int().min(0).max(100).default(0),
  dnnUncertaintyMethod: z.enum(["none", "mc_dropout", "heteroscedastic", "aleatoric_epistemic"]).default("none"),
  gpuEnabled: z.enum(["auto", "off"]).default("auto"),
  aggregationFactor: z.number().int().min(1).max(20).default(1),
  nCores: z.number().int().min(1).max(64).default(1),
  seed: z.number().int().default(42),
  occurrenceAssetId: z.string().uuid(),
  currentClimateAssetId: z.string().uuid().optional(),
  worldclimRes: z.number().default(10),
  source: z.enum(["worldclim", "chelsa"]).default("worldclim"),
  analysisCrs: z.string().default("auto"),
  chelsaExtras: z.array(z.string()).default([]),
  multiEnsembleExport: z.boolean().default(true).optional(),
  multiEnsembleUncertainty: z.boolean().default(true).optional(),
  biomod2Models: z.array(z.string()).optional(),
  esmNRuns: z.number().int().min(2).max(100).default(5).optional(),
  esmSplit: z.number().int().min(50).max(90).default(70).optional(),
  esmMinAuc: z.number().min(0.5).max(1).default(0.7).optional(),
  esmPower: z.number().min(0.5).max(5).default(1).optional(),
  esmWeightingMetric: z.enum(["AUC", "TSS"]).default("AUC").optional(),
  esmBiovars: z.array(z.number().int().min(1).max(19)).optional(),
  uvMonths: z.array(z.string()).default([]).optional(),
  droughtPeriods: z.array(z.string()).default(["annual_mean"]).optional(),
  xgbNRounds: z.number().int().min(50).max(500).default(100),
  gllvmFamily: z.enum(["binomial", "poisson", "negative.binomial"]).default("binomial"),
  gllvmNumLv: z.number().int().min(1).max(20).default(2),
  gllvmNumRows: z.number().int().min(0).max(2).default(0),
  gllvmLvCorr: z.boolean().default(false),
});

const modelConfigValidatedSchema = modelConfigObjectSchema.superRefine((config, context) => {
  if (!config.currentClimateAssetId) {
    context.addIssue({
      code: "custom",
      path: ["currentClimateAssetId"],
      message: "Executable model runs require an opaque current-climate asset ID",
    });
  }
  if (config.maskBoundaryType === "custom" && !config.maskAssetId) {
    context.addIssue({
      code: "custom",
      path: ["maskAssetId"],
      message: "Custom masking requires an opaque boundary asset ID",
    });
  }
  if (config.maskBoundaryType !== "custom" && config.maskAssetId) {
    context.addIssue({
      code: "custom",
      path: ["maskAssetId"],
      message: "Opaque boundary asset IDs are only valid for custom masking",
    });
  }
  if (config.biasMethod === "target_group" && !config.targetGroupAssetId) {
    context.addIssue({
      code: "custom",
      path: ["targetGroupAssetId"],
      message: "Target-group bias requires an opaque target-group asset ID",
    });
  }
  if (config.futureProjection && !config.futureClimateAssetId) {
    context.addIssue({
      code: "custom",
      path: ["futureClimateAssetId"],
      message: "Future projection requires an opaque climate collection asset ID",
    });
  }
  if (config.futureProjection2 && !config.futureClimateAssetId2) {
    context.addIssue({
      code: "custom",
      path: ["futureClimateAssetId2"],
      message: "Second future projection requires an opaque climate collection asset ID",
    });
  }
});

export const modelConfigSchema = z.preprocess(rejectForbiddenExecutionKeys, modelConfigValidatedSchema);

/** Draft/form validation intentionally omits executable asset-resolution requirements. */
export const modelConfigDraftSchema = z.preprocess(rejectForbiddenExecutionKeys, modelConfigObjectSchema);

export type ModelConfig = z.infer<typeof modelConfigSchema>;

/** Optional-field variant for internal payload projection of already-partial callers. */
export const modelConfigPartialSchema = z.preprocess(
  rejectForbiddenExecutionKeys,
  modelConfigObjectSchema.partial(),
);

export const modelRunSchema = z.object({
  id: z.string(),
  species: z.string(),
  modelId: z.string(),
  status: z.enum(["running", "completed", "failed", "queued"]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
  metrics: z.object({
    aucMean: z.number().nullable(),
    aucSd: z.number().nullable(),
    tssMean: z.number().nullable(),
    tssSd: z.number().nullable(),
    presenceRecords: z.number().nullable(),
    backgroundPoints: z.number().nullable(),
    elapsedSeconds: z.number().nullable(),
    highSuitabilityAreaKm2: z.number().nullable(),
    trainingAuc: z.number().nullable(),
    aucDiff: z.number().nullable(),
    overfittingLevel: z.string().nullable(),
    trainingCbi: z.number().nullable(),
    cvCbi: z.number().nullable(),
    cbiDiff: z.number().nullable(),
  }).nullable(),
  outputFiles: z.record(z.string()).nullable(),
  progressLog: z.array(z.string()).default([]),
});

export type ModelRun = z.infer<typeof modelRunSchema>;

export const occurrenceUploadSchema = z.object({
  filename: z.string(),
  speciesFilter: z.string().optional(),
  maxCoordinateUncertainty: z.number().optional(),
});

const targetsConfigObjectSchema = modelConfigObjectSchema.partial().extend({
  species: z.string().min(1),
  modelId: z.string().min(1),
  occurrenceAssetId: z.string().uuid(),
});

export const targetsConfigSchema = z.preprocess(
  rejectForbiddenExecutionKeys,
  targetsConfigObjectSchema,
);

export const targetsRunRequestSchema = z.preprocess(
  rejectForbiddenExecutionKeys,
  z.object({
    configs: z.array(targetsConfigSchema).min(1).max(50),
  }),
);

export const targetsStatusResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  n_species: z.number(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  error: z.string().nullable(),
  error_code: z.string().optional(),
  error_hint: z.string().optional(),
  targets_progress: z.object({
    total_targets: z.number(),
    completed: z.number(),
    errored: z.number(),
    running: z.number(),
    targets: z.array(z.object({
      name: z.string(),
      type: z.string(),
      status: z.string(),
      seconds: z.number().nullable(),
      error: z.string().nullable(),
    })),
  }).nullable(),
  progress_log: z.array(z.string()),
});

export type TargetsConfig = z.infer<typeof targetsConfigSchema>;
export type TargetsRunRequestSchema = z.infer<typeof targetsRunRequestSchema>;
export type TargetsStatusResponseSchema = z.infer<typeof targetsStatusResponseSchema>;
