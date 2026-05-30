# Random Forest SDM backend via the ranger package.

if (!requireNamespace("ranger", quietly = TRUE)) {
  if (interactive()) {
    message(
      "ranger package not installed — RF backend unavailable. ",
      "Install with: install.packages('ranger')"
    )
  }
} else {

  sdm_default_rf_num_trees <- 500L
  sdm_default_rf_mtry <- NULL    # NULL = auto (sqrt(n_covariates))
  sdm_default_rf_min_node_size <- 10L
  sdm_default_rf_importance_mode <- "permutation"

  cross_validate_rf <- function(model_data, covariates, num_trees, mtry, min_node_size,
                                k = 3, seed = 42, n_cores = 1,
                                cv_strategy = sdm_default_cv_strategy,
                                cv_block_size_km = sdm_default_cv_block_size_km,
                                threshold = sdm_default_threshold) {
    fit_fun <- function(i, model_data, fold_id, threshold) {
      train <- model_data[fold_id != i, , drop = FALSE]
      test <- model_data[fold_id == i, , drop = FALSE]
      train_sub <- train[, c("presence", covariates), drop = FALSE]
      rf_model <- ranger::ranger(
        formula = presence ~ .,
        data = train_sub,
        num.trees = num_trees,
        mtry = mtry %||% max(1, floor(sqrt(length(covariates)))),
        min.node.size = min_node_size,
        classification = FALSE,
        importance = "none",
        seed = seed,
        verbose = FALSE
      )
      test_sub <- test[, covariates, drop = FALSE]
      raw_pred <- predict(rf_model, data = test_sub)$predictions
      pred <- pmax(0, pmin(1, raw_pred))
      metrics_list_to_row(compute_binary_metrics(test$presence, pred, threshold = threshold), fold = i)
    }

    cross_validate_model(model_data,
      k = k, seed = seed, n_cores = n_cores,
      cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
      threshold = threshold, fit_fun = fit_fun,
      cluster_exports = c("auc_rank", "compute_binary_metrics", "metrics_list_to_row"),
      log_fun = log_fun
    )
  }

  fit_rf_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                         include_quadratic = FALSE, cv_folds = 3, seed = 42, n_cores = 1,
                         log_fun = NULL, progress_fun = NULL, cv_strategy = sdm_default_cv_strategy,
                         cv_block_size_km = sdm_default_cv_block_size_km,
                         threshold = sdm_default_threshold,
                         num_trees = sdm_default_rf_num_trees,
                         mtry = sdm_default_rf_mtry,
                         min_node_size = sdm_default_rf_min_node_size,
                         bias_method = "uniform",
                         target_group_occ = NULL,
                         thickening_distance_km = NULL,
                         ...) {
    if (!requireNamespace("ranger", quietly = TRUE)) {
      stop("ranger package is required for RF fitting but is not installed.", call. = FALSE)
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

    # RF doesn't need quadratic terms — warn if enabled
    if (isTRUE(include_quadratic)) {
      log_message(log_fun, "Note: RF ignores quadratic terms; nonlinear responses are captured natively")
    }

    log_message(log_fun, "Fitting Random Forest SDM with ", nrow(pres_vals), " presences and ",
      nrow(bg_vals), " background points (", num_trees, " trees)")

    rf_data <- model_data[, c("presence", covariates), drop = FALSE]

    # Auto mtry if not specified
    effective_mtry <- mtry %||% max(1, floor(sqrt(length(covariates))))

    model <- tryCatch({
      ranger::ranger(
        formula = presence ~ .,
        data = rf_data,
        num.trees = num_trees,
        mtry = effective_mtry,
        min.node.size = min_node_size,
        classification = FALSE,
        importance = "permutation",
        seed = seed,
        num.threads = normalize_core_count(n_cores),
        verbose = FALSE
      )
    }, error = function(e) {
      stop("Random Forest fitting failed: ", conditionMessage(e), call. = FALSE)
    })

    # Training metrics
    train_pred <- pmax(0, pmin(1, model$predictions))
    train_metrics <- compute_binary_metrics(rf_data$presence, train_pred, threshold = threshold)

    # Cross-validation
    cv <- cross_validate_rf(model_data, covariates, num_trees, mtry, min_node_size,
      k = cv_folds, seed = seed,
      n_cores = n_cores, cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
      threshold = threshold
    )
    if (is.finite(cv$auc_mean)) {
      log_message(
        log_fun, "Cross-validation (", cv$strategy, ") AUC: ", sprintf("%.3f", cv$auc_mean),
        if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else ""
      )
    }

    # Variable importance from ranger
    importance_raw <- model$variable.importance
    importance_df <- data.frame(
      variable = names(importance_raw),
      importance = as.numeric(importance_raw),
      stringsAsFactors = FALSE
    )
    # Normalise to 0-1
    imp_max <- max(importance_df$importance, na.rm = TRUE)
    if (is.finite(imp_max) && imp_max > 0) {
      importance_df$importance <- importance_df$importance / imp_max
    }

    # OOB error as diagnostic
    oob_auc <- tryCatch({
      oob_pred <- model$predictions
      auc_rank(rf_data$presence, oob_pred)
    }, error = function(e) NA_real_)

    list(
      model = model,
      formula = NULL,
      coefficients = data.frame(Message = "Random Forest does not produce GLM-style coefficients."),
      model_data = model_data,
      occurrence_used = occ_used,
      background_xy = bg_xy,
      cv = cv,
      covariates = covariates,
      variable_importance = importance_df,
      threshold = cv$threshold %||% threshold,
      oob_auc = oob_auc
    )
  }

  predict_rf_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    if (!requireNamespace("ranger", quietly = TRUE)) {
      stop("ranger package is required for RF prediction but is not installed.", call. = FALSE)
    }
    if (!is.list(fit) || is.null(fit$model)) stop("fit must be an RF model fit result list.", call. = FALSE)

    if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)
    # Match covariate names (make.names-ified in fit) to raster layer names
    raster_names <- names(env_project_scaled)
    raster_names_clean <- make.names(raster_names)
    cov_idx <- match(fit$covariates, raster_names_clean)
    if (any(is.na(cov_idx))) {
      missing <- fit$covariates[is.na(cov_idx)]
      stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
    }
    env_subset <- env_project_scaled[[raster_names[cov_idx]]]
    log_message(log_fun, "Predicting RF suitability over ", terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster")

    suit <- terra::app(env_subset, fun = function(vals) {
      if (!all(is.finite(vals))) {
        return(rep(NA_real_, nrow(vals)))
      }
      df <- as.data.frame(vals, stringsAsFactors = FALSE)
      names(df) <- fit$covariates
      predict(fit$model, data = df)$predictions
    }, cores = normalize_core_count(n_cores))

    names(suit) <- "suitability"
    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    log_message(log_fun, "Suitability raster written to: ", output_tif)
    suit
  }

} # end conditional on ranger availability
