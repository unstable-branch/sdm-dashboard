export const BIOVAR_CHOICES = [
  { id: 1, label: "BIO1", description: "Annual Mean Temperature" },
  { id: 2, label: "BIO2", description: "Mean Diurnal Range" },
  { id: 3, label: "BIO3", description: "Isothermality" },
  { id: 4, label: "BIO4", description: "Temperature Seasonality" },
  { id: 5, label: "BIO5", description: "Max Temperature of Warmest Month" },
  { id: 6, label: "BIO6", description: "Min Temperature of Coldest Month" },
  { id: 7, label: "BIO7", description: "Temperature Annual Range" },
  { id: 8, label: "BIO8", description: "Mean Temperature of Wettest Quarter" },
  { id: 9, label: "BIO9", description: "Mean Temperature of Driest Quarter" },
  { id: 10, label: "BIO10", description: "Mean Temperature of Warmest Quarter" },
  { id: 11, label: "BIO11", description: "Mean Temperature of Coldest Quarter" },
  { id: 12, label: "BIO12", description: "Annual Precipitation" },
  { id: 13, label: "BIO13", description: "Precipitation of Wettest Month" },
  { id: 14, label: "BIO14", description: "Precipitation of Driest Month" },
  { id: 15, label: "BIO15", description: "Precipitation Seasonality" },
  { id: 16, label: "BIO16", description: "Precipitation of Wettest Quarter" },
  { id: 17, label: "BIO17", description: "Precipitation of Driest Quarter" },
  { id: 18, label: "BIO18", description: "Precipitation of Warmest Quarter" },
  { id: 19, label: "BIO19", description: "Precipitation of Coldest Quarter" },
];

export const EXTENT_PRESETS: Record<string, { label: string; extent: [number, number, number, number] }> = {
  aus_full: { label: "Australia - full", extent: [112, 154, -44, -10] },
  aus_north: { label: "Northern Australia", extent: [112, 154, -26, -10] },
  aus_east: { label: "Eastern Australia", extent: [138, 154, -44, -10] },
  australia_sw: { label: "SW Australia", extent: [113, 125, -35, -21] },
  oceania: { label: "Oceania", extent: [100, 180, -48, -6] },
  southeast_asia: { label: "Southeast Asia", extent: [92, 142, -12, 22] },
  south_america: { label: "South America", extent: [-82, -34, -56, 13] },
  africa: { label: "Africa", extent: [-18, 52, -35, 38] },
  europe: { label: "Europe", extent: [-10, 40, 35, 60] },
  north_america: { label: "North America", extent: [-130, -60, 20, 52] },
  world: { label: "Full world", extent: [-180, 180, -90, 90] },
};

export const MODEL_BACKENDS = [
  // Tier 1 — Core Standards (always available or very common)
  { id: "glm", label: "GLM / Logistic Regression", maturity: "stable" as const, min_records: 15, available: true },
  { id: "gam", label: "GAM / Smooth Response Curves", maturity: "stable" as const, min_records: 20, available: true },
  { id: "maxnet", label: "MaxEnt (maxnet)", maturity: "stable" as const, min_records: 10, available: false, notes: "Requires maxnet package" },
  { id: "rf", label: "Random Forest (ranger)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires ranger package" },
  { id: "brt", label: "BRT / Boosted Regression Trees (gbm)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires gbm package" },
  { id: "xgboost", label: "XGBoost / Gradient Boosting", maturity: "experimental" as const, min_records: 30, available: false, notes: "Requires xgboost package" },

  // Tier 2 — Interpretable / Dependency-Free
  { id: "rangebag", label: "Rangebagging", maturity: "experimental" as const, min_records: 15, available: true },
  { id: "mars", label: "MARS / Multivariate Adaptive Regression Splines (earth)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires earth package" },
  { id: "ann", label: "ANN / Artificial Neural Network (nnet)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires nnet package" },
  { id: "cta", label: "CTA / Classification Tree Analysis (rpart)", maturity: "experimental" as const, min_records: 15, available: false, notes: "Requires rpart package" },
  { id: "fda", label: "FDA / Flexible Discriminant Analysis (mda)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires mda + earth packages" },

  // Tier 3 — Ensembles
  { id: "ensemble_glm_rangebag", label: "Ensemble (GLM + Rangebagging)", maturity: "experimental" as const, min_records: 15, available: true },
  { id: "multi_ensemble", label: "Multi-Model Ensemble", maturity: "experimental" as const, min_records: 20, available: true, notes: "Select 2+ models from GLM, GAM, MaxNet, Rangebagging, and biomod2 algorithms. biomod2 requires options(sdm.enable_biomod2 = TRUE)." },
  { id: "dnn", label: "DNN / Deep Neural Network (cito/torch)", maturity: "experimental" as const, min_records: 50, available: false, notes: "Requires cito + torch packages (R-side hard block at 50 records)" },
  { id: "bioclim", label: "BIOCLIM / Mahalanobis Envelope", maturity: "experimental" as const, min_records: 5, available: true, notes: "Presence-only environmental envelope" },

  // Tier 4 — Rare Species
  { id: "esm_glm", label: "ESM — GLM (Rare Species)", maturity: "experimental" as const, min_records: 5, available: false, notes: "Requires ecospat + biomod2 packages" },
  { id: "esm_maxnet", label: "ESM — MaxEnt (Rare Species)", maturity: "experimental" as const, min_records: 5, available: false, notes: "Requires ecospat + biomod2 + maxnet packages" },
  { id: "biomod2", label: "biomod2 / Multi-Algorithm Ensemble", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires biomod2 package + sdm.enable_biomod2 option" },

  // Tier 5 — Bayesian / Heavy
  { id: "bart", label: "BART / Bayesian Additive Regression Trees (dbarts)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires dbarts package" },
  { id: "brms", label: "brms / General Bayesian Model (Stan)", maturity: "experimental" as const, min_records: 30, available: false, notes: "Requires brms + cmdstanr packages (compilation: 5-15 min)" },
  { id: "inla_spde", label: "INLA / Bayesian Spatial Model (SPDE)", maturity: "experimental" as const, min_records: 20, available: false, notes: "Requires INLA package (install from r-inla-download.org)" },

  // Tier 6 — Niche / Specialised
  { id: "occupancy", label: "Occupancy Model (unmarked)", maturity: "experimental" as const, min_records: 10, available: false, notes: "Requires unmarked package + detection-history data" },
  { id: "dnn_multispecies", label: "Multi-Species DNN (cito)", maturity: "experimental" as const, min_records: 5, available: false, notes: "Requires cito + torch. Predicts 2+ species simultaneously with shared covariates." },
  { id: "python_elapid", label: "Elapid — Python MaxEnt", maturity: "experimental" as const, min_records: 10, available: false, notes: "Requires Python + elapid package" },
  { id: "python_sklearn_rf", label: "Scikit-Learn Random Forest (Python)", maturity: "experimental" as const, min_records: 15, available: false, notes: "Requires Python + scikit-learn package" },
];

export const MODEL_TIERS: Record<string, string> = {
  glm: "Core Standards",
  gam: "Core Standards",
  maxnet: "Core Standards",
  rf: "Core Standards",
  brt: "Core Standards",
  xgboost: "Core Standards",
  rangebag: "Dependency-Free",
  mars: "Dependency-Free",
  ann: "Dependency-Free",
  cta: "Dependency-Free",
  fda: "Dependency-Free",
  ensemble_glm_rangebag: "Ensembles",
  multi_ensemble: "Ensembles",
  dnn: "Ensembles",
  bioclim: "Ensembles",
  esm_glm: "Rare Species",
  esm_maxnet: "Rare Species",
  biomod2: "Rare Species",
  bart: "Bayesian / Heavy",
  brms: "Bayesian / Heavy",
  inla_spde: "Bayesian / Heavy",
  occupancy: "Specialised",
  dnn_multispecies: "Specialised",
  python_elapid: "Specialised",
  python_sklearn_rf: "Specialised",
};

export const TIER_ORDER = [
  "Core Standards",
  "Dependency-Free",
  "Ensembles",
  "Rare Species",
  "Bayesian / Heavy",
  "Specialised",
];

const TIER_SORT_ORDER: Record<string, number> = {};
TIER_ORDER.forEach((t, i) => { TIER_SORT_ORDER[t] = i; });

export function tierSortKey(tier: string | undefined): number {
  return tier ? TIER_SORT_ORDER[tier] ?? 99 : 99;
}

export const SOIL_VARS = [
  { id: "bdod", label: "Bulk density" },
  { id: "cfvo", label: "Coarse fragments" },
  { id: "clay", label: "Clay content" },
  { id: "nitrogen", label: "Nitrogen" },
  { id: "soc", label: "Soil organic carbon" },
  { id: "phh2o", label: "pH (water)" },
  { id: "sand", label: "Sand content" },
  { id: "silt", label: "Silt content" },
  { id: "cec", label: "CEC" },
];

export const SOIL_DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm"];

export const UV_VARS = [
  { id: "UVB1", label: "UVB1 Annual Mean" },
  { id: "UVB2", label: "UVB2 Seasonality" },
  { id: "UVB3", label: "UVB3 Highest Month" },
  { id: "UVB4", label: "UVB4 Lowest Month" },
  { id: "UVB5", label: "UVB5 Highest Quarter" },
  { id: "UVB6", label: "UVB6 Lowest Quarter" },
];

export const DEM_CHOICES = ["COP90", "SRTMGL3", "AW3D30", "SRTMGL1"];

export const CHELSA_EXTRA_CHOICES = [
  { id: "gdd5", label: "GDD5", description: "Growing degree days (5°C base)" },
  { id: "gdd10", label: "GDD10", description: "Growing degree days (10°C base)" },
  { id: "gsl", label: "GSL", description: "Growing season length" },
  { id: "fcf", label: "FCF", description: "Frost change frequency" },
  { id: "npp", label: "NPP", description: "Net primary productivity" },
  { id: "scd", label: "SCD", description: "Snow cover duration" },
];

export const ANALYSIS_CRS_CHOICES = [
  { id: "auto", label: "Auto-detect (UTM zone)", description: "Best for local-scale analyses" },
  { id: "eqearth", label: "Equal Earth", description: "Global equal-area projection" },
  { id: "laea", label: "Lambert Azimuthal Equal-Area", description: "Good for mid-latitude regions" },
  { id: "aeqd", label: "Azimuthal Equidistant", description: "Accurate distances from center point" },
  { id: "moll", label: "Mollweide", description: "Global equal-area, good for climate data" },
  { id: "eqc", label: "Equidistant Cylindrical", description: "Simple global projection" },
];

export const GCM_CHOICES = [
  { id: "UKESM1-0-LL", label: "UKESM1-0-LL", description: "UK Earth System Model" },
  { id: "MPI-ESM1-2-HR", label: "MPI-ESM1-2-HR", description: "Max Planck Institute" },
  { id: "IPSL-CM6A-LR", label: "IPSL-CM6A-LR", description: "Institut Pierre-Simon Laplace" },
  { id: "MRI-ESM2-0", label: "MRI-ESM2-0", description: "Meteorological Research Institute" },
  { id: "GFDL-ESM4", label: "GFDL-ESM4", description: "Geophysical Fluid Dynamics Laboratory" },
];

export const SSP_CHOICES = [
  { id: "SSP1-2.6", label: "SSP1-2.6", description: "Low emissions" },
  { id: "SSP2-4.5", label: "SSP2-4.5", description: "Intermediate (default)" },
  { id: "SSP3-7.0", label: "SSP3-7.0", description: "High emissions" },
  { id: "SSP5-8.5", label: "SSP5-8.5", description: "Very high emissions" },
];

export const TIME_PERIOD_CHOICES = [
  { id: "2021-2040", label: "2021-2040", description: "Near future" },
  { id: "2041-2060", label: "2041-2060", description: "Mid century (default)" },
  { id: "2061-2080", label: "2061-2080", description: "End of century" },
  { id: "2081-2100", label: "2081-2100", description: "Long term" },
];

export const SSP_CODE_MAP: Record<string, string> = {
  "SSP1-2.6": "126",
  "SSP2-4.5": "245",
  "SSP3-7.0": "370",
  "SSP5-8.5": "585",
};

export const DEFAULT_CONFIG = {
  biovars: [1, 4, 6, 12, 15, 18],
  backgroundN: 3000,
  cvFolds: 3,
  cvStrategy: "spatial_blocks" as const,
  threshold: 0.5,
  nCores: 1,
  seed: 42,
  minSourceRecords: 15,
  aggregationFactor: 1,
  paReplicates: 1,
  biasMethod: "uniform" as const,
  thickeningDistanceKm: 10,
  maxnetFeatures: "lqp" as const,
  maxnetRegmult: 1.0,
  dnnArchitecture: "DNN_Medium" as const,
  dnnNSeeds: 5,
  dnnDropout: 0.3,
  dnnL2Lambda: 0.001,
  generateTiles: true,
  generateCog: true,
  dnnDevice: "auto" as const,
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
  annRang: 0.5,
  marsNk: undefined,
  fdaNprune: undefined,
  rfNumTrees: 500,
  rfMtry: undefined,
  rfMinNodeSize: 10,
  xgbMaxDepth: 6,
  xgbEta: 0.3,
  xgbNrounds: 100,
  maxnetAutoTune: false,
  gamK: 5,
  bartNtree: 200,
  bartNdpost: 1000,
  bartNskip: 500,
  brmsChains: 4,
  brmsIter: 2000,
  brmsWarmup: 1000,
  inlaMeshMaxEdge: undefined,
  inlaMeshCutoff: undefined,
  inlaPriorRange: undefined,
  inlaPriorSigma: undefined,
  rangebagNBags: 100,
  rangebagBagFraction: 0.5,
  rangebagVarsPerBag: 1,
  detectionFormula: "~1",
  detectionModelType: "occu" as const,
  dnnMultispeciesArchitecture: "DNN_Medium" as const,
  dnnMultispeciesNSeeds: 3,
  worldclimRes: 10,
  source: "worldclim" as const,
  elevationDemtype: "COP90",
  soilVars: ["sand", "clay", "phh2o"],
  soilDepths: ["0-5cm", "30-60cm"],
  uvVars: ["UVB1", "UVB2"],
  vegProducts: ["ndvi_annual_mean"],
  lulcYear: 2020,
  hfpYear: 2020,
  vifThreshold: 10,
  projectionExtent: [112, 154, -44, -10] as [number, number, number, number],
  climateMatchingMethod: "mahalanobis" as const,
  xgbNRounds: 100,
};

/**
 * Build the WorldClim future directory path from GCM, SSP, and period.
 * Convention: Worldclim_future/{GCM}_{SSP}_{period}
 * Example: Worldclim_future/UKESM1-0-LL_SSP2-4.5_2041-2060
 */
export function buildFutureWorldclimPath(gcm: string, ssp: string, period: string): string {
  return `Worldclim_future/${gcm}_${ssp}_${period}`;
}

/**
 * Extract progress percentage from a log line.
 * Log format: "HH:MM:SS [42%] Some message"
 * Returns the percentage as a number (0-100), or undefined if not found.
 */
export function extractProgressPercent(logLine: string): number | undefined {
  const m = logLine.match(/\[(\d+)%\]/);
  return m ? Math.min(100, parseInt(m[1], 10)) : undefined;
}

/**
 * Extract the current stage/message from a log line.
 * Strips timestamp and progress marker, returns the remaining text.
 * Returns null if the line is too short to be meaningful.
 */
export function extractStage(logLine: string): string | null {
  const withoutTimestamp = logLine.replace(/^\d{2}:\d{2}:\d{2}\s*/, "");
  const withoutProgress = withoutTimestamp.replace(/\[\d+%\]\s*/, "");
  const trimmed = withoutProgress.trim();
  if (!trimmed || trimmed.length < 3) return null;
  return trimmed;
}
