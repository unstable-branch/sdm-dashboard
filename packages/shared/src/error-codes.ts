// ── Error Code Taxonomy ────────────────────────────────────────────────
// Mirrors plumber/R/error_codes.R:SDM_ERR_CODES
// Used by API to map error_codes to HTTP status codes and by frontend
// to display actionable hints.

export const SDM_ERR_MAP: Record<string, { httpStatus: number; message: string; hint: string }> = {
  INSUFFICIENT_RECORDS: {
    httpStatus: 400,
    message: "Insufficient occurrence records for the selected model",
    hint: "Upload more occurrence data or choose a simpler model that requires fewer records",
  },
  EXTRAPOLATION_VIOLATED: {
    httpStatus: 400,
    message: "Projection extent exceeds the training data extent",
    hint: "Reduce the projection extent to overlap with the training area, or enable extrapolation if appropriate",
  },
  COVARIATE_COLLINEAR: {
    httpStatus: 400,
    message: "Selected covariates are collinear (VIF above threshold)",
    hint: "Reduce the VIF threshold, deselect correlated covariates, or enable VIF-based reduction",
  },
  OOM_PREDICTION: {
    httpStatus: 500,
    message: "Out of memory during raster prediction",
    hint: "Reduce raster resolution (worldclim_res), use a smaller projection extent, or increase available memory",
  },
  PERFECT_SEPARATION: {
    httpStatus: 400,
    message: "Perfect separation detected — predictor perfectly divides presence and background",
    hint: "Remove the perfectly separating covariate, add more background points, or use a regularised model (maxnet)",
  },
  PLUMBER_TIMEOUT: {
    httpStatus: 504,
    message: "R computation exceeded the maximum allowed time",
    hint: "Simplify the model (fewer covariates, lower resolution) or increase the timeout limit",
  },
  DNN_INSTALLATION: {
    httpStatus: 503,
    message: "Deep Neural Network backend requires cito and torch packages",
    hint: 'Install cito and torch in the Plumber container: R -e \'install.packages(c("cito", "torch"))\'',
  },
  BIOMOD2_INSTALLATION: {
    httpStatus: 503,
    message: "BIOMOD2 backend is available only when explicitly enabled",
    hint: "Set options(sdm.enable_biomod2 = TRUE) and install the biomod2 package",
  },
  INVALID_COORDINATES: {
    httpStatus: 400,
    message: "Occurrence coordinates are outside the valid geographic range",
    hint: "Check that longitude is in -180..180 and latitude in -90..90, and that coordinates are not swapped",
  },
  NO_VALID_CELLS: {
    httpStatus: 400,
    message: "Raster stack has no valid cells at occurrence point locations",
    hint: "Ensure covariate rasters cover the full extent of the occurrence points",
  },
  BACKGROUND_SAMPLING_FAILED: {
    httpStatus: 500,
    message: "Could not sample background points from the projection extent",
    hint: "Check that the projection extent overlaps with valid covariate raster cells",
  },
  PA_REPLICATION_FAILED: {
    httpStatus: 500,
    message: "All pseudo-absence replication attempts failed",
    hint: "Increase the number of background points or reduce the number of PA replicates",
  },
  R_PACKAGE_MISSING: {
    httpStatus: 503,
    message: "A required R package is not installed in the computation container",
    hint: "Add the missing package to plumber/Dockerfile and rebuild the image",
  },
  INVALID_INPUT: {
    httpStatus: 400,
    message: "Invalid input parameters",
    hint: "Check the request parameters against the API schema",
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    message: "An unexpected error occurred in the computation backend",
    hint: "Check the Plumber logs for detailed error information",
  },
  ACCESS_DENIED: {
    httpStatus: 403,
    message: "Access denied",
    hint: "You do not have permission to perform this action",
  },
  CANCELLED: {
    httpStatus: 200,
    message: "Run cancelled by user",
    hint: "The run was cancelled — no further action needed",
  },
  PROCESS_CRASH: {
    httpStatus: 500,
    message: "The R computation process terminated unexpectedly",
    hint: "Check for OOM, segfault, or external signal in Plumber logs",
  },
};

export function getErrorHttpStatus(errorCode: string | null | undefined): number {
  if (!errorCode) return 500;
  return SDM_ERR_MAP[errorCode]?.httpStatus ?? 500;
}

export const STATUS_CODES = [200, 400, 403, 500, 503, 504] as const;
export type StatusCode = typeof STATUS_CODES[number];

export function getErrorMessage(errorCode: string | null | undefined, fallback?: string): string {
  if (!errorCode) return fallback ?? "Internal error";
  return SDM_ERR_MAP[errorCode]?.message ?? fallback ?? "Internal error";
}

export function getErrorHint(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null;
  return SDM_ERR_MAP[errorCode]?.hint ?? null;
}
