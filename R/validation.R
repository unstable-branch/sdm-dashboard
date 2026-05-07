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
<<<<<<< HEAD

normalize_thinning_mode <- function(thinning_mode = sdm_default_thinning_mode, thin_by_cell = TRUE) {
  mode <- tolower(trimws(as.character(thinning_mode[1] %||% sdm_default_thinning_mode)))
  mode <- gsub("[- ]", "_", mode)
  if (!nzchar(mode) || identical(mode, "default")) mode <- "auto"
  allowed <- c("auto", "none", "cell", "raster_cell", "distance")
  if (!(mode %in% allowed)) stop("thinning_mode must be auto, none, raster_cell, or distance.", call. = FALSE)
  if (identical(mode, "auto")) mode <- if (isTRUE(thin_by_cell)) "raster_cell" else "none"
  if (identical(mode, "cell")) mode <- "raster_cell"
  mode
}

normalize_thinning_distance_km <- function(distance = sdm_default_thinning_distance_km) {
  distance <- suppressWarnings(as.numeric(distance[1]))
  if (!is.finite(distance) || distance <= 0) stop("thinning_distance_km must be a positive number.", call. = FALSE)
  distance
}

normalize_cv_strategy <- function(cv_strategy = sdm_default_cv_strategy) {
  strategy <- tolower(trimws(as.character(cv_strategy[1] %||% sdm_default_cv_strategy)))
  strategy <- gsub("[- ]", "_", strategy)
  if (!nzchar(strategy)) strategy <- sdm_default_cv_strategy
  if (identical(strategy, "spatial")) strategy <- "spatial_blocks"
  allowed <- c("random", "spatial_blocks")
  if (!(strategy %in% allowed)) stop("cv_strategy must be random or spatial_blocks.", call. = FALSE)
  strategy
}

normalize_cv_block_size_km <- function(block_size_km = sdm_default_cv_block_size_km) {
  block_size_km <- suppressWarnings(as.numeric(block_size_km[1]))
  if (!is.finite(block_size_km) || block_size_km <= 0) return(NA_real_)
  block_size_km
}
=======
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
