export interface RunSummary {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  metrics: Record<string, unknown> | null;
  output_files: Record<string, string> | null;
}

export interface RunDetail extends RunSummary {
  progress_log: string[];
  error: string | null;
  config?: Record<string, unknown>;
}

export interface SpeciesSummary {
  id: string;
  name: string;
  occurrence_count: number | null;
  created_at: string;
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

export interface VifData {
  available: boolean;
  message?: string;
  selected?: string[];
  dropped?: string[];
  vif_final?: number;
  vif_history?: Array<{ iteration: number; variable_removed: string; max_vif: number }>;
  all_vars?: string[];
  var_means?: Record<string, number>;
  var_sds?: Record<string, number>;
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
  n_variables?: number;
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
  n_curves?: number;
  curves?: CurveData[];
  error?: string;
}

export interface BinEntry {
  bin_mid: number;
  ratio: number;
  smoothed: number;
}

export interface CbiData {
  available: boolean;
  message?: string;
  cbi?: number;
  pe_ratio?: number;
  n_bins?: number;
  bins?: BinEntry[];
  note?: string | null;
  error?: string;
}

export interface MessData {
  available: boolean;
  message?: string;
  mess_tif?: string;
  mod_tif?: string;
  pct_extrapolation?: number | null;
  has_future_projection?: boolean;
  error?: string;
}

export interface DiagnosticsSummary {
  run_id: string;
  species: string;
  model_id: string;
  diagnostics: {
    vif: { available: boolean; enabled: boolean };
    response_curves: { available: boolean };
    variable_importance: { available: boolean };
    cbi: { available: boolean };
    mess: { available: boolean };
  };
  metrics: {
    auc_mean: number | null;
    auc_sd: number | null;
    tss_mean: number | null;
    tss_sd: number | null;
    presence_records: number | null;
    background_points: number | null;
  };
  files: Record<string, string | null>;
}

export interface NicheOverlapResult {
  run_id_1: string;
  run_id_2: string;
  species_1: string;
  species_2: string;
  D: number;
  I: number;
  stability: number;
  unfilling: number;
  expansion: number;
  centroid_distance: number;
  n_native: number;
  n_introduced: number;
}

export interface ClimateScenario {
  id: string;
  type: string;
  gcm?: string;
  ssp?: string;
  period?: string;
  source?: string;
  path?: string;
  file_count: number;
  size_bytes: number;
  is_averaged?: boolean;
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
