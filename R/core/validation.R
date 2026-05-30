# Validation helpers shared across the app and engine.

validate_extent <- function(extent_vec, name = "extent") {
  if (length(extent_vec) != 4 || any(!is.finite(extent_vec))) {
    stop(name, " must contain four numeric values: xmin, xmax, ymin, ymax.", call. = FALSE)
  }
  if (extent_vec[1] >= extent_vec[2] || extent_vec[3] >= extent_vec[4]) {
    stop(name, " has invalid bounds.", call. = FALSE)
  }
  if (extent_vec[1] < -180 || extent_vec[2] > 180 || extent_vec[3] < -90 || extent_vec[4] > 90) {
    stop(name, " is outside valid longitude/latitude bounds.", call. = FALSE)
  }
  if (extent_vec[2] - extent_vec[1] < 1e-6 || extent_vec[4] - extent_vec[3] < 1e-6) {
    stop(name, " extent too small (< 1e-6 degrees).", call. = FALSE)
  }
  as.numeric(extent_vec)
}

validate_biovars <- function(selected_biovars) {
  selected_biovars <- as.integer(selected_biovars)
  if (length(selected_biovars) < 2 || any(is.na(selected_biovars))) {
    stop("Select at least two BIO variables.", call. = FALSE)
  }
  if (any(selected_biovars < 1 | selected_biovars > 19)) {
    stop("BIO variables must be between 1 and 19.", call. = FALSE)
  }
  unique(selected_biovars)
}

normalize_threshold <- function(threshold = sdm_default_threshold) {
  threshold <- suppressWarnings(as.numeric(threshold[1]))
  if (is.na(threshold) || threshold < 0 || threshold > 1) {
    stop("threshold must be between 0 and 1.", call. = FALSE)
  }
  threshold
}

normalize_cv_strategy <- function(x) {
  x <- tolower(as.character(x)[1])
  if (x %in% c("spatial_blocks", "spatial_block", "spatial blocks", "spatial block")) {
    "spatial_blocks"
  } else {
    "random"
  }
}

normalize_cv_block_size_km <- function(x) {
  v <- suppressWarnings(as.numeric(x)[1])
  if (is.finite(v) && v > 0) v else NA_real_
}
