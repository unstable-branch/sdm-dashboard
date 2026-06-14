sdm_config <- function(...) {
  cfg <- list(...)

  if (length(cfg) == 1 && inherits(cfg[[1]], "sdm_config")) {
    return(cfg[[1]])
  }

  defaults <- list(
    species = sdm_default_species,
    species_filter = NULL,
    occurrence_file = sdm_default_occurrence_file,
    worldclim_dir = sdm_default_worldclim_dir,
    selected_biovars = sdm_default_biovars,
    projection_extent = sdm_default_projection_extent,
    training_extent = NULL,
    background_n = sdm_default_background_n,
    min_source_records = sdm_default_min_source_records,
    merge_small_sources = TRUE,
    thin_by_cell = TRUE,
    model_id = sdm_default_model_id,
    include_quadratic = TRUE,
    threshold = sdm_default_threshold,
    aggregation_factor = sdm_default_aggregation_factor,
    cv_folds = sdm_default_cv_folds,
    n_cores = NULL,
    allow_download = TRUE,
    worldclim_res = sdm_default_worldclim_res,
    cv_strategy = sdm_default_cv_strategy,
    cv_block_size_km = sdm_default_cv_block_size_km,
    use_elevation = FALSE,
    elevation_demtype = sdm_default_elevation_demtype,
    opentopo_api_key = NULL,
    use_soil = FALSE,
    selected_soil_vars = sdm_default_soil_vars,
    selected_soil_depths = sdm_default_soil_depths,
    use_uv = FALSE,
    selected_uv_vars = sdm_default_uv_vars,
    selected_uv_months = NULL,
    use_vegetation = FALSE,
    veg_year = sdm_default_veg_year,
    veg_products = sdm_default_veg_products,
    use_lulc = FALSE,
    lulc_year = sdm_default_lulc_year,
    use_hfp = FALSE,
    hfp_year = sdm_default_hfp_year,
    use_bioclim_season = FALSE,
    use_drought = FALSE,
    selected_drought_periods = "annual_mean",
    selected_chelsa_extras = NULL,
    covariate_cache_dir = sdm_default_covariate_cache_dir,
    vif_reduction = FALSE,
    vif_threshold = 10,
    future_projection = FALSE,
    future_worldclim_dir = sdm_default_future_worldclim_dir,
    future_label = "Future climate",
    future_worldclim_dir2 = NULL,
    future_label2 = "Future climate 2",
    maxnet_features = sdm_default_maxnet_features,
    maxnet_regmult = sdm_default_maxnet_regmult,
    bias_method = "uniform",
    target_group_occ = NULL,
    thickening_distance_km = NULL,
    use_cc = FALSE,
    cc_tests = "all",
    cleaned_occurrence = NULL,
    output_dir = sdm_default_output_dir,
    seed = sdm_default_seed,
    analysis_crs = sdm_default_analysis_crs,
    occurrence_source = NULL,
    gbif_doi = NULL,
    log_fun = NULL,
    progress_fun = NULL,
    source = sdm_default_climate_source,
    multi_ensemble_models = NULL,
    multi_ensemble_weighting = sdm_default_multi_ensemble_weighting,
    multi_ensemble_power = sdm_default_ensemble_power,
    multi_ensemble_min_auc = sdm_default_ensemble_min_auc,
    multi_ensemble_min_tss = sdm_default_ensemble_min_tss,
    multi_ensemble_export = TRUE,
    multi_ensemble_uncertainty = sdm_default_multi_ensemble_uncertainty,
    biomod2_models = NULL,
    esm_n_runs = sdm_esm_default_n_runs,
    esm_split = sdm_esm_default_split,
    esm_min_auc = sdm_esm_default_min_auc,
    esm_power = sdm_esm_default_power,
    esm_biovars = NULL,
    rangebag_n_bags = sdm_default_rangebag_n_bags,
    rangebag_bag_fraction = sdm_default_rangebag_fraction,
    rangebag_vars_per_bag = sdm_default_rangebag_vars_per_bag,
    maxnet_auto_tune = FALSE,
    tuning_method = sdm_default_tuning_method,
    enmeval_algorithm = sdm_default_enmeval_algorithm,
    enmeval_partitions = sdm_default_enmeval_partitions,
    enmeval_selection_metric = sdm_default_enmeval_selection_metric,
    enmeval_tune_args = sdm_default_enmeval_tune_args,
    enmeval_categoricals = sdm_default_enmeval_categoricals,
    enmeval_other_settings = sdm_default_enmeval_other_settings,
    enmeval_null_iterations = sdm_default_enmeval_null_iterations,
    rf_num_trees = 500L,
    rf_mtry = NA_integer_,
    rf_min_node_size = 10L,
    gam_k = 5L,
    xgb_max_depth = 6L,
    xgb_eta = 0.3,
    xgb_nrounds = 100L,
    dnn_model_type = "DNN_Medium",
    dnn_dropout = 0.3,
    dnn_lambda = 0.001,
    dnn_n_seeds = 5L,
    dnn_device = "auto",
    dnn_fused_adam = "auto",
    dnn_mixed_precision = "auto",
    dnn_cuda_graphs = "off",
    dnn_mc_samples = 0L,
    dnn_uncertainty_method = "none",
    dnn_multispecies_architecture = "DNN_Medium",
    dnn_multispecies_n_seeds = 3L,
    overlap_warn = FALSE,
    validation_occurrences = sdm_default_validation_occurrences,
    pa_replicates = 1,
    climate_matching = FALSE,
    climate_matching_method = "mahalanobis",
    generate_tiles = sdm_default_generate_tiles
  )

  for (nm in names(defaults)) {
    if (is.null(cfg[[nm]])) {
      cfg[[nm]] <- defaults[[nm]]
    }
  }

  cfg$selected_biovars <- validate_biovars(cfg$selected_biovars)
  if (is.null(cfg$projection_extent) || length(cfg$projection_extent) == 0 || all(is.na(cfg$projection_extent))) {
    stop("sdm_config: projection_extent is required. Set a valid spatial extent or use 'occurrence' preset.", call. = FALSE)
  }
  cfg$projection_extent <- validate_extent(as.numeric(cfg$projection_extent), "projection_extent")
  if (!is.null(cfg$training_extent)) {
    cfg$training_extent <- validate_extent(as.numeric(cfg$training_extent), "training_extent")
  }
  cfg$model_id <- validate_sdm_model_id(cfg$model_id)

  if (is.null(cfg$occurrence_file) || is.na(cfg$occurrence_file)) {
    stop("sdm_config: occurrence_file is required", call. = FALSE)
  }

  if (is.null(cfg$cv_folds) || is.na(cfg$cv_folds) || cfg$cv_folds < 2) {
    cfg$cv_folds <- 0L
  }

  structure(cfg, class = "sdm_config")
}

is.sdm_config <- function(x) inherits(x, "sdm_config")

format.sdm_config <- function(x, ...) {
  sprintf("<sdm_config: %s | %d biovars | %s model>",
          x$species %||% "?",
          length(x$selected_biovars %||% integer()),
          x$model_id %||% "?")
}

print.sdm_config <- function(x, ...) {
  cat(format(x), "\n")
  invisible(x)
}