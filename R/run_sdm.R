# Public orchestration API for the SDM workflow.

run_fast_sdm <- function(species = sdm_default_species, occurrence_file = sdm_default_occurrence_file, worldclim_dir = sdm_default_worldclim_dir,
                         selected_biovars = sdm_default_biovars, projection_extent = sdm_default_projection_extent,
                         training_extent = NULL, background_n = sdm_default_background_n, min_source_records = sdm_default_min_source_records, merge_small_sources = TRUE,
                         thin_by_cell = TRUE, model_id = sdm_default_model_id,
                         include_quadratic = TRUE, threshold = sdm_default_threshold, aggregation_factor = sdm_default_aggregation_factor,
                         cv_folds = sdm_default_cv_folds, n_cores = NULL, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                         use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                         use_soil = FALSE, soil_path = sdm_default_soil_path,
                         selected_soil_vars = sdm_default_soil_vars, covariate_cache_dir = sdm_default_covariate_cache_dir,
                         future_projection = FALSE, future_worldclim_dir = sdm_default_future_worldclim_dir,
                         future_label = "Future climate",
                         output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = NULL, log_fun = NULL, progress_fun = NULL) {
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
  start_time <- Sys.time()
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
    covariate_cache_dir = covariate_cache_dir
  )

  if (thin_by_cell) {
    progress_step(progress_fun, 0.08, "Thinning duplicate raster-cell records")
    occ <- thin_occurrences_by_cell(occ, env$env_train_scaled[[1]], by_source = FALSE, log_fun = log_fun)
  }

  progress_step(progress_fun, 0.22, "Fitting model")
  log_message(log_fun, "Model backend: ", model_spec$label)
  fit <- fit_sdm_model(model_id, occ, env$env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun)

  progress_step(progress_fun, 0.24, "Predicting projection raster")
  base_name <- paste0(safe_slug(species), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))
  output_tif <- file.path(output_dir, paste0(base_name, "_suitability.tif"))
  output_png <- file.path(output_dir, paste0(base_name, "_suitability.png"))
  output_report <- file.path(output_dir, paste0(base_name, "_report.txt"))
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
  metrics <- list(presence_records = nrow(fit$occurrence_used), background_points = nrow(fit$background_xy),
                  auc_mean = fit$cv$auc_mean, auc_sd = fit$cv$auc_sd, cv_folds = fit$cv$k,
                  n_cores = n_cores, elapsed_seconds = elapsed)

  result <- list(
    config = list(species = species, occurrence_file = occurrence_file, occurrence_source = occurrence_source, worldclim_dir = worldclim_dir,
                  selected_biovars = selected_biovars, training_extent = training_extent, projection_extent = projection_extent,
                  background_n = background_n, min_source_records = min_source_records, merge_small_sources = merge_small_sources,
                  thin_by_cell = thin_by_cell, model_id = model_id, model_label = model_spec$label,
                  include_quadratic = include_quadratic, threshold = threshold,
                  aggregation_factor = aggregation_factor, cv_folds = cv_folds, n_cores = n_cores,
                  use_elevation = isTRUE(use_elevation), elevation_demtype = elevation_demtype,
                  use_soil = isTRUE(use_soil), soil_path = soil_path, selected_soil_vars = selected_soil_vars,
                  covariate_cache_dir = covariate_cache_dir,
                  future_projection = isTRUE(future_projection), future_worldclim_dir = future_worldclim_dir,
                  future_label = future_label),
    occurrence = occ, occurrence_used = fit$occurrence_used, source_counts = sort(table(occ$source), decreasing = TRUE),
    cleaning = cleaned[c("removed_bad_coordinates", "removed_duplicates", "original_rows", "columns")],
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
