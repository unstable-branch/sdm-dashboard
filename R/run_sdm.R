# Public orchestration API for the SDM workflow.

run_fast_sdm <- function(species = sdm_default_species, occurrence_file = sdm_default_occurrence_file, worldclim_dir = sdm_default_worldclim_dir,
                         selected_biovars = sdm_default_biovars, projection_extent = sdm_default_projection_extent,
                         training_extent = NULL, background_n = sdm_default_background_n, min_source_records = sdm_default_min_source_records, merge_small_sources = TRUE,
                         thin_by_cell = TRUE, model_id = sdm_default_model_id,
                         include_quadratic = TRUE, threshold = sdm_default_threshold, aggregation_factor = sdm_default_aggregation_factor,
                         cv_folds = sdm_default_cv_folds, n_cores = NULL, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                         cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                         use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
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
                         lulc_year = 2020,
                         use_hfp = FALSE,
                         hfp_year = 2020,
                         use_bioclim_season = FALSE,
                         use_drought = FALSE,
                         selected_drought_periods = "annual_mean",
                         selected_chelsa_extras = NULL,
                         covariate_cache_dir = sdm_default_covariate_cache_dir,
                         vif_reduction = FALSE, vif_threshold = 10,
                         future_projection = FALSE, future_worldclim_dir = sdm_default_future_worldclim_dir,
                         future_label = "Future climate",
                         maxnet_features = sdm_default_maxnet_features, maxnet_regmult = sdm_default_maxnet_regmult,
                         bias_method = c("uniform", "target_group", "thickened"),
                         target_group_occ = NULL,
                         thickening_distance_km = NULL,
                         use_cc = FALSE, cc_tests = "all",
                         cleaned_occurrence = NULL,
                         output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = NULL,
                         gbif_doi = NULL, log_fun = NULL, progress_fun = NULL,
                         source = sdm_default_climate_source,
                         multi_ensemble_models = NULL,
                         multi_ensemble_weighting = sdm_default_multi_ensemble_weighting,
                         multi_ensemble_power = sdm_default_ensemble_power,
                         multi_ensemble_min_auc = sdm_default_ensemble_min_auc,
                         multi_ensemble_min_tss = sdm_default_ensemble_min_tss,
                         multi_ensemble_export = TRUE,
                         biomod2_models = NULL,
                         esm_n_runs = sdm_esm_default_n_runs,
                         esm_split = sdm_esm_default_split,
                         esm_min_auc = sdm_esm_default_min_auc,
                         esm_power = sdm_esm_default_power,
                         esm_biovars = NULL,
                         overlap_warn = FALSE,
                         validation_occurrences = sdm_default_validation_occurrences) {
  ensure_sdm_packages("terra", n_cores = n_cores)
  n_cores <- configure_parallel(n_cores, log_fun = log_fun)
  projection_extent <- validate_extent(as.numeric(projection_extent), "projection_extent")
  if (!is.null(training_extent)) training_extent <- validate_extent(as.numeric(training_extent), "training_extent")
  selected_biovars <- validate_biovars(selected_biovars)
  model_id <- validate_sdm_model_id(model_id)
  model_spec <- get_sdm_model(model_id)
  threshold <- normalize_threshold(threshold)
  aggregation_factor <- as.integer(aggregation_factor)
  if (is.na(aggregation_factor) || aggregation_factor < 1) aggregation_factor <- 1
  selected_soil_vars <- unique(as.character(selected_soil_vars))
  selected_soil_vars <- selected_soil_vars[nzchar(selected_soil_vars)]
  check_cancelled <- function(log_fun = NULL) {
    if (isTRUE(getOption("sdm_cancelled"))) {
      log_message(log_fun, "Run cancelled by user")
      return(TRUE)
    }
    FALSE
  }

  start_time <- Sys.time()
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  dir.create(covariate_cache_dir, recursive = TRUE, showWarnings = FALSE)

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }

  progress_step(progress_fun, 0.10, "Cleaning occurrence data")
  if (!is.null(occurrence_source) && nzchar(occurrence_source)) log_message(log_fun, "Observation record source: ", occurrence_source)
  if (!is.null(cleaned_occurrence) && is.list(cleaned_occurrence) && is.data.frame(cleaned_occurrence$df) && nrow(cleaned_occurrence$df) > 0) {
    occ <- cleaned_occurrence$df
    cleaned <- list(occ = occ, removed_bad_coordinates = 0, removed_duplicates = 0, original_rows = nrow(occ), columns = colnames(occ))
    if (is.null(occ$cc_flag)) occ$cc_flag <- FALSE
  } else {
    cleaned <- clean_occurrences(occurrence_file, min_source_records = min_source_records, merge_small_sources = merge_small_sources, use_cc = use_cc, cc_tests = cc_tests, log_fun = log_fun)
    occ <- cleaned$occ
  }
  model_meta <- get_sdm_model(model_id)
  min_rec_req <- model_meta$min_records %||% sdm_default_min_source_records
  has_presence_col <- "presence" %in% names(occ) && any(occ$presence == 1, na.rm = TRUE)
  n_pres <- if (has_presence_col) sum(occ$presence == 1, na.rm = TRUE) else NA_integer_
  if (!is.na(n_pres) && !is.na(min_rec_req) && n_pres < min_rec_req) {
    stop(sprintf(
      "Model '%s' requires at least %d presence records. Got %d.",
      model_id, min_rec_req, n_pres
    ))
  }
  dwca_doi <- attr(cleaned$raw, "gbif_doi")
  if (!is.null(dwca_doi) && !is.na(dwca_doi) && nzchar(dwca_doi)) {
    log_message(log_fun, "DwC-A GBIF dataset DOI: ", dwca_doi)
  }
  if (is.null(training_extent)) training_extent <- make_training_extent(occ, buffer = 2)
  log_message(log_fun, "Training extent: ", paste(training_extent, collapse = ", "))
  log_message(log_fun, "Projection extent: ", paste(projection_extent, collapse = ", "))

  progress_step(progress_fun, 0.20, "Loading and scaling environmental covariates")
  env <- load_environment(
    worldclim_dir = worldclim_dir,
    selected_biovars = selected_biovars,
    training_extent = training_extent,
    projection_extent = projection_extent,
    aggregation_factor = aggregation_factor,
    allow_download = allow_download,
    worldclim_res = worldclim_res,
    log_fun = log_fun,
    n_cores = n_cores,
    use_elevation = use_elevation,
    elevation_demtype = elevation_demtype,
    opentopo_api_key = opentopo_api_key,
    use_soil = use_soil,
    selected_soil_vars = selected_soil_vars,
    selected_soil_depths = selected_soil_depths,
    use_uv = use_uv,
    selected_uv_vars = selected_uv_vars,
    selected_uv_months = selected_uv_months,
    use_vegetation = isTRUE(use_vegetation),
    veg_year = veg_year,
    veg_products = veg_products,
    use_lulc = use_lulc,
    lulc_year = lulc_year,
    use_hfp = use_hfp,
    hfp_year = hfp_year,
    use_bioclim_season = use_bioclim_season,
    use_drought = use_drought,
    selected_drought_periods = selected_drought_periods,
    covariate_cache_dir = covariate_cache_dir,
    source = source,
    selected_chelsa_extras = selected_chelsa_extras
  )

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }

  if (thin_by_cell) {
    progress_step(progress_fun, 0.08, "Thinning duplicate raster-cell records")
    occ <- thin_occurrences_by_cell(occ, env$env_train_scaled[[1]], by_source = FALSE, log_fun = log_fun)
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  dropped_vars <- character(0)
  vif_result <- NULL
  if (isTRUE(vif_reduction) && terra::nlyr(env$env_train_scaled) >= 3) {
    progress_step(progress_fun, 0.35, "Running VIF collinearity reduction")
    set.seed(seed)
    n_cells <- terra::ncell(env$env_train_scaled)
    sample_size <- max(1000, min(5000, ceiling(n_cells * 0.01)))
    if (n_cells > 100000 && sample_size < 20000) {
      sample_size <- 20000
      log_message(log_fun, "VIF sample size adapted to ", sample_size, " for large raster (1% of ", n_cells, " cells)")
    }
    sample_cells <- sample(n_cells, size = sample_size)
    sample_xy <- terra::xyFromCell(env$env_train_scaled[[1]], sample_cells)
    covar_samples <- terra::extract(env$env_train_scaled, sample_xy)
    covar_samples <- covar_samples[complete.cases(covar_samples), ]
    if (nrow(covar_samples) >= 100) {
      vif_selection <- apply_vif_selection(covar_samples, threshold = vif_threshold, log_fun = log_fun)
      dropped_vars <- vif_selection$dropped
      vif_result <- vif_selection$vif_result
      if (length(dropped_vars) > 0) {
        keep_vars <- setdiff(names(env$env_train_scaled), dropped_vars)
        if (length(keep_vars) >= 2) {
          env$env_train_scaled <- env$env_train_scaled[[keep_vars]]
          env$env_project_scaled <- env$env_project_scaled[[keep_vars]]
          env$means <- env$means[keep_vars]
          env$sds <- env$sds[keep_vars]
          log_message(log_fun, "VIF reduction applied: ", terra::nlyr(env$env_train_scaled), " covariates remaining")
        } else {
          dropped_vars <- character(0)
          vif_result <- NULL
          log_message(log_fun, "VIF reduction skipped: not enough variables would remain")
        }
      }
    } else {
      log_message(log_fun, "VIF reduction skipped: insufficient sample points")
    }
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  progress_step(progress_fun, 0.60, "Fitting model")
  log_message(log_fun, "Model backend: ", model_spec$label)
  extra_args <- if (identical(model_id, "maxnet")) {
    list(maxnet_features = maxnet_features, maxnet_regmult = maxnet_regmult)
  } else if (identical(model_id, "multi_ensemble")) {
    list(
      selected_models = multi_ensemble_models, ensemble_weighting = multi_ensemble_weighting,
      ensemble_power = multi_ensemble_power, min_auc = multi_ensemble_min_auc,
      min_tss = multi_ensemble_min_tss, biomod2_models = biomod2_models
    )
  } else if (identical(model_id, "esm_glm") || identical(model_id, "esm_maxnet")) {
    list(
      biovars = esm_biovars, min_auc = esm_min_auc, power = esm_power,
      n_runs_eval = esm_n_runs, data_split = esm_split
    )
  } else {
    character(0)
  }
  bias_method <- match.arg(bias_method)
  fit <- do.call(fit_sdm_model, c(list(
    model_id = model_id, occ = occ, env_train_scaled = env$env_train_scaled,
    background_n = background_n, include_quadratic = include_quadratic,
    cv_folds = cv_folds, seed = seed, n_cores = n_cores, log_fun = log_fun,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
    bias_method = bias_method, target_group_occ = target_group_occ,
    thickening_distance_km = thickening_distance_km
  ), extra_args))

  importance_result <- NULL
  if (isTRUE(model_spec$supports_importance) && !is.null(fit$cv) && is.finite(fit$cv$auc_mean)) {
    pred_fun <- switch(model_id,
      glm = function(mod, newdata) {
        df <- as.data.frame(newdata)
        if (nrow(df) == 0) {
          return(numeric(0))
        }
        stats::predict.glm(mod$model, newdata = df, type = "response")
      },
      gam = function(mod, newdata) {
        df <- as.data.frame(newdata)
        if (nrow(df) == 0) {
          return(numeric(0))
        }
        predict(mod$model, newdata = df, type = "response")
      },
      rangebag = function(mod, newdata) {
        df <- as.data.frame(newdata)
        if (nrow(df) == 0) {
          return(numeric(0))
        }
        predict_rangebag_values(mod$model, df)
      },
      maxnet = function(mod, newdata) {
        df <- as.data.frame(newdata)
        if (nrow(df) == 0) {
          return(numeric(0))
        }
        as.numeric(maxnet::predict.maxnet(mod$model, df, clamp = TRUE, type = "link"))
      },
      function(mod, newdata) stop("No importance prediction defined for model: ", model_id)
    )
    importance_result <- permutation_importance(
      fit = fit,
      model_data = fit$model_data,
      predict_fun = pred_fun,
      metric_fun = auc_rank,
      n_perm = getOption("sdm.n_perm", sdm_default_n_perm),
      seed = seed,
      n_cores = n_cores
    )
    log_message(log_fun, "Permutation importance computed for ", nrow(importance_result), " variables")
  } else if (!is.null(fit$variable_importance) && is.data.frame(fit$variable_importance)) {
    importance_result <- fit$variable_importance
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  response_curves <- compute_response_curves(
    fit = fit,
    model_data = fit$model_data,
    env_train = env$env_train,
    n_points = 50
  )

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }

  progress_step(progress_fun, 0.80, "Predicting projection raster")
  base_name <- paste0(safe_slug(species), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))
  output_tif <- file.path(output_dir, paste0(base_name, "_suitability.tif"))
  output_png <- file.path(output_dir, paste0(base_name, "_suitability.png"))
  output_report <- file.path(output_dir, paste0(base_name, "_report.txt"))
  if (identical(model_id, "multi_ensemble")) {
    suit <- predict_multi_model_ensemble(fit, env$env_project_scaled, output_tif, n_cores, log_fun,
      export_components = isTRUE(multi_ensemble_export),
      include_uncertainty = TRUE,
      ensemble_weighting = multi_ensemble_weighting,
      ensemble_power = multi_ensemble_power
    )
  } else if (identical(model_id, "esm_glm") || identical(model_id, "esm_maxnet")) {
    suit <- predict_esm_suitability(fit, env$env_project_scaled, output_tif, n_cores, log_fun)
  } else {
    suit <- predict_sdm_model(fit, env$env_project_scaled, output_tif, n_cores, log_fun)
  }
  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  future <- NULL
  extra_paths <- list()
  if (identical(model_id, "ensemble_glm_rangebag")) {
    extra_paths <- list(
      glm_tif = ensemble_component_path(output_tif, "glm"),
      rangebag_tif = ensemble_component_path(output_tif, "rangebag"),
      disagreement_tif = ensemble_component_path(output_tif, "disagreement")
    )
  } else if (identical(model_id, "multi_ensemble")) {
    comp_paths <- fit$model$components
    for (m in names(comp_paths)) {
      extra_paths[[paste0("multi_ens_comp_", m)]] <- multi_ensemble_component_path(output_tif, m)
    }
    extra_paths$multi_ens_mean_tif <- attr(suit, "ensemble_mean_tif")
    extra_paths$multi_ens_median_tif <- attr(suit, "ensemble_median_tif")
    extra_paths$multi_ens_committee_tif <- attr(suit, "ensemble_committee_tif")
    sd_tif <- attr(suit, "ensemble_sd_tif")
    if (!is.null(sd_tif)) extra_paths$multi_ens_sd_tif <- sd_tif
  }

  if (isTRUE(future_projection)) {
    progress_step(progress_fun, 0.95, "Projecting future climate scenario")
    future <- project_future_suitability(
      fit = fit,
      current_suitability = suit,
      env = env,
      future_worldclim_dir = future_worldclim_dir,
      selected_biovars = selected_biovars,
      projection_extent = projection_extent,
      aggregation_factor = aggregation_factor,
      output_future_tif = file.path(output_dir, paste0(base_name, "_future_suitability.tif")),
      output_delta_tif = file.path(output_dir, paste0(base_name, "_future_delta.tif")),
      n_cores = n_cores,
      log_fun = log_fun
    )
    extra_paths <- c(extra_paths, future$paths)
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  progress_step(progress_fun, 0.08, "Summarising outputs")
  suitability_summary <- summarise_suitability(suit, threshold)
  if (!is.null(future)) future$summary <- summarise_suitability(future$suitability, threshold)

  projection_metrics <- NULL
  if (!is.null(training_extent) && !identical(projection_extent, training_extent)) {
    train_pres_suit <- tryCatch(as.numeric(fit$presence_suit), error = function(e) NULL)
    if (!is.null(train_pres_suit) && length(train_pres_suit) > 0 && !anyNA(train_pres_suit)) {
      validation_occ_df <- NULL
      if (!is.null(validation_occurrences)) {
        if (is.character(validation_occurrences) && length(validation_occurrences) == 1 && file.exists(validation_occurrences)) {
          validation_occ_df <- tryCatch(
            read.csv(validation_occurrences, stringsAsFactors = FALSE, check.names = FALSE),
            error = function(e) NULL
          )
        } else if (is.data.frame(validation_occurrences)) {
          validation_occ_df <- validation_occurrences
        }
      }
      projection_metrics <- compute_projection_metrics(
        suit_raster = suit,
        train_presence_suit = train_pres_suit,
        threshold = threshold,
        n_bg_samples = 1000L,
        validation_occ = validation_occ_df,
        log_fun = log_fun
      )
    }
  }

  save_suitability_png(suit, occ, projection_extent, species, threshold, output_png)

  elapsed <- as.numeric(difftime(Sys.time(), start_time, units = "secs"))
  log_message(log_fun, "Completed in ", sprintf("%.1f", elapsed), " seconds")
  metrics <- list(
    presence_records = nrow(fit$occurrence_used), background_points = nrow(fit$background_xy),
    auc_mean = fit$cv$auc_mean, auc_sd = fit$cv$auc_sd, cv_folds = fit$cv$k,
    n_cores = n_cores, elapsed_seconds = elapsed,
    projection = projection_metrics
  )

  result <- list(
    config = list(
      species = species, occurrence_file = occurrence_file, occurrence_source = occurrence_source, worldclim_dir = worldclim_dir,
      selected_biovars = selected_biovars, training_extent = training_extent, projection_extent = projection_extent,
      background_n = background_n, min_source_records = min_source_records, merge_small_sources = merge_small_sources,
      thin_by_cell = thin_by_cell, model_id = model_id, model_label = model_spec$label,
      include_quadratic = include_quadratic, threshold = threshold,
      aggregation_factor = aggregation_factor, cv_folds = cv_folds, n_cores = n_cores,
      use_elevation = isTRUE(use_elevation), elevation_demtype = elevation_demtype,
      use_soil = isTRUE(use_soil), selected_soil_vars = selected_soil_vars, selected_soil_depths = selected_soil_depths,
      use_uv = isTRUE(use_uv), selected_uv_vars = selected_uv_vars, selected_uv_months = selected_uv_months,
      use_vegetation = isTRUE(use_vegetation), veg_year = veg_year, veg_products = veg_products,
      use_lulc = isTRUE(use_lulc), lulc_year = lulc_year,
      use_hfp = isTRUE(use_hfp), hfp_year = hfp_year,
      use_bioclim_season = isTRUE(use_bioclim_season),
      use_drought = isTRUE(use_drought), selected_drought_periods = selected_drought_periods,
      selected_chelsa_extras = selected_chelsa_extras,
      covariate_cache_dir = covariate_cache_dir,
      vif_reduction = isTRUE(vif_reduction), vif_threshold = vif_threshold,
      future_projection = isTRUE(future_projection), future_worldclim_dir = future_worldclim_dir,
      future_label = future_label,
      bias_method = bias_method, thickening_distance_km = thickening_distance_km,
      gbif_doi = dwca_doi %||% gbif_doi, climate_source = source,
      overlap_warn = isTRUE(overlap_warn)
    ),
    occurrence = occ, occurrence_used = fit$occurrence_used, source_counts = sort(table(occ$source), decreasing = TRUE),
    cleaning = cleaned[c("removed_bad_coordinates", "removed_duplicates", "original_rows", "columns")],
    dwca_datasets = attr(cleaned$raw, "dwca_datasets"),
    dwca_issues = attr(cleaned$raw, "dwca_issues"),
    environment = list(
      names = names(env$env_train_scaled), means = env$means, sds = env$sds,
      files = env$files, extra_covariates = env$extra_covariates,
      dropped_vars = dropped_vars, vif_result = vif_result
    ),
    model_info = list(
      id = model_spec$id, label = model_spec$label, method = model_spec$method,
      packages = model_spec$packages, maturity = model_spec$maturity,
      diagnostics = model_spec$diagnostics
    ),
    model = fit$model, formula = fit$formula, coefficients = fit$coefficients, cv = fit$cv,
    variable_importance = importance_result,
    response_curves = response_curves,
    suitability = suit, future = future, summary = suitability_summary, metrics = metrics,
    paths = c(list(tif = output_tif, png = output_png, report = output_report), extra_paths)
  )
  result$report_text <- output_report
  write_manifest(result, output_dir, base_name)
  write_summary_report(result, result$report_text)
  result
}
