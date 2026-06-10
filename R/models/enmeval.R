if (!requireNamespace("ENMeval", quietly = TRUE)) {
  if (interactive()) {
    message(
      "ENMeval package not installed — ENMeval tuning unavailable. ",
      "Install with: install.packages('ENMeval')"
    )
  }
} else {

build_enmeval_grid <- function(fc = c("L", "LQ", "LQH"),
                               rm = seq(0.5, 4, 0.5)) {
  expand.grid(fc = fc, rm = rm, stringsAsFactors = FALSE)
}

dashboard_enmeval_user_eval <- function(e) {
  results_tbl <- e@results
  n <- nrow(results_tbl)
  if (n == 0) return(data.frame(tss = numeric(), cbi = numeric(), stringsAsFactors = FALSE))
  tss_vals <- rep(NA_real_, n)
  cbi_vals <- rep(NA_real_, n)
  for (i in seq_len(n)) {
    pred_list <- tryCatch(e@models[[i]]@predictions, error = function(e) NULL)
    if (is.null(pred_list) || !is.list(pred_list) || length(pred_list) == 0) next
    first <- pred_list[[1]]
    if (!is.list(first) || !all(c("pred", "obs") %in% names(first))) next
    all_pred <- unlist(lapply(pred_list, `[[`, "pred"))
    all_obs <- unlist(lapply(pred_list, `[[`, "obs"))
    if (length(all_pred) == 0 || length(all_obs) == 0 || length(all_pred) != length(all_obs)) next
    metrics <- compute_binary_metrics(all_obs, all_pred, threshold = 0.5)
    tss_vals[i] <- metrics$tss
    cbi_vals[i] <- metrics$cbi
  }
  data.frame(tss = tss_vals, cbi = cbi_vals, stringsAsFactors = FALSE)
}

tune_enmeval <- function(occ, env_rasters, bg = NULL,
                         tune.args = list(fc = c("L", "LQ", "LQH"), rm = seq(0.5, 4, 0.5)),
                         algorithm = "maxnet",
                         partitions = "block",
                         partition.settings = list(kfolds = 5),
                         occs.grp = NULL,
                         bg.grp = NULL,
                         selection_metric = "auc.val.avg",
                         categoricals = NULL,
                         other.settings = list(pred.type = "cloglog", doClamp = TRUE),
                         n_cores = 1,
                         seed = 42,
                         log_fun = NULL) {
  if (!requireNamespace("ENMeval", quietly = TRUE)) {
    stop("ENMeval package required for tuning. Install with: install.packages('ENMeval')", call. = FALSE)
  }
  if (!inherits(env_rasters, "SpatRaster")) {
    stop("env_rasters must be a SpatRaster", call. = FALSE)
  }
  if (is.null(occ) || nrow(occ) == 0) {
    stop("occ must be a non-empty data.frame with longitude/latitude columns", call. = FALSE)
  }
  occ_coords <- occ[, c("longitude", "latitude"), drop = FALSE]
  occ_coords <- occ_coords[complete.cases(occ_coords), , drop = FALSE]
  if (nrow(occ_coords) == 0) {
    stop("No valid occurrence coordinates after removing NAs", call. = FALSE)
  }

  if (!is.null(bg)) {
    bg <- as.data.frame(bg)
    if (ncol(bg) >= 2) {
      bg <- bg[, 1:2, drop = FALSE]
      names(bg) <- c("longitude", "latitude")
    }
    bg <- bg[complete.cases(bg), , drop = FALSE]
  }

  if (is.null(names(tune.args)) || any(!nzchar(names(tune.args)))) {
    stop("tune.args must be a named list", call. = FALSE)
  }

  log_message(log_fun, "Running ENMeval tuning: ", algorithm,
    " with ", prod(vapply(tune.args, length, integer(1))),
    " combinations, ", partitions, " CV")

  tune_result <- tryCatch(
    ENMevaluate(
      occs = occ_coords,
      envs = env_rasters,
      bg = bg,
      tune.args = tune.args,
      partitions = partitions,
      algorithm = algorithm,
      partition.settings = partition.settings,
      occs.grp = occs.grp,
      bg.grp = bg.grp,
      categoricals = categoricals,
      other.settings = other.settings,
      parallel = n_cores > 1,
      numCores = n_cores,
      seed = seed,
      user.eval = dashboard_enmeval_user_eval
    ),
    error = function(e) {
      log_message(log_fun, "ENMeval tuning failed: ", conditionMessage(e))
      NULL
    }
  )

  if (is.null(tune_result)) {
    log_message(log_fun, "ENMeval returned NULL — falling back to default params")
    return(list(
      success = FALSE,
      enmeval_object = NULL,
      results_table = NULL,
      best_params = list(features = sdm_default_maxnet_features, regmult = sdm_default_maxnet_regmult),
      selection_metric = selection_metric,
      tuning_report = "ENMeval tuning failed; using defaults"
    ))
  }

  results_df <- tune_result@results
  if (is.null(results_df) || nrow(results_df) == 0) {
    log_message(log_fun, "ENMeval returned empty results — falling back to default params")
    return(list(
      success = FALSE,
      enmeval_object = tune_result,
      results_table = NULL,
      best_params = list(features = sdm_default_maxnet_features, regmult = sdm_default_maxnet_regmult),
      selection_metric = selection_metric,
      tuning_report = "ENMeval produced no results; using defaults"
    ))
  }

  # Map algorithm-specific column names to generic features/regmult
  if (identical(algorithm, "maxnet") || identical(algorithm, "maxent.jar")) {
    if (is.null(results_df$features) && !is.null(results_df$fc)) {
      results_df$features <- tolower(as.character(results_df$fc))
    }
    if (is.null(results_df$regmult) && !is.null(results_df$rm)) {
      results_df$regmult <- as.numeric(results_df$rm)
    }
  }
  if (identical(algorithm, "bioclim") && is.null(results_df$features)) {
    results_df$features <- "bioclim"
    results_df$regmult <- NA_real_
  }

  valid_metrics <- c("auc.val.avg", "auc.diff.avg", "or.mtp.avg", "or.10p.avg", "delta.AICc")
  if (!selection_metric %in% names(results_df)) {
    fallback <- intersect(valid_metrics, names(results_df))[1]
    log_message(log_fun, "Selection metric '", selection_metric, "' not available; falling back to '", fallback, "'")
    selection_metric <- fallback %||% "auc.val.avg"
  }

  results_sorted <- results_df[order(results_df[[selection_metric]],
    decreasing = !grepl("diff|or\\.|AICc", selection_metric),
    na.last = TRUE), , drop = FALSE]
  best_row <- results_sorted[1, , drop = FALSE]

  best_params <- list(
    features = as.character(best_row$features %||% sdm_default_maxnet_features),
    regmult = as.numeric(best_row$regmult %||% sdm_default_maxnet_regmult),
    auc_val_avg = as.numeric(best_row$auc.val.avg %||% NA_real_),
    auc_diff_avg = as.numeric(best_row$auc.diff.avg %||% NA_real_),
    or_mtp_avg = as.numeric(best_row$or.mtp.avg %||% NA_real_),
    or_10p_avg = as.numeric(best_row$or.10p.avg %||% NA_real_),
    delta_aicc = as.numeric(best_row$delta.AICc %||% NA_real_),
    aicc = as.numeric(best_row$AICc %||% NA_real_)
  )

  log_message(log_fun, "ENMeval best: features=", best_params$features,
    " regmult=", sprintf("%.1f", best_params$regmult),
    " ", selection_metric, "=", sprintf("%.3f", best_row[[selection_metric]] %||% NA_real_))

  list(
    success = TRUE,
    enmeval_object = tune_result,
    results_table = results_df,
    results_sorted = results_sorted,
    best_params = best_params,
    selection_metric = selection_metric,
    tuning_report = sprintf(
      "ENMeval tuning: %s with %s\nBest: features=%s, regmult=%.1f\n%s: %.3f",
      algorithm, partitions,
      best_params$features, best_params$regmult,
      selection_metric, as.numeric(best_row[[selection_metric]] %||% NA_real_)
    )
  )
}

# Shared ENMeval tuning block used by both run_fast_sdm() and run_species().
# Prepares data with dashboard bias methods and syncs CV partitions.
# Supports any algorithm registered in sdm_enmdetails_registry.
run_enmeval_tune_block <- function(cfg, occ, env_train_scaled,
                                   background_n, cv_folds, cv_block_size_km,
                                   seed, n_cores, log_fun = NULL) {
  if (!identical(cfg$tuning_method, "enmeval")) {
    return(list(success = FALSE, best_params = NULL))
  }
  if (!requireNamespace("ENMeval", quietly = TRUE)) {
    log_message(log_fun, "ENMeval package not available — using manual params")
    return(list(success = FALSE, best_params = NULL))
  }

  enmeval_algorithm <- cfg$enmeval_algorithm %||% "maxnet"
  if (!has_enmdetails(enmeval_algorithm)) {
    log_message(log_fun, "ENMeval algorithm '", enmeval_algorithm, "' not registered — using manual params")
    return(list(success = FALSE, best_params = NULL))
  }

  log_message(log_fun, "Tuning via ENMeval: algorithm=", enmeval_algorithm,
    " partitions=", cfg$enmeval_partitions %||% "block")

  tune_args <- cfg$enmeval_tune_args %||% sdm_default_enmeval_tune_args
  grid_size <- prod(vapply(tune_args, length, integer(1)))
  cv_folds_val <- max(cv_folds, 3L)
  total_fits <- grid_size * cv_folds_val
  if (total_fits > 500) {
    log_message(log_fun, "  Large tuning grid: ", grid_size, " combinations x ", cv_folds_val,
      " folds = ", total_fits, " total model fits. This may take significant time.")
  }
  if (total_fits > 2000) {
    log_message(log_fun, "  WARNING: ", total_fits, " model fits is very large. Consider reducing the tuning grid ",
      "or enabling parallel processing for faster results.")
  }

  tune_data <- tryCatch(
    prepare_sdm_data(occ, env_train_scaled, background_n,
      seed = seed, log_fun = log_fun,
      bias_method = cfg$bias_method %||% "uniform",
      target_group_occ = cfg$target_group_occ,
      thickening_distance_km = cfg$thickening_distance_km
    ),
    error = function(e) {
      log_message(log_fun, "  Data preparation for ENMeval failed: ", conditionMessage(e))
      NULL
    }
  )
  if (is.null(tune_data) || nrow(tune_data$model_data) == 0 || length(tune_data$covariates) == 0) {
    log_message(log_fun, "  ENMeval tuning skipped: could not prepare model data")
    return(list(success = FALSE, best_params = NULL))
  }

  occ_coords <- occ[, c("longitude", "latitude"), drop = FALSE]
  occ_coords <- occ_coords[complete.cases(occ_coords), , drop = FALSE]

  env_for_tune <- terra::subset(env_train_scaled, tune_data$covariates)

  fold_info <- tryCatch(
    make_cv_folds_spatial_blocks(
      x = tune_data$model_data$.x, y = tune_data$model_data$.y,
      presence = tune_data$model_data$presence,
      k = max(cv_folds, 3L), block_size_km = cv_block_size_km, seed = seed
    ),
    error = function(e) { list(fold_id = NULL) }
  )
  occs_grp <- if (!is.null(fold_info$fold_id)) {
    fold_info$fold_id[tune_data$model_data$presence == 1]
  } else NULL
  bg_grp <- if (!is.null(fold_info$fold_id)) {
    fold_info$fold_id[tune_data$model_data$presence == 0]
  } else NULL

  bg_for_tune <- tune_data$model_data[tune_data$model_data$presence == 0,
    c(".x", ".y"), drop = FALSE]
  names(bg_for_tune) <- c("longitude", "latitude")

  tune_result <- tryCatch(
    tune_enmeval(
      occ = cbind(occ_coords, presence = 1),
      env_rasters = env_for_tune,
      bg = bg_for_tune,
      tune.args = tune_args,
      algorithm = enmeval_algorithm,
      partitions = cfg$enmeval_partitions %||% "block",
      partition.settings = list(kfolds = max(cv_folds, 3L)),
      occs.grp = occs_grp,
      bg.grp = bg_grp,
      selection_metric = cfg$enmeval_selection_metric %||% "auc.val.avg",
      categoricals = cfg$enmeval_categoricals,
      other.settings = cfg$enmeval_other_settings %||% sdm_default_enmeval_other_settings,
      n_cores = n_cores, seed = seed, log_fun = log_fun
    ),
    error = function(e) {
      log_message(log_fun, "  ENMeval tuning failed: ", conditionMessage(e))
      list(success = FALSE, best_params = NULL)
    }
  )

  enmeval_object <- if (is.list(tune_result$enmeval_object)) tune_result$enmeval_object else NULL

  if (isTRUE(tune_result$success)) {
    list(
      success = TRUE,
      best_params = tune_result$best_params,
      tuning_report = tune_result$tuning_report,
      selection_metric = tune_result$selection_metric,
      algorithm = enmeval_algorithm,
      enmeval_object = enmeval_object
    )
  } else {
    log_message(log_fun, "  ENMeval failed — using manual or fallback params")
    list(success = FALSE, best_params = NULL)
  }
}

# Null model significance testing via ENMeval::ENMnulls().
# Takes an ENMevaluation object from tuning and re-runs with randomized occurrences.
run_enmeval_null_block <- function(enmeval_object, no.iter = 100,
                                   n_cores = 1, seed = 42, log_fun = NULL) {
  if (is.null(enmeval_object)) {
    log_message(log_fun, "No ENMeval object provided — cannot run null model")
    return(list(success = FALSE, p_value = NA_real_, null_auc_mean = NA_real_, null_auc_sd = NA_real_))
  }
  if (!requireNamespace("ENMeval", quietly = TRUE)) {
    log_message(log_fun, "ENMeval package not available — cannot run null model")
    return(list(success = FALSE, p_value = NA_real_, null_auc_mean = NA_real_, null_auc_sd = NA_real_))
  }

  log_message(log_fun, "Running ENMeval null model (", no.iter, " iterations, ",
    n_cores, " cores) — this may take significant time")

  null_result <- tryCatch(
    ENMnulls(
      e = enmeval_object,
      no.iter = no.iter,
      null.method = "randomizeOccs",
      parallel = n_cores > 1,
      numCores = n_cores,
      seed = seed
    ),
    error = function(e) {
      log_message(log_fun, "ENMeval null model failed: ", conditionMessage(e))
      NULL
    }
  )

  if (is.null(null_result)) {
    return(list(success = FALSE, p_value = NA_real_, null_auc_mean = NA_real_, null_auc_sd = NA_real_))
  }

  null_results_tbl <- null_result@null.results
  p_value <- tryCatch(null_results_tbl$p.value[1], error = function(e) NA_real_)
  null_auc_mean <- tryCatch(mean(null_results_tbl$auc.val.avg, na.rm = TRUE), error = function(e) NA_real_)
  null_auc_sd <- tryCatch(sd(null_results_tbl$auc.val.avg, na.rm = TRUE), error = function(e) NA_real_)

  log_message(log_fun, "Null model: p=", sprintf("%.4f", p_value),
    " null AUC=", sprintf("%.3f", null_auc_mean),
    " +/- ", sprintf("%.3f", null_auc_sd))

  list(
    success = TRUE,
    p_value = as.numeric(p_value),
    null_auc_mean = as.numeric(null_auc_mean),
    null_auc_sd = as.numeric(null_auc_sd),
    n_iterations = no.iter,
    null_results = null_results_tbl
  )
}

} # end conditional on ENMeval
