// ── Frontend Type Definitions ─────────────────────────────────────────────
// SOURCE OF TRUTH: @sdm/shared (camelCase types in packages/shared/src/types.ts)
//
// Re-exports from @sdm/shared for types without naming conflicts.
// Frontend retains snake_case versions matching Plumber API responses.

import type {
  CurvePoint,
  CurveData,
  CbiBin,
  CvFoldEntry,
} from "@sdm/shared";

export type {
  ThresholdData,
  DensityData,
  PlumberStatusResponse,
  PlumberRunResponse,
  PlumberUploadResponse,
  PlumberCleanResponse,
  PlumberModelInfo,
  PlumberConfigDefaults,
  PlumberClimateScenario,
  PlumberManifestResponse,
  PlumberErrorResponse,
  PlumberHealthResponse,
  PlumberDiagnosticsVif,
  PlumberDiagnosticsImportance,
  PlumberDiagnosticsResponseCurves,
  PlumberDiagnosticsAle,
  PlumberDiagnosticsShapCell,
  PlumberDiagnosticsClimateDrivers,
  BiovarChoice,
  ModelBackend,
  Species,
  RunMetrics,
  JobStatus,
  OccurrenceRecord,
  PaginationInfo,
  ClimateScenario,
  Project,
  User,
  ApiKey,
} from "@sdm/shared";

// ── API response types — snake_case to match Plumber API ──────────────────

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
  error_code?: string | null;
  error_hint?: string | null;
  config?: Record<string, unknown>;
  provenance?: Record<string, unknown> | null;
}

// Types with matching field names — direct re-exports from @sdm/shared
export type { CurvePoint, CurveData, CvFoldEntry };

// ── Diagnostics types — snake_case from Plumber ───────────────────────────

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

export type BinEntry = CbiBin;

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

export interface ResponseCurvesData {
  available: boolean;
  message?: string;
  n_curves?: number;
  curves?: CurveData[];
  error?: string;
}

export interface RocData {
  available: boolean;
  message?: string;
  auc?: number;
  auc_sd?: number;
  fpr?: number[];
  tpr?: number[];
  error?: string;
}

export interface CalibrationBin {
  bin_mid: number;
  observed_freq: number;
  count: number;
}

export interface CalibrationData {
  available: boolean;
  message?: string;
  bins?: CalibrationBin[];
  error?: string;
}

export interface CvFoldsData {
  available: boolean;
  message?: string;
  auc_mean?: number;
  auc_sd?: number;
  tss_mean?: number;
  tss_sd?: number;
  folds?: CvFoldEntry[];
  error?: string;
}

export interface EooAooData {
  eoo_km2: number | null;
  aoo_cells: number | null;
  aoo_km2: number | null;
  eoo_method: string | null;
  iucn_eoo_status: string | null;
}

export interface SpeciesSummary {
  id: string;
  name: string;
  occurrence_count: number | null;
  created_at: string;
}

// ── Frontend-only types (not from Plumber API) ────────────────────────────

export interface BatchJob {
  id: string;
  species: string;
  model_id: string;
  status: string;
  metrics?: Record<string, unknown> | null;
}
