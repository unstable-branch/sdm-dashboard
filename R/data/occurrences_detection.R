# Detection-history data parser for occupancy models.

read_detection_history <- function(file_path, site_col = "site_id",
                                   lon_col = "longitude", lat_col = "latitude",
                                   survey_prefix = "survey_",
                                   occ_covs = NULL, det_covs = NULL) {
  raw <- tryCatch({
    utils::read.csv(file_path, stringsAsFactors = FALSE)
  }, error = function(e) {
    stop("Failed to read detection history file: ", conditionMessage(e), call. = FALSE)
  })
  if (nrow(raw) == 0) stop("Detection history file is empty.", call. = FALSE)

  if (!site_col %in% names(raw)) stop("Site column '", site_col, "' not found.", call. = FALSE)
  if (!lon_col %in% names(raw)) stop("Longitude column '", lon_col, "' not found.", call. = FALSE)
  if (!lat_col %in% names(raw)) stop("Latitude column '", lat_col, "' not found.", call. = FALSE)

  survey_cols <- grep(paste0("^", survey_prefix), names(raw), value = TRUE)
  if (length(survey_cols) < 2) {
    stop("Need at least 2 survey columns (found ", length(survey_cols), "). Columns must start with '", survey_prefix, "'.", call. = FALSE)
  }

  y <- as.matrix(raw[, survey_cols, drop = FALSE])
  storage.mode(y) <- "integer"
  if (any(!y %in% c(0L, 1L, NA_integer_))) {
    stop("Survey columns must contain only 0, 1, or NA.", call. = FALSE)
  }

  site_covs <- raw[, c(site_col, lon_col, lat_col, occ_covs), drop = FALSE]
  site_covs <- site_covs[, !duplicated(names(site_covs)), drop = FALSE]

  obs_covs_list <- NULL
  if (!is.null(det_covs) && length(det_covs) > 0) {
    obs_covs_list <- lapply(det_covs, function(cov) {
      mat <- as.matrix(raw[, grep(paste0("^", cov, "_"), names(raw), value = TRUE), drop = FALSE])
      if (ncol(mat) == 0) {
        mat <- matrix(raw[[cov]], nrow = nrow(raw), ncol = length(survey_cols))
      }
      mat
    })
    names(obs_covs_list) <- det_covs
  }

  site_xy <- site_covs[, c(lon_col, lat_col), drop = FALSE]
  colnames(site_xy) <- c("x", "y")

  list(
    y = y,
    site_covs = site_covs,
    obs_covs = obs_covs_list,
    site_xy = site_xy,
    survey_cols = survey_cols,
    n_sites = nrow(raw),
    n_surveys = ncol(y)
  )
}

build_unmarked_frame <- function(det_list) {
  if (!requireNamespace("unmarked", quietly = TRUE)) {
    stop("unmarked package is required. Install with: install.packages('unmarked')", call. = FALSE)
  }
  umf <- unmarked::unmarkedFrameOccu(
    y = det_list$y,
    siteCovs = det_list$site_covs[, !names(det_list$site_covs) %in% c("x", "y"), drop = FALSE],
    obsCovs = det_list$obs_covs
  )
  umf
}
