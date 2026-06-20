# Occupancy SDM backend via unmarked.

fit_occupancy_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                              include_quadratic = FALSE, cv_folds = 0L,
                              seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                              cv_strategy = sdm_default_cv_strategy,
                              cv_block_size_km = sdm_default_cv_block_size_km,
                              threshold = sdm_default_threshold,
                              detection_formula = "~1",
                              model_type = "occu",
                              ...) {
  if (!requireNamespace("unmarked", quietly = TRUE)) {
    stop("unmarked package is required for occupancy models. Install with: install.packages('unmarked')", call. = FALSE)
  }

  has_detection_data <- is.list(occ) && !is.null(occ$y)

  if (!has_detection_data) {
    stop(
      "Occupancy models require detection-history data, not presence/background data.\n",
      "Use read_detection_history() to load a properly formatted CSV.\n",
      "Required columns: site_id, longitude, latitude, survey_1, ..., survey_k,\n",
      "  plus optional occupancy and detection covariates.",
      call. = FALSE
    )
  }

  covariates <- names(env_train_scaled)
  covariates_clean <- make.names(covariates)

  site_covs <- occ$site_covs
  extracted <- terra::extract(env_train_scaled, occ$site_xy)[, -1, drop = FALSE]
  for (i in seq_along(covariates)) {
    site_covs[[covariates_clean[i]]] <- extracted[, i]
  }
  site_covs <- site_covs[stats::complete.cases(site_covs), , drop = FALSE]
  occ_used <- site_covs
  occ_used$presence <- apply(occ$y, 1, function(row) as.integer(any(row == 1, na.rm = TRUE)))

  umf <- unmarked::unmarkedFrameOccu(
    y = occ$y[stats::complete.cases(site_covs), , drop = FALSE],
    siteCovs = site_covs[, !names(site_covs) %in% c("x", "y"), drop = FALSE]
  )

  occ_formula <- if (include_quadratic && length(covariates_clean) > 0) {
    terms_list <- unlist(lapply(covariates_clean, function(c) c(c, paste0("I(", c, "^2)"))))
    stats::as.formula(paste("~", paste(terms_list, collapse = " + ")))
  } else if (length(covariates_clean) > 0) {
    stats::as.formula(paste("~", paste(covariates_clean, collapse = " + ")))
  } else {
    stats::as.formula("~1")
  }

  det_form <- stats::as.formula(detection_formula)
  full_formula <- stats::as.formula(paste(
    deparse(det_form, width.cutoff = 500),
    deparse(occ_formula, width.cutoff = 500),
    sep = " "
  ))

  log_message(log_fun, "Fitting occupancy model (", model_type, ") with ", nrow(occ$y), " sites, ",
    ncol(occ$y), " surveys, ", length(covariates_clean), " occupancy covariates")

  model <- tryCatch({
    switch(model_type,
      occu = unmarked::occu(full_formula, data = umf),
      occuRN = unmarked::occuRN(full_formula, data = umf),
      stop("Unknown occupancy model type: ", model_type, call. = FALSE)
    )
  }, error = function(e) {
    stop("Occupancy model fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  coef_df <- as.data.frame(unmarked::coef(model, type = "state"))
  names(coef_df) <- c("estimate", "se", "z", "p")

  cv <- list(
    k = 0L, strategy = "none",
    auc_mean = NA_real_, auc_sd = NA_real_,
    tss_mean = NA_real_, tss_sd = NA_real_,
    fold_auc = numeric()
  )

  log_message(log_fun, "  Occupancy model fitted successfully")

  list(
    model = model,
    formula = full_formula,
    coefficients = coef_df,
    model_data = data.frame(presence = occ_used$presence),
    occurrence_used = occ_used,
    background_xy = NULL,
    cv = cv,
    covariates = covariates_clean,
    variable_importance = NULL,
    occupancy_params = list(model_type = model_type, detection_formula = detection_formula)
  )
}

predict_occupancy_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be an occupancy model fit result list.", call. = FALSE)
  if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)

  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(fit$covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- fit$covariates[is.na(cov_idx)]
    stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]

  log_message(log_fun, "Predicting occupancy suitability over ", terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster")

  env_df <- as.data.frame(terra::values(env_subset), stringsAsFactors = FALSE)
  names(env_df) <- fit$covariates
  complete_idx <- which(stats::complete.cases(env_df))

  n_cells <- length(complete_idx)
  if (n_cells == 0) {
    suit <- terra::rast(env_subset[[1]])
    names(suit) <- "suitability"
    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
    return(suit)
  }

  pred_df <- tryCatch({
    stats::predict(fit$model, type = "state", newdata = env_df[complete_idx, , drop = FALSE])
  }, error = function(e) {
    stop("Occupancy prediction failed: ", conditionMessage(e), call. = FALSE)
  })

  suit <- terra::rast(env_subset[[1]])
  terra::values(suit) <- NA_real_
  suit[complete_idx] <- pmax(0, pmin(1, pred_df$Predicted))
  names(suit) <- "suitability"

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
  log_message(log_fun, "Occupancy suitability raster written to: ", output_tif)

  attr(suit, "occupancy_SE") <- pred_df$SE

  suit
}
