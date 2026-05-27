// ── Frontend Type Definitions ─────────────────────────────────────────────
// SOURCE OF TRUTH: @sdm/shared (camelCase types in packages/shared/src/types.ts)
//
// This file provides snake_case re-exports matching Plumber API responses.
// New components should import directly from @sdm/shared and use camelCase.
// Existing components continue to work unchanged via these re-exports.
//
// Migration: when adding a new field, add it to @sdm/shared first,
// then add the snake_case alias here if the Plumber API returns it.
//
// Types that are purely UI state (not from the API) are defined here.

import type {
  CurvePoint,
  CurveData,
  CbiBin,
  CvFoldEntry,
  ThresholdEntry,
  ThresholdData,
  DensityData,
} from "@sdm/shared";

// ── API types that directly mirror Plumber snake_case ──────────────────────

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

// ── Diagnostic types — re-exported from @sdm/shared with snake_case ────────
// These alias the camelCase canonical types. Add snake_case fields here as
// needed for Plumber API compatibility.

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

// Types with matching field names (same in snake_case and camelCase)
// These are direct re-exports from @sdm/shared
export type { CurvePoint, CurveData, CvFoldEntry, ThresholdEntry, ThresholdData, DensityData };

// Calibration types — Plumber returns snake_case, must be defined locally
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

// ── UI-only types (not from Plumber API) ───────────────────────────────────

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