# Boosted Regression Trees / XGBoost SDM backend.
# Follows the model_registry.R pattern for plug-in compatibility.

cross_validate_xgboost <- function(model_data, covariates, max_depth, eta, nrounds,
                                   k = sdm_default_cv_folds, seed = sdm_default_seed,
                                   n_cores = 1, cv_strategy = sdm_default_cv_strategy,
                                   cv_block_size_km = sdm_default_cv_block_size_km,
                                   log_fun = NULL) {
  fit_fun <- function(i, model_data, fold_id, threshold) {
    train_data <- model_data[fold_id != i, , drop = FALSE]
    test_data <- model_data[fold_id == i, , drop = FALSE]
    feature_names <- covariates

    x_train <- as.matrix(train_data[, feature_names, drop = FALSE])
    y_train <- train_data$presence
    x_test <- as.matrix(test_data[, feature_names, drop = FALSE])
    y_test <- test_data$presence

    model <- tryCatch({
      weights <- class_balance_weights(y_train)
      dtrain <- xgboost::xgb.DMatrix(data = x_train, label = y_train, weight = weights)
      xgboost::xgb.train(
        params = list(
          objective = "reg:logistic",
          eval_metric = "auc",
          max_depth = max_depth,
          learning_rate = eta,
          nthread = 1L,
          seed = seed
        ),
        data = dtrain,
        nrounds = nrounds,
        verbose = 0
      )
    }, error = function(e) {
      log_message(log_fun, "  XGBoost CV fold ", i, " failed: ", conditionMessage(e))
      NULL
    })

    if (is.null(model)) {
      return(metrics_list_to_row(list(
        auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_,
        threshold = threshold, tp = NA_integer_, fp = NA_integer_, tn = NA_integer_, fn = NA_integer_, n = 0L
      ), fold = i))
    }

    pred <- tryCatch(predict(model, x_test), error = function(e) {
      log_message(log_fun, "  XGBoost CV fold ", i, " prediction failed: ", conditionMessage(e))
      rep(NA_real_, nrow(x_test))
    })
    metrics_list_to_row(compute_binary_metrics(y_test, pred, threshold = threshold), fold = i)
  }

  cross_validate_model(model_data,
    k = k, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
    threshold = sdm_default_threshold, fit_fun = fit_fun,
    cluster_exports = c("covariates", "class_balance_weights",
                        "compute_binary_metrics", "metrics_list_to_row", "log_message"),
    log_fun = log_fun
  )
}

fit_xgboost_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                            include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                            seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                            cv_strategy = sdm_default_cv_strategy,
                            cv_block_size_km = sdm_default_cv_block_size_km,
                            threshold = sdm_default_threshold,
                            max_depth = 6L, eta = 0.3, nrounds = 100L,
                            bias_method = "uniform",
                            target_group_occ = NULL,
                            thickening_distance_km = NULL) {
  if (!requireNamespace("xgboost", quietly = TRUE)) {
    stop("The XGBoost backend requires the xgboost package. Install xgboost or choose a different model backend.", call. = FALSE)
  }

  d <- prepare_sdm_data(occ, env_train_scaled, background_n,
    seed = seed, log_fun = log_fun,
    include_xy = FALSE,
    bias_method = bias_method %||% "uniform",
    target_group_occ = target_group_occ %||% NULL,
    thickening_distance_km = thickening_distance_km %||% NULL
  )
  covariates <- d$covariates
  model_data <- d$model_data
  occ_used <- d$occ_used
  bg_xy <- d$bg_xy

  x_train <- as.matrix(model_data[, covariates, drop = FALSE])
  y_train <- model_data$presence
  weights <- class_balance_weights(y_train)

  log_message(log_fun, "Fitting XGBoost SDM with ", sum(y_train == 1), " presences and ", sum(y_train == 0), " background points")
  log_message(log_fun, "  max_depth=", max_depth, " eta=", eta, " nrounds=", nrounds)

  model <- tryCatch({
    dtrain <- xgboost::xgb.DMatrix(data = x_train, label = y_train, weight = weights)
    xgboost::xgb.train(
      params = list(
        objective = "reg:logistic",
        eval_metric = "auc",
        max_depth = max_depth,
        learning_rate = eta,
        nthread = 1L,
        seed = seed
      ),
      data = dtrain,
      nrounds = nrounds,
      verbose = 0
    )
  }, error = function(e) {
    stop("XGBoost fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  cv <- cross_validate_xgboost(model_data, covariates, max_depth, eta, nrounds,
    k = cv_folds, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km)
  if (is.finite(cv$auc_mean)) {
    log_message(log_fun, "XGBoost cross-validation AUC: ", sprintf("%.3f", cv$auc_mean),
      if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else "")
  }

  # Feature importance
  importance <- tryCatch({
    imp <- xgboost::xgb.importance(model = model, feature_names = covariates)
    data.frame(
      variable = imp$Feature,
      importance = imp$Gain,
      stringsAsFactors = FALSE
    )
  }, error = function(e) NULL)

  list(
    model = model,
    formula = NULL,
    coefficients = NULL,
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = importance,
    xgb_params = list(max_depth = max_depth, eta = eta, nrounds = nrounds)
  )
}

predict_xgboost_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  log_message(log_fun, "Predicting suitability raster with XGBoost")
  covariates <- fit$covariates

  # Match covariate names (make.names-ified in fit) to raster layer names
  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- covariates[is.na(cov_idx)]
    stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]

  predict_one_block <- function(rast_block) {
    df <- as.data.frame(rast_block)
    names(df) <- covariates  # match make.names-ified covariate names
    x <- as.matrix(df[, covariates, drop = FALSE])
    pred <- predict(fit$model, x)
    pred[!is.finite(pred)] <- 0
    pred <- pmin(pmax(pred, 0), 1)
    pred
  }

  suit <- terra::app(env_subset, predict_one_block, cores = normalize_core_count(n_cores), names = "suitability")
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
  log_message(log_fun, "XGBoost suitability saved: ", output_tif)
  suit
}
