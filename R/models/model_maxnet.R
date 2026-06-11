# MaxEnt SDM via the maxnet package (glmnet backend, no Java required).

if (!requireNamespace("maxnet", quietly = TRUE)) {
  if (interactive()) {
    message(
      "maxnet package not installed — MaxEnt backend unavailable. ",
      "Install with: install.packages('maxnet')"
    )
  }
} else {
  cross_validate_maxnet <- function(model_data, covariates, maxnet_features, maxnet_regmult, k = 3,
                                    seed = 42, n_cores = 1,
                                    cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                                    threshold = sdm_default_threshold) {
    fit_fun <- function(i, model_data, fold_id, threshold) {
      train <- model_data[fold_id != i, , drop = FALSE]
      test <- model_data[fold_id == i, , drop = FALSE]
      train_model <- train[, !names(train) %in% c(".x", ".y"), drop = FALSE]
      test_model <- test[, !names(test) %in% c(".x", ".y"), drop = FALSE]
      y_train <- as.integer(train_model$presence)
      train_pa <- cbind(data.frame(presence = y_train), train_model[, covariates, drop = FALSE])
      names(train_pa) <- c("presence", covariates)
      maxnet_model <- maxnet::maxnet(p = train_pa$presence, data = train_pa[, covariates, drop = FALSE],
        maxnet_features = maxnet_features, maxnet_regmult = maxnet_regmult)
      pred <- as.numeric(predict(maxnet_model, test_model[, covariates, drop = FALSE], clamp = TRUE, type = "link"))
      metrics_list_to_row(compute_binary_metrics(test_model$presence, pred, threshold = threshold), fold = i)
    }

    cluster_setup <- function(cl) {
      parallel::clusterEvalQ(cl, library(maxnet, quietly = TRUE))
      parallel::clusterExport(cl, "make.names", envir = environment())
    }

    cross_validate_model(model_data,
      k = k, seed = seed, n_cores = n_cores,
      cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
      threshold = threshold, fit_fun = fit_fun,
      cluster_setup_fn = cluster_setup,
      cluster_exports = c("auc_rank", "compute_binary_metrics", "metrics_list_to_row"),
      log_fun = log_fun
    )
  }

  fit_maxnet_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                             include_quadratic = TRUE, cv_folds = 3, seed = 42, n_cores = 1,
                             log_fun = NULL, progress_fun = NULL, cv_strategy = sdm_default_cv_strategy,
                             cv_block_size_km = sdm_default_cv_block_size_km,
                             bias_method = c("uniform", "target_group", "thickened"),
                             target_group_occ = NULL,
                             thickening_distance_km = NULL,
                             threshold = sdm_default_threshold, maxnet_features = sdm_default_maxnet_features,
                             maxnet_regmult = sdm_default_maxnet_regmult) {
    bias_method <- match.arg(bias_method)
    if (!requireNamespace("maxnet", quietly = TRUE)) {
      stop("maxnet package is required for MaxEnt fitting but is not installed.", call. = FALSE)
    }

    d <- prepare_sdm_data(occ, env_train_scaled, background_n,
      seed = seed, log_fun = log_fun,
      bias_method = bias_method, target_group_occ = target_group_occ,
      thickening_distance_km = thickening_distance_km
    )
    occ_used <- d$occ_used
    pres_vals <- d$pres_vals
    bg_vals <- d$bg_vals
    bg_xy <- d$bg_xy
    model_data <- d$model_data
    covariates <- d$covariates

    log_message(log_fun, "Fitting MaxEnt SDM with ", nrow(pres_vals), " presences and ", nrow(bg_vals), " background points")

    maxnet_pa <- cbind(data.frame(presence = model_data$presence), model_data[, covariates, drop = FALSE])
    names(maxnet_pa)[-1] <- covariates
    model <- tryCatch({
      maxnet::maxnet(p = maxnet_pa$presence, data = maxnet_pa[, covariates, drop = FALSE],
        maxnet_features = maxnet_features, maxnet_regmult = maxnet_regmult)
    }, error = function(e) {
      stop("MaxEnt fitting failed: ", conditionMessage(e), call. = FALSE)
    })

    model_for_auc <- model_data[, !names(model_data) %in% c(".x", ".y"), drop = FALSE]
    train_pred <- as.numeric(predict(model, model_for_auc[, covariates, drop = FALSE], clamp = TRUE, type = "cloglog"))
    train_metrics <- compute_binary_metrics(model_for_auc$presence, train_pred, threshold = threshold)

    cv <- cross_validate_maxnet(model_data, covariates, maxnet_features, maxnet_regmult,
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

    coefficients <- data.frame(
      term = names(model$betas),
      estimate = as.numeric(model$betas),
      row.names = NULL,
      stringsAsFactors = FALSE
    )

    perm_importance <- compute_permutation_importance(model, model_for_auc, covariates, train_metrics$auc,
      n_perm = 5, seed = seed, threshold = threshold
    )

    list(
      model = model,
      formula = NULL,
      coefficients = coefficients,
      occurrence_used = occ_used,
      background_xy = bg_xy,
      cv = cv,
      covariates = covariates,
      variable_importance = perm_importance,
      metrics = list(training_auc = train_metrics$auc, training_tss = train_metrics$tss)
    )
  }

  compute_permutation_importance <- function(model, model_data, covariates, baseline_auc, n_perm = 5, seed = 42, threshold = sdm_default_threshold) {
    set.seed(seed)
    imp_results <- lapply(covariates, function(var) {
      perm_scores <- numeric(n_perm)
      for (p in seq_len(n_perm)) {
        mod_shuffled <- model_data
        perm_col <- sample(model_data[[var]])
        mod_shuffled[[var]] <- perm_col
        pred_shuffled <- as.numeric(predict(model, mod_shuffled[, covariates, drop = FALSE], clamp = TRUE, type = "link"))
        perm_auc <- compute_binary_metrics(model_data$presence, pred_shuffled, threshold = threshold)$auc
        perm_scores[p] <- baseline_auc - perm_auc
      }
      data.frame(
        variable = var,
        importance = mean(perm_scores, na.rm = TRUE),
        sd = if (length(perm_scores) > 1) sd(perm_scores, na.rm = TRUE) else 0,
        baseline_auc = baseline_auc,
        stringsAsFactors = FALSE
      )
    })
    data.table::rbindlist(imp_results)
  }

  predict_maxnet_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    if (!requireNamespace("maxnet", quietly = TRUE)) {
      stop("maxnet package is required for MaxEnt prediction but is not installed.", call. = FALSE)
    }
    if (!is.list(fit) || is.null(fit$model)) stop("fit must be a MaxEnt model fit result list.", call. = FALSE)

    if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)
    missing_covs <- setdiff(fit$covariates, names(env_project_scaled))
    if (length(missing_covs) > 0) {
      stop("The following covariates are missing from the projection stack: ", paste(missing_covs, collapse = ", "), call. = FALSE)
    }

    env_subset <- env_project_scaled[[fit$covariates]]
    log_message(log_fun, "Predicting MaxEnt suitability over ", terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster")

    suit <- terra::app(env_subset, fun = function(vals) {
      if (!all(is.finite(vals))) {
        return(rep(NA_real_, nrow(vals)))
      }
      df <- as.data.frame(vals, stringsAsFactors = FALSE)
      names(df) <- fit$covariates
      as.numeric(predict(fit$model, df, clamp = TRUE, type = "cloglog"))
    }, cores = n_cores)

    names(suit) <- "suitability"
    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
    log_message(log_fun, "Suitability raster written to: ", output_tif)
    suit
  }
} # end conditional on maxnet availability
