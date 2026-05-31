export interface BiovarChoice {
  id: number;
  label: string;
  description: string;
}

export interface ModelBackend {
  id: string;
  label: string;
  method: string;
  maturity: "stable" | "experimental" | "deprecated";
  supportsImportance: boolean;
  supportsUncertainty: boolean;
  supportsFuture: boolean;
  minRecords: number | null;
}

export interface Species {
  id: string;
  name: string;
  createdAt: string;
  occurrenceCount: number;
}

export interface Run {
  id: string;
  speciesId: string;
  modelId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  config: import("./schemas").ModelConfig;
  metrics: RunMetrics | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunMetrics {
  auc_mean: number | null;
  auc_sd: number | null;
  tss_mean: number | null;
  tss_sd: number | null;
  cbi: number | null;
  presence_records: number | null;
  background_points: number | null;
  elapsed_seconds: number | null;
  high_suitability_area_km2: number | null;
  high_suitability_area_uncertainty_km2: number | null;
  high_suitability_area_ci95_lower: number | null;
  high_suitability_area_ci95_upper: number | null;
}

export interface JobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  progressLabel: string;
  logs: string[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// --- Frontend-facing types migrated from frontend/services/types.ts ---

export interface VifData {
  available: boolean;
  message?: string;
  selected?: string[];
  dropped?: string[];
  vifFinal?: number;
  vifHistory?: Array<{ iteration: number; variableRemoved: string; maxVif: number }>;
  allVars?: string[];
  varMeans?: Record<string, number>;
  varSds?: Record<string, number>;
  error?: string;
}

export interface ImportanceEntry {
  variable: string;
  importance: number;
  sd: number;
  baseline: number;
}

export interface ImportanceData {
  available: boolean;
  message?: string;
  nVariables?: number;
  importance?: ImportanceEntry[];
  error?: string;
}

export interface CurvePoint {
  value: number;
  suitability: number;
}

export interface CurveData {
  covariate: string;
  points: CurvePoint[];
}

export interface ResponseCurvesData {
  available: boolean;
  message?: string;
  nCurves?: number;
  curves?: CurveData[];
  error?: string;
}

export interface CbiBin {
  binMid: number;
  ratio: number;
  smoothed: number;
}

export interface CbiData {
  available: boolean;
  message?: string;
  cbi?: number;
  peRatio?: number;
  nBins?: number;
  bins?: CbiBin[];
  note?: string | null;
  error?: string;
}

export interface MessData {
  available: boolean;
  message?: string;
  messTif?: string;
  modTif?: string;
  pctExtrapolation?: number | null;
  hasFutureProjection?: boolean;
  error?: string;
}

export interface DiagnosticsSummary {
  runId: string;
  species: string;
  modelId: string;
  diagnostics: {
    vif: { available: boolean; enabled: boolean };
    responseCurves: { available: boolean };
    variableImportance: { available: boolean };
    cbi: { available: boolean };
    mess: { available: boolean };
  };
  metrics: {
    aucMean: number | null;
    aucSd: number | null;
    tssMean: number | null;
    tssSd: number | null;
    presenceRecords: number | null;
    backgroundPoints: number | null;
  };
  files: Record<string, string | null>;
}

export interface NicheOverlapResult {
  runId1: string;
  runId2: string;
  species1: string;
  species2: string;
  d: number;
  i: number;
  stability: number;
  unfilling: number;
  expansion: number;
  centroidDistance: number;
  nNative: number;
  nIntroduced: number;
}

export interface RocData {
  available: boolean;
  message?: string;
  auc?: number;
  aucSd?: number;
  fpr?: number[];
  tpr?: number[];
  error?: string;
}

export interface CalibrationBin {
  binMid: number;
  observedFreq: number;
  count: number;
}

export interface CalibrationData {
  available: boolean;
  message?: string;
  bins?: CalibrationBin[];
  error?: string;
}

export interface CvFoldEntry {
  fold: number;
  auc: number;
  tss: number;
}

export interface CvFoldsData {
  available: boolean;
  message?: string;
  aucMean?: number;
  aucSd?: number;
  tssMean?: number;
  tssSd?: number;
  folds?: CvFoldEntry[];
  error?: string;
}

export interface ThresholdEntry {
  threshold: number;
  sensitivity: number;
  specificity: number;
  tss: number;
}

export interface ThresholdData {
  available: boolean;
  message?: string;
  thresholds?: ThresholdEntry[];
  error?: string;
}

export interface DensityData {
  available: boolean;
  message?: string;
  presence?: { x: number[]; y: number[] };
  background?: { x: number[]; y: number[] };
  error?: string;
}

export interface EooAooData {
  eooKm2: number | null;
  aooCells: number | null;
  aooKm2: number | null;
  eooMethod: string | null;
  iucnEooStatus: string | null;
}

// ── Frontend-facing API response types (camelCase canonical forms) ──────────

export interface RunSummary {
  id: string;
  species: string;
  modelId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  metrics: Record<string, unknown> | null;
  outputFiles: Record<string, string> | null;
}

export interface RunDetail extends RunSummary {
  progressLog: string[];
  error: string | null;
  errorCode?: string | null;
  errorHint?: string | null;
  config?: Record<string, unknown>;
  provenance?: Record<string, unknown> | null;
}

export interface SpeciesSummary {
  id: string;
  name: string;
  occurrenceCount: number | null;
  createdAt: string;
}

export interface OccurrenceRecord {
  id: string;
  longitude: number;
  latitude: number;
  source?: string;
  date?: string;
  [key: string]: unknown;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ClimateScenario {
  id: string;
  type: string;
  gcm?: string;
  ssp?: string;
  period?: string;
  source?: string;
  path?: string;
  fileCount: number;
  sizeBytes: number;
  isAveraged?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  role: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}
