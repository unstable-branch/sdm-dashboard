// Auto-generated type contracts for Plumber API responses.
// These match the Plumber endpoint return shapes known from the R code.
// Regenerate by running against a live Plumber instance:
//   npx tsx api/scripts/generate-plumber-types.ts

// ── Health ──────────────────────────────────────────────────────────────────
export interface PlumberHealthResponse {
  status: string;
  r_version: string;
  timestamp: string;
}

// ── Model run ───────────────────────────────────────────────────────────────
export interface PlumberRunResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface PlumberStatusResponse {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  error_code?: string;
  error_hint?: string;
  error_traceback: string | null;
  metrics: Record<string, unknown> | null;
  output_files: Record<string, string> | null;
  r_cpu_time_ms: number | null;
  r_peak_memory_mb: number | null;
  progress_log: string[];
  progress_json: Array<{ timestamp: string; percent: number; detail: string; stage: string }> | null;
}

export interface PlumberModelInfo {
  id: string;
  label: string;
  maturity: string;
  min_records: number | null;
  packages: string[];
  notes: string;
  complexity_tier: string;
}

// ── Occurrences ─────────────────────────────────────────────────────────────
export interface PlumberUploadResponse {
  file_id: string;
  file_path: string;
  filename: string;
  format: string;
  n_rows: number;
  species_detected: string | null;
  columns_detected: Record<string, string | null>;
  coord_warnings?: string[];
  preview: Array<Record<string, unknown>>;
}

export interface PlumberCleanResponse {
  cleaned_id: string;
  cleaned_file_id: string;
  valid_records: number;
  original_rows: number;
  removed_bad_coordinates: number;
  removed_duplicates: number;
  n_absent_excluded: number;
  source_counts: Record<string, number>;
  species_counts?: Record<string, number>;
  cc_flagged: number;
  training_extent: Array<Array<number>>;
  cleaned_records: Array<Record<string, unknown>>;
}

// ── Climate ─────────────────────────────────────────────────────────────────
export interface PlumberClimateScenario {
  id: string;
  type: string;
  gcm?: string;
  ssp?: string;
  period?: string;
  file_count: number;
  size_bytes: number;
  is_averaged?: boolean;
  source?: string;
}

export interface PlumberClimateStatus {
  job_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

// ── Diagnostics ────────────────────────────────────────────────────────────
export interface PlumberDiagnosticsVif {
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

export interface PlumberDiagnosticsImportance {
  available: boolean;
  message?: string;
  n_variables?: number;
  importance?: Array<{ variable: string; importance: number; sd: number; baseline: number }>;
  error?: string;
}

export interface PlumberDiagnosticsResponseCurves {
  available: boolean;
  message?: string;
  n_curves?: number;
  curves?: Array<{ covariate: string; points: Array<{ value: number; suitability: number }> }>;
  error?: string;
}

export interface PlumberDiagnosticsAle {
  available: boolean;
  message?: string;
  n_curves?: number;
  curves?: Array<{ covariate: string; points: Array<{ value: number; ale: number }> }>;
  error?: string;
}

export interface PlumberDiagnosticsShapCell {
  available: boolean;
  prediction?: number;
  shap?: Array<{ variable: string; value: number; shap_value: number }>;
  message?: string;
  error?: string;
}

export interface PlumberDiagnosticsClimateDrivers {
  available: boolean;
  has_future_projection?: boolean;
  summary?: {
    mean_delta: number;
    sd_delta: number;
    min_delta: number;
    max_delta: number;
    pct_loss: number;
    pct_gain: number;
    pct_stable: number;
    n_cells: number;
  };
  message?: string;
}

// ── Manifest ────────────────────────────────────────────────────────────────
export interface PlumberManifestResponse {
  ok: boolean;
  manifest_path: string;
  manifest: Record<string, unknown>;
}

// ── Error ──────────────────────────────────────────────────────────────────
export interface PlumberErrorResponse {
  error: string;
  error_code?: string;
  error_hint?: string;
}

// ── Targets pipeline ────────────────────────────────────────────────────────
export interface TargetsRunRequest {
  configs: Array<{
    species: string;
    model_id: string;
    occurrence_file?: string;
    cleaned_file_id?: string;
    biovars?: string;
    projection_extent?: string;
    background_n?: number;
    cv_folds?: number;
    threshold?: number;
    species_filter?: string;
  }>;
}

export interface TargetsRunResponse {
  job_id: string;
  status: string;
  n_species: number;
  message: string;
}

export interface TargetsStatusResponse {
  id: string;
  status: string;
  n_species: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  error_code?: string;
  error_hint?: string;
  targets_progress: {
    total_targets: number;
    completed: number;
    errored: number;
    running: number;
    targets: Array<{
      name: string;
      type: string;
      status: string;
      seconds: number | null;
      error: string | null;
    }>;
  } | null;
  progress_log: string[];
}

export interface TargetsResultEntry {
  name: string;
  status: string;
  error: string | null;
  metrics: {
    auc_mean: number | null;
    auc_sd: number | null;
    tss_mean: number | null;
    tss_sd: number | null;
    cbi: number | null;
    presence_records: number | null;
    elapsed_seconds: number | null;
  } | null;
}

export interface TargetsResultsResponse {
  id: string;
  status: string;
  n_species: number;
  species: string[];
  results: Record<string, TargetsResultEntry>;
}

// ── Config defaults ─────────────────────────────────────────────────────────
export interface PlumberConfigDefaults {
  biovars: number[];
  backgroundN: number;
  cvFolds: number;
  cvStrategy: string;
  threshold: number;
  nCores: number;
  seed: number;
  extentPresets: Record<string, number[]>;
}
