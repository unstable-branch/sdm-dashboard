// ── Frontend Type Definitions ─────────────────────────────────────────────
// SOURCE OF TRUTH: @sdm/shared (camelCase types in packages/shared/src/types.ts)
//
// This file provides snake_case versions matching Plumber API responses.
// New components should import directly from @sdm/shared and use camelCase.
// Existing components continue to work unchanged via these aliases.
//
// When adding a new field: add the camelCase type to @sdm/shared first,
// then add the snake_case alias here if the Plumber API returns it.
//
// UI-only types that are never returned by the API are defined here.

import type {
  CurvePoint,
  CurveData,
  CbiBin,
  CvFoldEntry,
  ThresholdEntry,
  ThresholdData,
  DensityData,
  ClimateScenario,
  Project,
  User,
  ApiKey,
} from "@sdm/shared";

// ── API types — snake_case to match Plumber API responses ──────────────────

// Per-run summary from the runs list — snake_case mirrors Plumber response
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
  provenance?: {
    app_version?: Record<string, unknown>;
    model?: Record<string, unknown>;
    data?: Record<string, unknown>;
    validation?: Record<string, unknown>;
  } | null;
}

// Types with matching field names — direct re-exports from @sdm/shared
export type { CurvePoint, CurveData, CvFoldEntry, ThresholdEntry, ThresholdData, DensityData };

// Snake_case diagnostic types matching Plumber API responses
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

export interface ResponseCurvesData {
  available: boolean;
  message?: string;
  n_curves?: number;
  curves?: CurveData[];
  error?: string;
}

export interface BinEntry extends CbiBin {}

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

export interface RocData {
  available: boolean;
  message?: string;
  auc?: number;
  auc_sd?: number;
  fpr?: number[];
  tpr?: number[];
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

// UI-only types (never returned by Plumber API)
export type { ClimateScenario, Project, User, ApiKey };
