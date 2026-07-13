# Consolidated per-species pipeline function.
# Called by _targets.R branching — all stages (clean, covariates, fit, postprocess)
# run in a single call to reduce target overhead for DNN and other compute-heavy models.
# Predict (suit) and future projection are kept as separate targets for efficient
# raster storage via tar_terra_rast.

run_species <- function(row, seed = 42L) {
  cfg <- build_config_from_row(row, seed = seed)

  # Stage 1 + 2: Clean and load environment
  occ_clean <- sdm_stage_clean(cfg)
  env <- sdm_stage_covariates(cfg)

  # ENMeval tuning (conditional — uses shared block with CV sync + dashboard background)
  enmeval_tuned <- FALSE
  if (identical(cfg$tuning_method, "enmeval")) {
    tune_result <- run_enmeval_tune_block(
      cfg = cfg, occ = occ_clean$occ,
      env_train_scaled = env$env_train_scaled,
      background_n = cfg$background_n %||% sdm_default_background_n,
      cv_folds = cfg$cv_folds %||% sdm_default_cv_folds,
      cv_block_size_km = cfg$cv_block_size_km %||% NA_real_,
      seed = cfg$seed %||% 42L,
      n_cores = cfg$n_cores %||% 1
    )
    if (isTRUE(tune_result$success)) {
      enmeval_tuned <- TRUE
      bp <- tune_result$best_params %||% list()
      if (identical(cfg$model_id, "maxnet")) {
        cfg$maxnet_features <- bp$features %||% cfg$maxnet_features
        cfg$maxnet_regmult <- bp$regmult %||% cfg$maxnet_regmult
      } else if (identical(cfg$model_id, "rf")) {
        if (!is.null(bp$mtry)) cfg$rf_mtry <- as.integer(bp$mtry)
        if (!is.null(bp$min_node_size)) cfg$rf_min_node_size <- as.integer(bp$min_node_size)
      }
    }
  }

  # ENMeval null model (conditional — only when tuning ran and user requested null test)
  enmeval_null_p_value <- NULL
  if (enmeval_tuned && !is.null(tune_result$enmeval_object) &&
      isTRUE(cfg$enmeval_null_iterations > 0) &&
      requireNamespace("ENMeval", quietly = TRUE)) {
    null_res <- run_enmeval_null_block(
      enmeval_object = tune_result$enmeval_object,
      no.iter = cfg$enmeval_null_iterations %||% 100L,
      n_cores = cfg$n_cores %||% 1,
      seed = cfg$seed %||% 42L
    )
    if (isTRUE(null_res$success)) {
      enmeval_null_p_value <- null_res$p_value
      cfg$enmeval_null_p_value <- null_res$p_value
      cfg$enmeval_null_auc_mean <- null_res$null_auc_mean
      cfg$enmeval_null_auc_sd <- null_res$null_auc_sd
    }
  }

  # Stage 3: Fit model
  fit <- sdm_stage_fit(cfg, occ_clean$occ, env)

  # Stage 5: Post-process (EOO/AOO, importance, response curves)
  post <- sdm_stage_postprocess(cfg, fit$fit, NULL, env)

  list(
    cfg = cfg,
    occ = occ_clean$occ,
    env = env,
    fit = fit,
    post = post,
    species = cfg$species,
    model_id = cfg$model_id,
    enmeval_tuned = enmeval_tuned,
    enmeval_null_p_value = enmeval_null_p_value
  )
}
