# Public orchestration API for the SDM workflow.
<<<<<<< HEAD
=======
source('R/metrics_helper.R')
source('R/packages.R')
source('R/prediction.R')
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)

run_fast_sdm <- function(species = sdm_default_species, occurrence_file = sdm_default_occurrence_file, worldclim_dir = sdm_default_worldclim_dir,
                         selected_biovars = sdm_default_biovars, projection_extent = sdm_default_projection_extent,
                         training_extent = NULL, background_n = sdm_default_background_n, min_source_records = sdm_default_min_source_records, merge_small_sources = TRUE,
<<<<<<< HEAD
                         thin_by_cell = TRUE, thinning_mode = sdm_default_thinning_mode, thinning_distance_km = sdm_default_thinning_distance_km,
                         model_id = sdm_default_model_id,
                         include_quadratic = TRUE, threshold = sdm_default_threshold, aggregation_factor = sdm_default_aggregation_factor,
                         cv_folds = sdm_default_cv_folds, cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                         n_cores = NULL, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                         use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                         use_soil = FALSE, soil_path = sdm_default_soil_path,
                         selected_soil_vars = sdm_default_soil_vars, covariate_cache_dir = sdm_default_covariate_cache_dir,
                         future_projection = FALSE, future_worldclim_dir = sdm_default_future_worldclim_dir,
                         future_label = "Future climate",
                         output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = NULL, log_fun = NULL, progress_fun = NULL) {
  ensure_sdm_packages("terra", n_cores = n_cores)
=======
                         thin_by_cell = TRUE, model_id = sdm_default_model_id,
                         include_quadratic = TRUE, threshold = sdm_default_threshold, aggregation_factor = sdm_default_aggregation_factor,
                         cv_folds = sdm_default_cv_folds, n_cores = NULL, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                         use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                         use_soil = TRUE, soil_path = NULL,
                         selected_soil_vars = config$soil_vars_default, selected_depths = config$soil_depths_default, use_rangebag = config$use_rangebag, covariate_cache_dir = sdm_default_covariate_cache_dir,
                         future_projection = FALSE, future_worldclim_dir = sdm_default_future_worldclim_dir,
                         future_label = "Future climate",
                         output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = NULL, log_fun = NULL, progress_fun = NULL,
                         selected_models = NULL,
                         selected_dnn_models = NULL, dnn_device = config$dnn_device_default, dnn_weight = config$dnn_weight_default, ensemble_method = config$ensemble_method_default) {
  ensure_sdm_packages("terra", n_cores = n_cores)
  # Verify required package versions for the current run
  if (!check_sdm_versions()) {
    stop("One or more required package versions are below the minimum supported levels")
  }
  # Log biomod2 capability summary for debugging
  log_biomod2_capabilities()
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  n_cores <- configure_parallel(n_cores, log_fun = log_fun)
  projection_extent <- validate_extent(as.numeric(projection_extent), "projection_extent")
  if (!is.null(training_extent)) training_extent <- validate_extent(as.numeric(training_extent), "training_extent")
  selected_biovars <- validate_biovars(selected_biovars)
  model_id <- validate_sdm_model_id(model_id)
  model_spec <- get_sdm_model(model_id)
  threshold <- normalize_threshold(threshold)
<<<<<<< HEAD
  thinning_mode_resolved <- normalize_thinning_mode(thinning_mode, thin_by_cell = thin_by_cell)
  thinning_distance_km <- normalize_thinning_distance_km(thinning_distance_km)
  cv_strategy <- normalize_cv_strategy(cv_strategy)
  cv_block_size_km <- normalize_cv_block_size_km(cv_block_size_km)
=======
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  aggregation_factor <- as.integer(aggregation_factor)
  if (is.na(aggregation_factor) || aggregation_factor < 1) aggregation_factor <- 1
  selected_soil_vars <- unique(as.character(selected_soil_vars))
  selected_soil_vars <- selected_soil_vars[nzchar(selected_soil_vars)]
  start_time <- Sys.time()
<<<<<<< HEAD
=======
  extra_paths <- list()
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  dir.create(covariate_cache_dir, recursive = TRUE, showWarnings = FALSE)

  progress_step(progress_fun, 0.08, "Cleaning occurrence data")
  if (!is.null(occurrence_source) && nzchar(occurrence_source)) log_message(log_fun, "Observation record source: ", occurrence_source)
  cleaned <- clean_occurrences(occurrence_file, min_source_records = min_source_records, merge_small_sources = merge_small_sources, log_fun = log_fun)
  occ <- cleaned$occ
  if (is.null(training_extent)) training_extent <- make_training_extent(occ, buffer = 2)
  log_message(log_fun, "Training extent: ", paste(training_extent, collapse = ", "))
  log_message(log_fun, "Projection extent: ", paste(projection_extent, collapse = ", "))

  progress_step(progress_fun, 0.18, "Loading and scaling environmental covariates")
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
    soil_path = soil_path,
    selected_soil_vars = selected_soil_vars,
<<<<<<< HEAD
    covariate_cache_dir = covariate_cache_dir
  )

  progress_step(progress_fun, 0.08, "Thinning occurrence records")
  thinning <- apply_occurrence_thinning(occ, env$env_train_scaled[[1]], thinning_mode = thinning_mode_resolved,
                                        thin_by_cell = thin_by_cell, thinning_distance_km = thinning_distance_km,
                                        by_source = FALSE, seed = seed, log_fun = log_fun)
  occ <- thinning$occ
  thinning_stats <- thinning$stats

  progress_step(progress_fun, 0.22, "Fitting model")
  log_message(log_fun, "Model backend: ", model_spec$label)
  if (identical(model_id, "glm")) {
    fit <- fit_sdm_model(model_id, occ, env$env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun,
                         cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km, threshold = threshold)
  } else {
    if (!identical(cv_strategy, "random")) log_message(log_fun, "Spatial block CV is currently implemented for the GLM backend only; using backend default CV.")
    fit <- fit_sdm_model(model_id, occ, env$env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun)
  }

=======
    selected_depths = selected_depths,
    covariate_cache_dir = covariate_cache_dir
  )

  if (thin_by_cell) {
    progress_step(progress_fun, 0.08, "Thinning duplicate raster-cell records")
    occ <- thin_occurrences_by_cell(occ, env$env_train_scaled[[1]], by_source = FALSE, log_fun = log_fun)
  }

  # Run biomod2 only if models are selected
  if (!is.null(selected_models) && length(selected_models) > 0) {
    progress_step(progress_fun, 0.22, "Fitting biomod2 models")
    biomod_res <- run_biomod2(occ, env$env_train_scaled, models = selected_models,
                          background_n = background_n, cv_folds = cv_folds,
                          use_rangebag = use_rangebag)
    fit <- list(model = biomod_res$model, rangebag = biomod_res$rangebag)
    fit$biomod2 <- biomod_res$model
  } else {
    # Fit internal model
    progress_step(progress_fun, 0.22, paste("Fitting", model_spec$label, "model"))
    fit <- fit_sdm_model(model_id, occ = occ, env = env$env_train_scaled,
                        background_n = background_n, cv_folds = cv_folds,
                        include_quadratic = include_quadratic)
  }


>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  progress_step(progress_fun, 0.24, "Predicting projection raster")
  base_name <- paste0(safe_slug(species), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))
  output_tif <- file.path(output_dir, paste0(base_name, "_suitability.tif"))
  output_png <- file.path(output_dir, paste0(base_name, "_suitability.png"))
  output_report <- file.path(output_dir, paste0(base_name, "_report.txt"))
<<<<<<< HEAD
  suit <- predict_sdm_model(fit, env$env_project_scaled, output_tif, n_cores, log_fun)
  future <- NULL
  extra_paths <- list()
  if (identical(model_id, "ensemble_glm_rangebag")) {
    extra_paths <- list(
      glm_tif = ensemble_component_path(output_tif, "glm"),
      rangebag_tif = ensemble_component_path(output_tif, "rangebag"),
      disagreement_tif = ensemble_component_path(output_tif, "disagreement")
    )
  }

=======
  
  # Predict from model (biomod2 or internal)
  if (!is.null(fit$biomod2)) {
    suit <- predict_biomod2_suitability(fit$biomod2, env$env_project_scaled, output_tif, n_cores, log_fun)
  } else if (!is.null(fit$model)) {
    suit <- predict_sdm_model(fit, env$env_project_scaled, output_tif, n_cores, log_fun)
  } else {
    suit <- NULL
  }

  # DNN training and prediction (if any DNN models selected)
  dnn_result <- NULL
  if (!is.null(selected_dnn_models) && length(selected_dnn_models) > 0) {
    source("R/model_dnn.R", local = TRUE)
    progress_step(progress_fun, 0.05, "Training DNN models")

    dnn_result <- run_dnn(
      occ_df = occ,
      pred_stack = env$env_train_scaled,
      selected_dnn_models = selected_dnn_models,
      background_n = background_n,
      device = dnn_device,
      log_fun = log_fun,
      progress_fun = function(amount, detail) {
        progress_step(progress_fun, amount * 0.05, detail)
      }
    )

    if (!is.null(dnn_result) && !is.null(dnn_result$results)) {
      progress_step(progress_fun, 0.05, "Generating DNN predictions")

      # Get DNN ensemble prediction (average of all DNN models)
      dnn_preds <- lapply(dnn_result$results, function(x) x$prediction)
      dnn_pred_raster <- terra::app(terra::rast(dnn_preds), fun = mean, na.rm = TRUE)

      # Combine biomod2 and DNN predictions (or use DNN only if biomod2 wasn't run)
      if (!is.null(suit)) {
        suit <- combine_ensemble(
          biomod_pred = suit,
          dnn_results = dnn_pred_raster,
          method = ensemble_method,
          dnn_weight = dnn_weight,
          threshold = threshold
        )
      } else {
        # No biomod2 - use DNN as the main prediction
        suit <- dnn_pred_raster
        }
        # Initialise extra_paths before potentially adding DNN files
        extra_paths <- list()
        # Save DNN component if needed
        if (dir.exists(output_dir)) {
          dnn_tif <- file.path(output_dir, paste0(base_name, "_dnn_suitability.tif"))
          terra::writeRaster(dnn_pred_raster, dnn_tif, overwrite = TRUE)
          extra_paths$dnn_tif <- dnn_tif
        }
    }
  }

    future <- NULL
    # extra_paths may already contain DNN tif; add ensemble components if applicable
    if (identical(model_id, "ensemble_glm_rangebag")) {
      extra_paths <- c(extra_paths, list(
        glm_tif = ensemble_component_path(output_tif, "glm"),
        rangebag_tif = ensemble_component_path(output_tif, "rangebag"),
        disagreement_tif = ensemble_component_path(output_tif, "disagreement")
      ))
    }

>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  if (isTRUE(future_projection)) {
    progress_step(progress_fun, 0.10, "Projecting future climate scenario")
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

  progress_step(progress_fun, 0.08, "Summarising outputs")
  suitability_summary <- summarise_suitability(suit, threshold)
  if (!is.null(future)) future$summary <- summarise_suitability(future$suitability, threshold)
  save_suitability_png(suit, occ, projection_extent, species, threshold, output_png)

  elapsed <- as.numeric(difftime(Sys.time(), start_time, units = "secs"))
  log_message(log_fun, "Completed in ", sprintf("%.1f", elapsed), " seconds")
<<<<<<< HEAD
  binary_metrics <- fit$binary_metrics %||% list(tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_, threshold = threshold)
  metrics <- list(presence_records = nrow(fit$occurrence_used), background_points = nrow(fit$background_xy),
                  auc_mean = fit$cv$auc_mean, auc_sd = fit$cv$auc_sd,
                  tss_mean = fit$cv$tss_mean %||% NA_real_, tss_sd = fit$cv$tss_sd %||% NA_real_,
                  sensitivity_mean = fit$cv$sensitivity_mean %||% binary_metrics$sensitivity %||% NA_real_,
                  specificity_mean = fit$cv$specificity_mean %||% binary_metrics$specificity %||% NA_real_,
                  train_tss = binary_metrics$tss %||% NA_real_, threshold = threshold,
                  cv_folds = fit$cv$k, cv_strategy = fit$cv$strategy %||% cv_strategy,
                  cv_block_size_km = fit$cv$block_size_km %||% cv_block_size_km,
                  cv_block_size_mode = fit$cv$block_size_mode %||% "not_applicable",
                  n_cores = n_cores, elapsed_seconds = elapsed)
=======
  # Extract metrics from biomod2 or DNN depending on what was run
  if (!is.null(fit$biomod2)) {
    biomod_metrics <- extract_biomod_metrics(fit$biomod2)
    metrics <- list(
      presence_records = biomod_metrics$occurrence_used,
      background_points = biomod_metrics$background_points,
      auc_mean = biomod_metrics$auc_mean,
      auc_sd = biomod_metrics$auc_sd,
      cv_folds = biomod_metrics$cv_folds,
      n_cores = n_cores,
      elapsed_seconds = elapsed
    )
  } else {
    # Use DNN metrics if biomod2 wasn't run
    dnn_metrics <- NULL
    dnn_bg <- NA
    if (!is.null(dnn_result) && !is.null(dnn_result$results) && length(dnn_result$results) > 0) {
      # Get background count from first model's train_data
      dnn_bg <- dnn_result$results[[1]]$train_data$n_background
      # Average metrics across DNN models
      dnn_aucs <- sapply(dnn_result$results, function(x) x$metrics$AUC)
      dnn_tss <- sapply(dnn_result$results, function(x) x$metrics$TSS)
      dnn_metrics <- list(
        auc_mean = mean(dnn_aucs, na.rm = TRUE),
        auc_sd = sd(dnn_aucs, na.rm = TRUE),
        tss_mean = mean(dnn_tss, na.rm = TRUE)
      )
    }
    metrics <- list(
      presence_records = nrow(occ),
      background_points = dnn_bg,
      auc_mean = if (!is.null(dnn_metrics)) dnn_metrics$auc_mean else NA,
      auc_sd = if (!is.null(dnn_metrics)) dnn_metrics$auc_sd else NA,
      cv_folds = 1,
      n_cores = n_cores,
      elapsed_seconds = elapsed,
      dnn_models = if (!is.null(dnn_result)) names(dnn_result$results) else NULL,
      dnn_device = if (!is.null(dnn_result)) dnn_result$device else NULL
    )
  }
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)

  result <- list(
    config = list(species = species, occurrence_file = occurrence_file, occurrence_source = occurrence_source, worldclim_dir = worldclim_dir,
                  selected_biovars = selected_biovars, training_extent = training_extent, projection_extent = projection_extent,
                  background_n = background_n, min_source_records = min_source_records, merge_small_sources = merge_small_sources,
<<<<<<< HEAD
                  thin_by_cell = thin_by_cell, thinning_mode = thinning_mode_resolved, thinning_distance_km = thinning_distance_km,
                  model_id = model_id, model_label = model_spec$label,
                  include_quadratic = include_quadratic, threshold = threshold,
                  aggregation_factor = aggregation_factor, cv_folds = cv_folds, cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km, n_cores = n_cores,
=======
                  thin_by_cell = thin_by_cell, model_id = model_id, model_label = model_spec$label,
                  include_quadratic = include_quadratic, threshold = threshold,
                  aggregation_factor = aggregation_factor, cv_folds = cv_folds, n_cores = n_cores,
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
                  use_elevation = isTRUE(use_elevation), elevation_demtype = elevation_demtype,
                  use_soil = isTRUE(use_soil), soil_path = soil_path, selected_soil_vars = selected_soil_vars,
                  covariate_cache_dir = covariate_cache_dir,
                  future_projection = isTRUE(future_projection), future_worldclim_dir = future_worldclim_dir,
                  future_label = future_label),
    occurrence = occ, occurrence_used = fit$occurrence_used, source_counts = sort(table(occ$source), decreasing = TRUE),
    cleaning = cleaned[c("removed_bad_coordinates", "removed_duplicates", "original_rows", "columns")],
<<<<<<< HEAD
    thinning = thinning_stats,
=======
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
    environment = list(names = names(env$env_train_scaled), means = env$means, sds = env$sds,
                       files = env$files, extra_covariates = env$extra_covariates),
    model_info = list(id = model_spec$id, label = model_spec$label, method = model_spec$method,
                      packages = model_spec$packages, maturity = model_spec$maturity,
                      diagnostics = model_spec$diagnostics),
    model = fit$model, formula = fit$formula, coefficients = fit$coefficients, cv = fit$cv,
    suitability = suit, future = future, summary = suitability_summary, metrics = metrics,
    paths = c(list(tif = output_tif, png = output_png, report = output_report), extra_paths)
  )
  result$report_text <- output_report
  write_summary_report(result, result$report_text)
  result
}
