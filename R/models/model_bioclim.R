# BIOCLIM / Mahalanobis envelope SDM backend via terra.

fit_bioclim_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                            include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                            seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                            cv_strategy = sdm_default_cv_strategy,
                            cv_block_size_km = sdm_default_cv_block_size_km,
                            threshold = sdm_default_threshold,
                            ...) {
  covariates <- names(env_train_scaled)
  if (length(covariates) < 2) stop("At least two covariates are required for modelling.", call. = FALSE)

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  pres_vals <- pres_vals[pres_keep, , drop = FALSE]
  pres_xy_used <- pres_xy[pres_keep, , drop = FALSE]
  occ_used <- occ[pres_keep, , drop = FALSE]
  if (nrow(pres_vals) < 5) stop("Too few presence records with complete environmental data.", call. = FALSE)

  covariates_clean <- make.names(covariates)
  names(pres_vals) <- covariates_clean

  log_message(log_fun, "Fitting BIOCLIM envelope with ", nrow(pres_vals), " presence records (", length(covariates), " variables)")

  model <- terra::bioclim(pres_vals)

  background_xy <- NULL
  model_data <- data.frame(presence = 1L, pres_vals, check.names = FALSE)

  if (cv_folds >= 2) {
    cv <- cross_validate_bioclim(pres_vals, env_train_scaled, covariates_clean,
      k = cv_folds, seed = seed, threshold = threshold, log_fun = log_fun)
    if (is.finite(cv$auc_mean)) {
      log_message(
        log_fun, "Cross-validation (presence-split) AUC: ", sprintf("%.3f", cv$auc_mean),
        if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else ""
      )
    }
  } else {
    cv <- list(
      k = 0, strategy = "none", auc_mean = NA_real_, auc_sd = NA_real_,
      tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
      fold_metrics = data.frame(), fold_sizes = data.frame()
    )
  }

  list(
    model = model,
    formula = NULL,
    coefficients = data.frame(Message = "BIOCLIM does not produce coefficients."),
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = background_xy,
    cv = cv,
    covariates = covariates_clean,
    variable_importance = NULL
  )
}

cross_validate_bioclim <- function(pres_vals, env_train_scaled, covariates,
                                   k = sdm_default_cv_folds, seed = sdm_default_seed,
                                   threshold = sdm_default_threshold,
                                   log_fun = NULL) {
  set.seed(seed)
  n_pres <- nrow(pres_vals)
  folds <- sample(rep(seq_len(k), length.out = n_pres))
  fold_metrics <- data.frame()

  for (i in seq_len(k)) {
    train_idx <- which(folds != i)
    test_idx <- which(folds == i)
    if (length(test_idx) < 2 || length(train_idx) < 2) next

    train_vals <- pres_vals[train_idx, , drop = FALSE]
    test_vals <- pres_vals[test_idx, , drop = FALSE]

    bc_model <- tryCatch(terra::bioclim(train_vals), error = function(e) NULL)
    if (is.null(bc_model)) next

    present_pred <- terra::predict(bc_model, test_vals, type = "cloglog")
    present_pred <- as.numeric(present_pred[, 1])

    set.seed(seed + i)
    bg_xy <- sample_background_points(env_train_scaled, 1000L, seed = seed + i)
    bg_vals <- extract_covariates(env_train_scaled, bg_xy)
    bg_keep <- stats::complete.cases(bg_vals)
    bg_vals <- bg_vals[bg_keep, , drop = FALSE]
    names(bg_vals) <- covariates
    bg_pred <- terra::predict(bc_model, bg_vals, type = "cloglog")
    bg_pred <- as.numeric(bg_pred[, 1])

    obs <- c(rep(1, length(present_pred)), rep(0, length(bg_pred)))
    score <- c(present_pred, bg_pred)
    metrics <- compute_binary_metrics(obs, score, threshold = threshold)
    fold_metrics <- rbind(fold_metrics, metrics_list_to_row(metrics, fold = i))
  }

  if (nrow(fold_metrics) == 0) {
    return(list(
      k = 0, strategy = "presence_split", auc_mean = NA_real_, auc_sd = NA_real_,
      tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
      fold_metrics = data.frame(), fold_sizes = data.frame()
    ))
  }

  list(
    k = nrow(fold_metrics),
    strategy = "presence_split",
    fold_metrics = fold_metrics,
    auc_mean = metric_mean(fold_metrics$auc),
    auc_sd = metric_sd(fold_metrics$auc),
    tss_mean = metric_mean(fold_metrics$tss),
    tss_sd = metric_sd(fold_metrics$tss),
    fold_auc = fold_metrics$auc
  )
}

predict_bioclim_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be a BIOCLIM model fit result list.", call. = FALSE)

  log_message(log_fun, "Predicting BIOCLIM suitability over ", terra::ncol(env_project_scaled), "x", terra::nrow(env_project_scaled), " raster")

  suit <- terra::predict(env_project_scaled, fit$model, type = "cloglog", cores = normalize_core_count(n_cores))
  names(suit) <- "suitability"
  suit <- pmax(suit, 0)
  suit <- pmin(suit, 1)

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
  log_message(log_fun, "Suitability raster written to: ", output_tif)
  suit
}
