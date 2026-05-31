# Boosted Regression Trees (BRT) SDM backend via the gbm package.

cross_validate_brt <- function(model_data, covariates, n_trees, interaction_depth,
                               shrinkage, bag_fraction, k = sdm_default_cv_folds,
                               seed = sdm_default_seed, n_cores = 1,
                               cv_strategy = sdm_default_cv_strategy,
                               cv_block_size_km = sdm_default_cv_block_size_km,
                               threshold = sdm_default_threshold,
                               log_fun = NULL) {
  fit_fun <- function(i, model_data, fold_id, threshold) {
    train_data <- model_data[fold_id != i, , drop = FALSE]
    test_data <- model_data[fold_id == i, , drop = FALSE]
    train_sub <- train_data[, c("presence", covariates), drop = FALSE]

    model <- tryCatch({
      gbm::gbm(
        formula = presence ~ .,
        data = train_sub,
        distribution = "bernoulli",
        n.trees = n_trees,
        interaction.depth = interaction_depth,
        shrinkage = shrinkage,
        bag.fraction = bag_fraction,
        cv.folds = 0,
        n.cores = 1,
        verbose = FALSE
      )
    }, error = function(e) {
      log_message(log_fun, "  BRT CV fold ", i, " failed: ", conditionMessage(e))
      NULL
    })

    if (is.null(model)) {
      return(metrics_list_to_row(list(
        auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_,
        threshold = threshold, tp = NA_integer_, fp = NA_integer_, tn = NA_integer_, fn = NA_integer_, n = 0L
      ), fold = i))
    }

    test_sub <- test_data[, covariates, drop = FALSE]
    pred <- gbm::predict.gbm(model, newdata = test_sub, n.trees = n_trees, type = "response")
    pred <- pmin(pmax(as.numeric(pred), 0), 1)
    metrics_list_to_row(compute_binary_metrics(test_data$presence, pred, threshold = threshold), fold = i)
  }

  cross_validate_model(model_data,
    k = k, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
    threshold = threshold, fit_fun = fit_fun,
    cluster_exports = c("auc_rank", "compute_binary_metrics", "metrics_list_to_row"),
    log_fun = log_fun
  )
}

fit_brt_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                        include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                        seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                        cv_strategy = sdm_default_cv_strategy,
                        cv_block_size_km = sdm_default_cv_block_size_km,
                        threshold = sdm_default_threshold,
                        n_trees = 2000L, interaction_depth = 3L, shrinkage = 0.01, bag_fraction = 0.75,
                        bias_method = "uniform",
                        target_group_occ = NULL,
                        thickening_distance_km = NULL,
                        ...) {
  if (!requireNamespace("gbm", quietly = TRUE)) {
    stop("gbm package is required for BRT fitting but is not installed.", call. = FALSE)
  }

  d <- prepare_sdm_data(occ, env_train_scaled, background_n,
    seed = seed, log_fun = log_fun,
    bias_method = bias_method %||% "uniform",
    target_group_occ = target_group_occ %||% NULL,
    thickening_distance_km = thickening_distance_km %||% NULL
  )
  occ_used <- d$occ_used
  pres_vals <- d$pres_vals
  bg_vals <- d$bg_vals
  bg_xy <- d$bg_xy
  model_data <- d$model_data
  covariates <- d$covariates

  if (isTRUE(include_quadratic)) {
    log_message(log_fun, "Note: BRT ignores quadratic terms; interactions and nonlinearity are captured natively")
  }

  log_message(log_fun, "Fitting BRT SDM with ", nrow(pres_vals), " presences and ",
    nrow(bg_vals), " background points (", n_trees, " trees, interaction depth ", interaction_depth, ")")

  brt_data <- model_data[, c("presence", covariates), drop = FALSE]

  model <- tryCatch({
    gbm::gbm(
      formula = presence ~ .,
      data = brt_data,
      distribution = "bernoulli",
      n.trees = n_trees,
      interaction.depth = interaction_depth,
      shrinkage = shrinkage,
      bag.fraction = bag_fraction,
      cv.folds = 0,
      n.cores = 1,
      verbose = FALSE
    )
  }, error = function(e) {
    stop("BRT fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  train_pred <- gbm::predict.gbm(model, newdata = brt_data, n.trees = n_trees, type = "response")
  train_metrics <- compute_binary_metrics(brt_data$presence, train_pred, threshold = threshold)

  cv <- cross_validate_brt(model_data, covariates, n_trees, interaction_depth,
    shrinkage, bag_fraction, k = cv_folds, seed = seed,
    n_cores = n_cores, cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
    threshold = threshold, log_fun = log_fun
  )
  if (is.finite(cv$auc_mean)) {
    log_message(
      log_fun, "Cross-validation (", cv$strategy, ") AUC: ", sprintf("%.3f", cv$auc_mean),
      if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else ""
    )
  }

  importance_raw <- tryCatch({
    imp <- gbm::summary.gbm(model, n.trees = n_trees, plot = FALSE, order = FALSE)
    data.frame(
      variable = as.character(imp$var),
      importance = imp$rel.inf / 100,
      stringsAsFactors = FALSE
    )
  }, error = function(e) NULL)
  if (!is.null(importance_raw)) {
    imp_max <- max(importance_raw$importance, na.rm = TRUE)
    if (is.finite(imp_max) && imp_max > 0) {
      importance_raw$importance <- importance_raw$importance / imp_max
    }
  }

  list(
    model = model,
    formula = NULL,
    coefficients = data.frame(Message = "BRT does not produce GLM-style coefficients."),
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = importance_raw,
    brt_params = list(n_trees = n_trees, interaction_depth = interaction_depth,
      shrinkage = shrinkage, bag_fraction = bag_fraction)
  )
}

predict_brt_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be a BRT model fit result list.", call. = FALSE)
  if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)

  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(fit$covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- fit$covariates[is.na(cov_idx)]
    stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]
  n_trees <- fit$brt_params$n_trees %||% 2000L

  log_message(log_fun, "Predicting BRT suitability over ", terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster")

  suit <- terra::app(env_subset, fun = function(vals) {
    if (!all(is.finite(vals))) {
      return(rep(NA_real_, nrow(vals)))
    }
    df <- as.data.frame(vals, stringsAsFactors = FALSE)
    names(df) <- fit$covariates
    pred <- gbm::predict.gbm(fit$model, newdata = df, n.trees = n_trees, type = "response")
    pmin(pmax(as.numeric(pred), 0), 1)
  }, cores = normalize_core_count(n_cores))

  names(suit) <- "suitability"
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
  log_message(log_fun, "Suitability raster written to: ", output_tif)
  suit
}
