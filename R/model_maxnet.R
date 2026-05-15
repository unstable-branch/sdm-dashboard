# MaxEnt SDM via the maxnet package (glmnet backend, no Java required).

if (!requireNamespace("maxnet", quietly = TRUE)) {
  if (interactive()) {
    message("maxnet package not installed — MaxEnt backend unavailable. ",
            "Install with: install.packages('maxnet')")
  }
} else {

sdm_default_maxnet_features <- "lqp"
sdm_default_maxnet_regmult <- 1.0

cross_validate_maxnet <- function(model_data, covariates, maxnet_features, maxnet_regmult, k = 3,
                                  seed = 42, n_cores = 1,
                                  cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                                  threshold = sdm_default_threshold) {
  k <- as.integer(k)
  cv_strategy <- normalize_cv_strategy(cv_strategy)
  threshold <- normalize_threshold(threshold)
  if (is.na(k) || k < 2) {
    return(list(k = 0, strategy = cv_strategy, auc_mean = NA_real_, auc_sd = NA_real_,
                tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
                fold_metrics = data.frame(), fold_sizes = data.frame()))
  }
  k <- min(k, sum(model_data$presence == 1), sum(model_data$presence == 0))
  if (k < 2) {
    return(list(k = 0, strategy = cv_strategy, auc_mean = NA_real_, auc_sd = NA_real_,
                tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
                fold_metrics = data.frame(), fold_sizes = data.frame()))
  }
  n_cores <- min(normalize_core_count(n_cores), k)

  block_id <- NULL
  block_size_mode <- "not_applicable"
  block_size_used <- NA_real_
  if (identical(cv_strategy, "spatial_blocks") && all(c(".x", ".y") %in% names(model_data))) {
    folds <- make_cv_folds_spatial_blocks(model_data$.x, model_data$.y, model_data$presence, k = k,
                                          block_size_km = normalize_cv_block_size_km(cv_block_size_km), seed = seed)
    fold_id <- folds$fold_id
    block_id <- folds$block_id
    block_size_mode <- folds$block_size_mode
    block_size_used <- folds$block_size_km
    k <- max(fold_id, na.rm = TRUE)
  } else {
    cv_strategy <- "random"
    fold_id <- make_cv_folds_random(model_data$presence, k = k, seed = seed)
  }
  fold_sizes <- summarise_cv_folds(fold_id, model_data$presence, block_id = block_id)

  fit_one_fold <- function(i, model_data_arg, fold_id_arg, covariates_arg, maxnet_features_arg, maxnet_regmult_arg, threshold_arg) {
    train <- model_data_arg[fold_id_arg != i, , drop = FALSE]
    test <- model_data_arg[fold_id_arg == i, , drop = FALSE]
    train_xy <- train[, c(".x", ".y"), drop = FALSE]
    test_xy <- test[, c(".x", ".y"), drop = FALSE]
    train_model <- train[, !names(train) %in% c(".x", ".y"), drop = FALSE]
    test_model <- test[, !names(test) %in% c(".x", ".y"), drop = FALSE]
    y_train <- as.integer(train_model$presence)
    train_pa <- cbind(data.frame(presence = y_train), train_model[, covariates_arg, drop = FALSE])
    names(train_pa) <- c("presence", covariates_arg)
    maxnet_data <- maxnet::maxnet.formula(presence ~ ., data = train_pa, maxnet.formula.arguments(maxnet_features_arg, maxnet_regmult_arg))
    maxnet_model <- maxnet::maxnet(maxnet_data, data = train_pa)
    pred <- as.numeric(maxnet::predict.maxnet(maxnet_model, test_model[, covariates_arg, drop = FALSE], clamp = TRUE, type = "link"))
    metrics_list_to_row(compute_binary_metrics(test_model$presence, pred, threshold = threshold_arg), fold = i)
  }

  run_single_core_cv <- function() {
    do.call(rbind, lapply(seq_len(k), fit_one_fold,
                          model_data_arg = model_data, fold_id_arg = fold_id,
                          covariates_arg = covariates, maxnet_features_arg = maxnet_features,
                          maxnet_regmult_arg = maxnet_regmult, threshold_arg = threshold))
  }

  fold_metrics <- if (n_cores > 1 && k > 1) {
    parallel_result <- tryCatch({
      cl <- parallel::makeCluster(n_cores)
      on.exit(parallel::stopCluster(cl), add = TRUE)
      parallel::clusterEvalQ(cl, library(maxnet, quietly = TRUE))
      parallel::clusterExport(cl, c("auc_rank", "compute_binary_metrics", "metrics_list_to_row", "make.names"), envir = environment())
      rows <- parallel::parLapply(cl, seq_len(k), fit_one_fold,
                                   model_data_arg = model_data, fold_id_arg = fold_id,
                                   covariates_arg = covariates, maxnet_features_arg = maxnet_features,
                                   maxnet_regmult_arg = maxnet_regmult, threshold_arg = threshold)
      do.call(rbind, rows)
    }, error = function(e) e)
    if (inherits(parallel_result, "error")) {
      warning("Parallel cross-validation failed; falling back to single-core CV: ", conditionMessage(parallel_result), call. = FALSE)
      run_single_core_cv()
    } else {
      parallel_result
    }
  } else {
    run_single_core_cv()
  }

  list(
    k = k,
    strategy = cv_strategy,
    block_size_km = block_size_used,
    block_size_mode = block_size_mode,
    fold_sizes = fold_sizes,
    fold_metrics = fold_metrics,
    auc_mean = metric_mean(fold_metrics$auc),
    auc_sd = metric_sd(fold_metrics$auc),
    tss_mean = metric_mean(fold_metrics$tss),
    tss_sd = metric_sd(fold_metrics$tss),
    sensitivity_mean = metric_mean(fold_metrics$sensitivity),
    specificity_mean = metric_mean(fold_metrics$specificity),
    fold_auc = fold_metrics$auc
  )
}

fit_maxnet_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                           include_quadratic = TRUE, cv_folds = 3, seed = 42, n_cores = 1,
                           log_fun = NULL, cv_strategy = sdm_default_cv_strategy,
                           cv_block_size_km = sdm_default_cv_block_size_km,
                           threshold = sdm_default_threshold, maxnet_features = sdm_default_maxnet_features,
                           maxnet_regmult = sdm_default_maxnet_regmult) {

  if (!requireNamespace("maxnet", quietly = TRUE)) {
    stop("maxnet package is required for MaxEnt fitting but is not installed.", call. = FALSE)
  }

  covariates <- names(env_train_scaled)
  if (length(covariates) < 2) stop("At least two covariates are required for modelling.", call. = FALSE)

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  if (sum(!pres_keep) > 0) log_message(log_fun, "Dropped ", sum(!pres_keep), " occurrence records with missing covariates")
  pres_vals <- pres_vals[pres_keep, , drop = FALSE]
  pres_xy_used <- pres_xy[pres_keep, , drop = FALSE]
  occ_used <- occ[pres_keep, , drop = FALSE]
  if (nrow(pres_vals) < 20) stop("Too few presence records with complete environmental data.", call. = FALSE)

  bg_xy <- sample_background_points(env_train_scaled, background_n, seed = seed, presence_xy = pres_xy_used)
  bg_vals <- extract_covariates(env_train_scaled, bg_xy)
  bg_keep <- stats::complete.cases(bg_vals)
  bg_vals <- bg_vals[bg_keep, , drop = FALSE]
  bg_xy <- bg_xy[bg_keep, , drop = FALSE]
  if (nrow(bg_vals) < 100) stop("Too few background points could be sampled.", call. = FALSE)

  model_data <- rbind(
    data.frame(presence = 1L, pres_vals, .x = pres_xy_used$x, .y = pres_xy_used$y, check.names = FALSE),
    data.frame(presence = 0L, bg_vals, .x = bg_xy$x, .y = bg_xy$y, check.names = FALSE)
  )
  names(model_data) <- make.names(names(model_data))
  covariates <- make.names(covariates)

  log_message(log_fun, "Fitting MaxEnt SDM with ", nrow(pres_vals), " presences and ", nrow(bg_vals), " background points")

  maxnet_pa <- cbind(data.frame(presence = model_data$presence), model_data[, covariates, drop = FALSE])
  names(maxnet_pa)[-1] <- covariates
  maxnet_formula_args <- maxnet::maxnet.formula.arguments(maxnet_features, maxnet_regmult)
  maxnet_data <- maxnet::maxnet.formula(presence ~ ., data = maxnet_pa, maxnet_formula_args)
  model <- maxnet::maxnet(maxnet_data, data = maxnet_pa)

  model_for_auc <- model_data[, !names(model_data) %in% c(".x", ".y"), drop = FALSE]
  train_pred <- as.numeric(maxnet::predict.maxnet(model, model_for_auc[, covariates, drop = FALSE], clamp = TRUE, type = "link"))
  train_metrics <- compute_binary_metrics(model_for_auc$presence, train_pred, threshold = threshold)

  cv <- cross_validate_maxnet(model_data, covariates, maxnet_features, maxnet_regmult, k = cv_folds, seed = seed,
                              n_cores = n_cores, cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
                              threshold = threshold)
  if (is.finite(cv$auc_mean)) {
    log_message(log_fun, "Cross-validation (", cv$strategy, ") AUC: ", sprintf("%.3f", cv$auc_mean),
                if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else "")
  }

  coefficients <- data.frame(
    term = rownames(maxnet::coef.maxnet(model)),
    estimate = as.numeric(maxnet::coef.maxnet(model)),
    row.names = NULL,
    stringsAsFactors = FALSE
  )

  perm_importance <- compute_permutation_importance(model, model_for_auc, covariates, train_metrics$auc,
                                                     n_perm = 5, seed = seed, threshold = threshold)

  list(
    model = model,
    formula = NULL,
    coefficients = coefficients,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = perm_importance
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
      pred_shuffled <- as.numeric(maxnet::predict.maxnet(model, mod_shuffled[, covariates, drop = FALSE], clamp = TRUE, type = "link"))
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
  do.call(rbind, imp_results)
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
    if (!all(is.finite(vals))) return(rep(NA_real_, nrow(vals)))
    df <- as.data.frame(vals, stringsAsFactors = FALSE)
    names(df) <- fit$covariates
    as.numeric(maxnet::predict.maxnet(fit$model, df, clamp = TRUE, type = "link"))
  }, cores = n_cores)

  names(suit) <- "suitability"
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
  log_message(log_fun, "Suitability raster written to: ", output_tif)
  suit
}

} # end conditional on maxnet availability