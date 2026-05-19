# Generic cross-validation engine for SDM models.
# Extracted from cross_validate_glm and cross_validate_maxnet to eliminate ~80% code duplication.
# Supports: random, spatial_blocks, stratified_random, presence_only_stratified, custom fold_id.

cross_validate_model <- function(model_data, k, seed, n_cores,
                                 cv_strategy, cv_block_size_km, threshold,
                                 fit_fun, cluster_setup_fn = NULL,
                                 cluster_exports = NULL,
                                 fold_id = NULL,
                                 log_fun = NULL) {
  k <- as.integer(k)
  cv_strategy <- normalize_cv_strategy(cv_strategy)
  threshold <- normalize_threshold(threshold)
  if (is.na(k) || k < 2) {
    return(list(
      k = 0, strategy = cv_strategy, auc_mean = NA_real_, auc_sd = NA_real_,
      tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
      fold_metrics = data.frame(), fold_sizes = data.frame()
    ))
  }

  block_id <- NULL
  block_size_mode <- "not_applicable"
  block_size_used <- NA_real_

  if (!is.null(fold_id)) {
    k <- max(fold_id, na.rm = TRUE)
    if (k < 2) {
      return(list(
        k = 0, strategy = "custom", auc_mean = NA_real_, auc_sd = NA_real_,
        tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
        fold_metrics = data.frame(), fold_sizes = data.frame()
      ))
    }
  } else if (identical(cv_strategy, "spatial_blocks") && all(c(".x", ".y") %in% names(model_data))) {
    folds <- make_cv_folds_spatial_blocks(model_data$.x, model_data$.y, model_data$presence,
      k = k,
      block_size_km = normalize_cv_block_size_km(cv_block_size_km), seed = seed
    )
    fold_id <- folds$fold_id
    block_id <- folds$block_id
    block_size_mode <- folds$block_size_mode
    block_size_used <- folds$block_size_km
    k <- max(fold_id, na.rm = TRUE)
  } else if (identical(cv_strategy, "stratified_random")) {
    pres_idx <- which(model_data$presence == 1)
    bg_idx <- which(model_data$presence == 0)
    fold_id <- integer(nrow(model_data))
    fold_id[pres_idx] <- sample(rep(seq_len(k), length.out = length(pres_idx)))
    fold_id[bg_idx] <- sample(rep(seq_len(k), length.out = length(bg_idx)))
    cv_strategy <- "stratified_random"
  } else {
    cv_strategy <- "random"
    fold_id <- make_cv_folds_random(model_data$presence, k = k, seed = seed)
  }

  if (is.null(block_id)) {
    effective_k <- max(fold_id[fold_id > 0], na.rm = TRUE)
    if (is.finite(effective_k) && effective_k >= 2) {
      k <- effective_k
    }
  }

  if (k < 2) {
    return(list(
      k = 0, strategy = cv_strategy, auc_mean = NA_real_, auc_sd = NA_real_,
      tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
      fold_metrics = data.frame(), fold_sizes = data.frame()
    ))
  }

  n_cores <- min(normalize_core_count(n_cores), k)
  fold_sizes <- summarise_cv_folds(fold_id, model_data$presence, block_id = block_id)

  fit_one_fold <- function(i) fit_fun(i, model_data, fold_id, threshold)

  run_single_core_cv <- function() {
    do.call(rbind, lapply(seq_len(k), fit_one_fold))
  }

  fold_metrics <- if (n_cores > 1 && k > 1) {
    cl <- parallel::makeCluster(n_cores)
    on.exit(parallel::stopCluster(cl), add = TRUE)
    if (is.function(cluster_setup_fn)) {
      cluster_setup_fn(cl)
    }
    if (!is.null(cluster_exports) && length(cluster_exports) > 0) {
      parallel::clusterExport(cl, cluster_exports, envir = environment())
    }
    parallel_result <- tryCatch(
      {
        rows <- parallel::parLapply(cl, seq_len(k), fit_one_fold)
        do.call(rbind, rows)
      },
      error = function(e) e
    )
    if (inherits(parallel_result, "error")) {
      log_message(log_fun, "Parallel CV failed; falling back to single-core: ", conditionMessage(parallel_result))
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
