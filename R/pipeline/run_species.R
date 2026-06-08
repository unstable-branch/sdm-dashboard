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

  # ENMeval tuning (conditional — only for maxnet with tuning method)
  enmeval_result <- NULL
  if (identical(cfg$model_id, "maxnet") && identical(cfg$tuning_method, "enmeval")) {
    enmeval_result <- tryCatch({
      if (!requireNamespace("ENMeval", quietly = TRUE)) {
        warning("ENMeval package not available for tuning — using manual params", call. = FALSE)
        NULL
      } else {
        occ_coords <- occ_clean$occ[, c("longitude", "latitude"), drop = FALSE]
        occ_coords <- occ_coords[complete.cases(occ_coords), , drop = FALSE]
        if (nrow(occ_coords) == 0) {
          warning("No valid occurrence coords for ENMeval — using manual params", call. = FALSE)
          NULL
        } else {
          tune_args <- cfg$enmeval_tune_args %||% sdm_default_enmeval_tune_args
          env_r <- env$env_train_scaled
          tune_enmeval(
            occ = occ_coords, env_rasters = env_r, bg = NULL,
            tune.args = tune_args,
            algorithm = cfg$enmeval_algorithm %||% "maxnet",
            partitions = cfg$enmeval_partitions %||% "block",
            partition.settings = list(kfolds = max(cfg$cv_folds %||% 5L, 3L)),
            selection_metric = cfg$enmeval_selection_metric %||% "auc.val.avg",
            categoricals = cfg$enmeval_categoricals %||% NULL,
            other.settings = cfg$enmeval_other_settings %||% sdm_default_enmeval_other_settings,
            n_cores = cfg$n_cores %||% 1, seed = cfg$seed %||% 42L
          )
        }
      }
    }, error = function(e) {
      warning("ENMeval tuning failed: ", conditionMessage(e), " — using manual params", call. = FALSE)
      NULL
    })
    if (is.list(enmeval_result) && isTRUE(enmeval_result$success)) {
      cfg$maxnet_features <- enmeval_result$best_params$features %||% cfg$maxnet_features
      cfg$maxnet_regmult <- enmeval_result$best_params$regmult %||% cfg$maxnet_regmult
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
    enmeval_tuned = is.list(enmeval_result) && isTRUE(enmeval_result$success)
  )
}
