handle_config_defaults <- function(res, app_dir) {
  list(
    biovars = sdm_default_biovars,
    background_n = sdm_default_background_n,
    cv_folds = sdm_default_cv_folds,
    cv_strategy = sdm_default_cv_strategy,
    threshold = sdm_default_threshold,
    extent_presets = sdm_extent_choices,
    analysis_crs = sdm_default_analysis_crs,
    analysis_crs_choices = lapply(seq_along(sdm_analysis_crs_choices), function(i) {
      list(value = unname(sdm_analysis_crs_choices[i]), label = names(sdm_analysis_crs_choices)[i])
    }),
    enmeval_available = requireNamespace("ENMeval", quietly = TRUE),
    tuning_methods = list(
      list(id = "none", label = "Manual (use provided parameters)"),
      list(id = "enmeval", label = "ENMeval (automated hyperparameter tuning)")
    )
  )
}

handle_models_list <- function(res, app_dir) {
  ids <- sdm_model_ids()
  lapply(ids, function(id) {
    spec <- get_sdm_model(id)
    tier <- COMPLEXITY_MODEL_TIERS[id]
    if (is.na(tier)) tier <- "moderate"
    list(
      id = id,
      label = spec$label,
      maturity = spec$maturity,
      min_records = if (!is.na(spec$min_records)) spec$min_records else NULL,
      packages = spec$packages,
      notes = if (length(spec$notes) > 0) paste(spec$notes, collapse = " ") else "",
      complexity_tier = tier,
      enmeval_compatible = isTRUE(spec$enmeval_compatible),
      enmeval_algorithm = spec$enmeval_algorithm %||% NULL,
      available = TRUE,
      supports_uncertainty = isTRUE(spec$supports_uncertainty)
    )
  })
}
