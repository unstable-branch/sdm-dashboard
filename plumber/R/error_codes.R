# Error code taxonomy for SDM Dashboard
# Structured error codes with remediation hints.
# Used consistently across Plumber API, model backends, and frontend.

SDM_ERR_CODES <- list(
  RUNNER_LOAD_FAILED = list(
    code = "RUNNER_LOAD_FAILED",
    http_status = 500L,
    message = "The R background process died while initialising SDM modules",
    hint = "The process was killed by the OS, likely due to insufficient memory. Reduce covariates, use coarser resolution, or increase container memory. If this persists, check that all required R packages are installed."
  ),
  PROCESS_CRASH = list(
    code = "PROCESS_CRASH",
    http_status = 500L,
    message = "The R computation process crashed or was killed",
    hint = "The process was terminated by the OS (OOM, segfault, or external signal). Check system memory, reduce raster resolution, or run with fewer covariates."
  ),
  INSUFFICIENT_RECORDS = list(
    code = "INSUFFICIENT_RECORDS",
    http_status = 400L,
    message = "Insufficient occurrence records for the selected model",
    hint = "Upload more occurrence data or choose a simpler model that requires fewer records"
  ),
  EXTRAPOLATION_VIOLATED = list(
    code = "EXTRAPOLATION_VIOLATED",
    http_status = 400L,
    message = "Projection extent exceeds the training data extent",
    hint = "Reduce the projection extent to overlap with the training area, or enable extrapolation if appropriate"
  ),
  COVARIATE_COLLINEAR = list(
    code = "COVARIATE_COLLINEAR",
    http_status = 400L,
    message = "Selected covariates are collinear (VIF above threshold)",
    hint = "Reduce the VIF threshold, deselect correlated covariates, or enable VIF-based reduction"
  ),
  OOM_PREDICTION = list(
    code = "OOM_PREDICTION",
    http_status = 500L,
    message = "Out of memory during raster prediction",
    hint = "Reduce raster resolution (worldclim_res), use a smaller projection extent, or increase available memory"
  ),
  PERFECT_SEPARATION = list(
    code = "PERFECT_SEPARATION",
    http_status = 400L,
    message = "Perfect separation detected in GLM — predictor perfectly divides presence and background",
    hint = "Remove the perfectly separating covariate, add more background points, or use a regularised model (maxnet)"
  ),
  PLUMBER_TIMEOUT = list(
    code = "PLUMBER_TIMEOUT",
    http_status = 504L,
    message = "R computation exceeded the maximum allowed time",
    hint = "Simplify the model (fewer covariates, lower resolution) or increase the timeout limit"
  ),
  DNN_INSTALLATION = list(
    code = "DNN_INSTALLATION",
    http_status = 503L,
    message = "Deep Neural Network backend requires cito and torch packages",
    hint = "Install cito and torch in the Plumber container: R -e 'install.packages(c(\"cito\", \"torch\"))'"
  ),
  BIOMOD2_INSTALLATION = list(
    code = "BIOMOD2_INSTALLATION",
    http_status = 503L,
    message = "BIOMOD2 backend is available only when explicitly enabled",
    hint = "Set options(sdm.enable_biomod2 = TRUE) and install the biomod2 package"
  ),
  INVALID_COORDINATES = list(
    code = "INVALID_COORDINATES",
    http_status = 400L,
    message = "Occurrence coordinates are outside the valid geographic range",
    hint = "Check that longitude is in -180..180 and latitude in -90..90, and that coordinates are not swapped"
  ),
  NO_VALID_CELLS = list(
    code = "NO_VALID_CELLS",
    http_status = 400L,
    message = "Raster stack has no valid cells at occurrence point locations",
    hint = "Ensure covariate rasters cover the full extent of the occurrence points"
  ),
  BACKGROUND_SAMPLING_FAILED = list(
    code = "BACKGROUND_SAMPLING_FAILED",
    http_status = 500L,
    message = "Could not sample background points from the projection extent",
    hint = "Check that the projection extent overlaps with valid covariate raster cells"
  ),
  PA_REPLICATION_FAILED = list(
    code = "PA_REPLICATION_FAILED",
    http_status = 500L,
    message = "All pseudo-absence replication attempts failed",
    hint = "Increase the number of background points or reduce the number of PA replicates"
  ),
  R_PACKAGE_MISSING = list(
    code = "R_PACKAGE_MISSING",
    http_status = 503L,
    message = "A required R package is not installed in the computation container",
    hint = "Add the missing package to plumber/Dockerfile and rebuild the image"
  ),
  INVALID_INPUT = list(
    code = "INVALID_INPUT",
    http_status = 400L,
    message = "Invalid input parameters",
    hint = "Check the request parameters against the API schema"
  ),
  ACCESS_DENIED = list(
    code = "ACCESS_DENIED",
    http_status = 403L,
    message = "Access denied",
    hint = "You do not have permission to perform this action"
  ),
  CANCELLED = list(
    code = "CANCELLED",
    http_status = 200L,
    message = "Run cancelled by user",
    hint = "The run was cancelled — no further action needed"
  ),
  GPU_BUSY = list(
    code = "GPU_BUSY",
    http_status = 429L,
    message = "Too many GPU model runs are currently active",
    hint = "Wait for a GPU model run to finish before starting another, or increase SDM_MAX_GPU_CONCURRENT_RUNS"
  ),
  INTERNAL_ERROR = list(
    code = "INTERNAL_ERROR",
    http_status = 500L,
    message = "An unexpected error occurred in the computation backend",
    hint = "Check the Plumber logs for detailed error information"
  )
)

# Structured error response
# Usage: return(sdm_error_code(req, "INSUFFICIENT_RECORDS", "Need at least X presences"))
sdm_error_code <- function(req, code_key, detail_msg = NULL) {
  err <- SDM_ERR_CODES[[code_key]]
  if (is.null(err)) {
    err <- SDM_ERR_CODES[["INTERNAL_ERROR"]]
    code_key <- "INTERNAL_ERROR"
  }
  res <- tryCatch(req$res, error = function(e) NULL)
  if (!is.null(res)) {
    tryCatch(res$status <- err$http_status, error = function(e) NULL)
  }
  message <- if (!is.null(detail_msg)) paste0(err$message, ": ", detail_msg) else err$message
  list(
    error = message,
    code = code_key,
    hint = err$hint
  )
}

# Wrapper for non-request contexts (e.g., background workers)
sdm_error_code_direct <- function(code_key, detail_msg = NULL) {
  err <- SDM_ERR_CODES[[code_key]]
  if (is.null(err)) err <- SDM_ERR_CODES[["INTERNAL_ERROR"]]
  message <- if (!is.null(detail_msg)) paste0(err$message, ": ", detail_msg) else err$message
  list(
    error = message,
    code = code_key,
    hint = err$hint
  )
}

# Helper to categorise a raw R error into a known error code
sdm_classify_error <- function(err_msg) {
  err_msg <- as.character(err_msg)
  if (grepl("out of memory|cannot allocate|OOM|CUDA out of memory|CUDA error|cuBLAS error|cuDNN error", err_msg, ignore.case = TRUE)) {
    return("OOM_PREDICTION")
  }
  if (grepl("perfect separation|singular|glm\\.fit", err_msg, ignore.case = TRUE)) {
    return("PERFECT_SEPARATION")
  }
  if (grepl("biomod2|biomod", err_msg, ignore.case = TRUE)) {
    return("BIOMOD2_INSTALLATION")
  }
  if (grepl("cito|torch|dnn", err_msg, ignore.case = TRUE)) {
    return("DNN_INSTALLATION")
  }
  if (grepl("collinear|VIF|vif", err_msg, ignore.case = TRUE)) {
    return("COVARIATE_COLLINEAR")
  }
  if (grepl("must be installed|package|namespace", err_msg, ignore.case = TRUE)) {
    return("R_PACKAGE_MISSING")
  }
  return("INTERNAL_ERROR")
}
