# Public orchestration API for the SDM workflow.

run_fast_sdm <- function(...) {
  args <- list(...)
  if (length(args) == 1 && is.sdm_config(args[[1]])) {
    cfg <- args[[1]]
  } else {
    cfg <- sdm_config(...)
  }

  species <- cfg$species
  occurrence_file <- cfg$occurrence_file
  worldclim_dir <- cfg$worldclim_dir
  selected_biovars <- cfg$selected_biovars
  projection_extent <- cfg$projection_extent
  training_extent <- cfg$training_extent
  background_n <- cfg$background_n
  min_source_records <- cfg$min_source_records
  merge_small_sources <- cfg$merge_small_sources
  thin_by_cell <- cfg$thin_by_cell
  model_id <- cfg$model_id
  include_quadratic <- cfg$include_quadratic
  threshold <- cfg$threshold
  aggregation_factor <- cfg$aggregation_factor
  cv_folds <- cfg$cv_folds
  n_cores <- cfg$n_cores
  allow_download <- cfg$allow_download
  worldclim_res <- cfg$worldclim_res
  cv_strategy <- cfg$cv_strategy
  cv_block_size_km <- cfg$cv_block_size_km
  use_elevation <- cfg$use_elevation
  elevation_demtype <- cfg$elevation_demtype
  opentopo_api_key <- cfg$opentopo_api_key
  use_soil <- cfg$use_soil
  selected_soil_vars <- cfg$selected_soil_vars
  selected_soil_depths <- cfg$selected_soil_depths
  use_uv <- cfg$use_uv
  selected_uv_vars <- cfg$selected_uv_vars
  selected_uv_months <- cfg$selected_uv_months
  use_vegetation <- cfg$use_vegetation
  veg_year <- cfg$veg_year
  veg_products <- cfg$veg_products
  use_lulc <- cfg$use_lulc
  lulc_year <- cfg$lulc_year
  use_hfp <- cfg$use_hfp
  hfp_year <- cfg$hfp_year
  use_bioclim_season <- cfg$use_bioclim_season
  use_drought <- cfg$use_drought
  selected_drought_periods <- cfg$selected_drought_periods
  selected_chelsa_extras <- cfg$selected_chelsa_extras
  covariate_cache_dir <- cfg$covariate_cache_dir
  vif_reduction <- cfg$vif_reduction
  vif_threshold <- cfg$vif_threshold
  future_projection <- cfg$future_projection
  future_worldclim_dir <- cfg$future_worldclim_dir
  future_label <- cfg$future_label
  maxnet_features <- cfg$maxnet_features
  maxnet_regmult <- cfg$maxnet_regmult
  bias_method <- cfg$bias_method %||% "uniform"
  target_group_occ <- cfg$target_group_occ
  thickening_distance_km <- cfg$thickening_distance_km
  use_cc <- cfg$use_cc
  cc_tests <- cfg$cc_tests
  max_coordinate_uncertainty <- cfg$max_coordinate_uncertainty %||% NULL
  cleaned_occurrence <- cfg$cleaned_occurrence
  output_dir <- cfg$output_dir
  seed <- cfg$seed
  occurrence_source <- cfg$occurrence_source
  gbif_doi <- cfg$gbif_doi
  log_fun <- cfg$log_fun
  progress_fun <- cfg$progress_fun
  source <- cfg$source
  multi_ensemble_models <- cfg$multi_ensemble_models
  multi_ensemble_weighting <- cfg$multi_ensemble_weighting
  multi_ensemble_power <- cfg$multi_ensemble_power
  multi_ensemble_min_auc <- cfg$multi_ensemble_min_auc
  multi_ensemble_min_tss <- cfg$multi_ensemble_min_tss
  export_ensemble_components <- cfg$export_ensemble_components
  export_ensemble_stats <- cfg$export_ensemble_stats
  biomod2_models <- cfg$biomod2_models
  esm_n_runs <- cfg$esm_n_runs
  esm_split <- cfg$esm_split
  esm_min_auc <- cfg$esm_min_auc
  esm_weighting_metric <- cfg$esm_weighting_metric %||% "AUC"
  esm_power <- cfg$esm_power
  esm_biovars <- cfg$esm_biovars
  overlap_warn <- cfg$overlap_warn
  validation_occurrences <- cfg$validation_occurrences
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
    cleaned <- clean_occurrences(occurrence_file, min_source_records = min_source_records, merge_small_sources = merge_small_sources, use_cc = use_cc, cc_tests = cc_tests, log_fun = log_fun, max_coordinate_uncertainty = max_coordinate_uncertainty)
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
    sample_size <- min(sample_size, n_cells)
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
  } else if (identical(model_id, "brt")) {
    list(n_trees = cfg$brt_n_trees %||% 2000L, interaction_depth = cfg$brt_interaction_depth %||% 3L,
      shrinkage = cfg$brt_shrinkage %||% 0.01, bag_fraction = cfg$brt_bag_fraction %||% 0.75)
  } else if (identical(model_id, "cta")) {
    list(cp = cfg$cta_cp %||% 0.01, maxdepth = cfg$cta_maxdepth %||% 10L, minsplit = cfg$cta_minsplit %||% 20L)
  } else if (identical(model_id, "mars")) {
    list(degree = cfg$mars_degree %||% 2L, penalty = cfg$mars_penalty %||% 3.0)
  } else if (identical(model_id, "fda")) {
    list(degree = cfg$fda_degree %||% 2L)
  } else if (identical(model_id, "ann")) {
    list(size = cfg$ann_size %||% 5L, decay = cfg$ann_decay %||% 0.01, maxit = cfg$ann_maxit %||% 200L)
  } else if (identical(model_id, "dnn")) {
    list(n_seeds = cfg$dnn_n_seeds %||% 5L, dnn_model_type = cfg$dnn_model_type %||% "DNN_Medium", dnn_device = cfg$dnn_device %||% "auto")
  } else if (identical(model_id, "multi_ensemble")) {
    list(
      selected_models = multi_ensemble_models, ensemble_weighting = multi_ensemble_weighting,
      ensemble_power = multi_ensemble_power, min_auc = multi_ensemble_min_auc,
      min_tss = multi_ensemble_min_tss, biomod2_models = biomod2_models
    )
  } else if (identical(model_id, "esm_glm") || identical(model_id, "esm_maxnet")) {
    list(
      biovars = esm_biovars, min_auc = esm_min_auc, weighting_metric = esm_weighting_metric, power = esm_power,
      n_runs_eval = esm_n_runs, data_split = esm_split
    )
  } else {
    character(0)
  }
  bias_method <- match.arg(bias_method, c("uniform", "target_group", "thickened"))
  pa_replicates <- cfg$pa_replicates %||% 1L
  if (is.null(pa_replicates) || !is.finite(pa_replicates) || pa_replicates < 1) pa_replicates <- 1L
  pa_replicates <- as.integer(pa_replicates)

  if (pa_replicates > 1) {
    log_message(log_fun, "Running ", pa_replicates, " PA replicates with different background samples")
    if (model_id %in% c("multi_ensemble", "esm_glm", "esm_maxnet", "ensemble_glm_rangebag", "bioclim")) {
      log_message(log_fun, "Note: PA replication applies to single-model backends only; ensemble/ESM models use one PA set.")
      pa_replicates <- 1L
    }
  }

  cv_threshold <- if (is.na(threshold)) 0.5 else threshold
  if (is.na(threshold)) {
    log_message(log_fun, "Using 0.5 for initial CV; will select optimal threshold post-fit")
  }

  # PA replication: fit model N times with different background seeds
  replicate_fits <- vector("list", pa_replicates)
  last_error <- NULL
  replicate_fits[[1]] <- tryCatch({
    do.call(fit_sdm_model, c(list(
      model_id = model_id, occ = occ, env_train_scaled = env$env_train_scaled,
      background_n = background_n, include_quadratic = include_quadratic,
      cv_folds = cv_folds, seed = seed, n_cores = n_cores, log_fun = log_fun,
      progress_fun = progress_fun, threshold = cv_threshold,
      cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
      bias_method = bias_method, target_group_occ = target_group_occ,
      thickening_distance_km = thickening_distance_km
    ), extra_args))
  }, error = function(e) {
    err_msg <- conditionMessage(e)
    last_error <<- err_msg
    log_message(log_fun, "  PA replicate 1/", pa_replicates, " failed: ", err_msg)
    NULL
  })

  if (pa_replicates > 1) {
    for (rep_i in seq_len(pa_replicates - 1) + 1) {
      rep_seed <- seed + rep_i * 1000L
      rep_pct <- 0.60 + (rep_i / pa_replicates) * 0.15
      progress_step(progress_fun, rep_pct, sprintf("Fitting PA replicate %d/%d", rep_i, pa_replicates))
      replicate_fits[[rep_i]] <- tryCatch({
        do.call(fit_sdm_model, c(list(
          model_id = model_id, occ = occ, env_train_scaled = env$env_train_scaled,
          background_n = background_n, include_quadratic = include_quadratic,
          cv_folds = cv_folds, seed = rep_seed, n_cores = n_cores, log_fun = log_fun,
          progress_fun = progress_fun, threshold = cv_threshold,
          cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
          bias_method = bias_method, target_group_occ = target_group_occ,
          thickening_distance_km = thickening_distance_km
        ), extra_args))
      }, error = function(e) {
        err_msg <- conditionMessage(e)
        last_error <<- err_msg
        log_message(log_fun, "  PA replicate ", rep_i, "/", pa_replicates, " failed: ", err_msg)
        NULL
      })
    }
  }

  # Use the first successful fit as the primary fit
  fit <- NULL
  for (rep_i in seq_along(replicate_fits)) {
    if (!is.null(replicate_fits[[rep_i]])) {
      fit <- replicate_fits[[rep_i]]
      break
    }
  }
  if (is.null(fit)) {
    err_msg <- last_error %||% "All PA replicates failed — cannot continue"
    log_message(log_fun, "All PA replicates failed: ", err_msg)
    stop(err_msg, call. = FALSE)
  }
  if (pa_replicates > 1) {
    successful <- sum(!vapply(replicate_fits, is.null, logical(1)))
    fit$pa_replicates <- list(
      n = pa_replicates,
      successful = successful,
      cv_auc_means = vapply(replicate_fits, function(f) if (is.null(f)) NA_real_ else f$cv$auc_mean, numeric(1)),
      cv_tss_means = vapply(replicate_fits, function(f) if (is.null(f)) NA_real_ else f$cv$tss_mean, numeric(1))
    )
    log_message(log_fun, "PA replication: ", successful, "/", pa_replicates, " successful")
  }

  threshold_source <- if (identical(cfg$threshold, "max_tss")) "auto (max-TSS)" else "user-specified"
  if (is.na(threshold) && !is.null(fit$presence_suit) && !is.null(fit$background_suit)) {
    tss_result <- select_threshold(fit$presence_suit, fit$background_suit)
    threshold <- tss_result$threshold
    log_message(log_fun, "Threshold selected via max-TSS: ", sprintf("%.2f", threshold),
      " (max TSS = ", sprintf("%.3f", tss_result$max_tss), ")")
  } else if (is.na(threshold)) {
    threshold <- 0.5
    log_message(log_fun, "Could not compute max-TSS threshold; falling back to 0.5")
  }

  importance_result <- NULL
  if (isTRUE(model_spec$supports_importance) && !is.null(fit$cv) && is.finite(fit$cv$auc_mean)) {
    importance_result <- tryCatch(
      xai_importance(fit, method = "auto", seed = seed, n_cores = n_cores),
      error = function(e) {
        log_message(log_fun, "Importance computation failed: ", conditionMessage(e))
        NULL
      }
    )
    if (is.data.frame(importance_result) && nrow(importance_result) > 0) {
      log_message(log_fun, "Importance computed for ", nrow(importance_result), " variables")
    }
  } else if (!is.null(fit$variable_importance) && is.data.frame(fit$variable_importance)) {
    importance_result <- fit$variable_importance
  }

  # Area of Applicability (AOA)
  aoa_result <- NULL
  if (!is.null(fit$model_data) && !is.null(fit$covariates)) {
    aoa_result <- tryCatch(
      compute_aoa(fit$model_data, env$env_project_scaled, fit$covariates,
        variable_importance = importance_result, method = "cast", log_fun = log_fun),
      error = function(e) {
        log_message(log_fun, "AOA computation failed: ", conditionMessage(e))
        NULL
      }
    )
  }

  # MESS extrapolation detection (uses raw unscaled values)
  mess_result <- NULL
  if (!is.null(env$env_train) && !is.null(env$env_project)) {
    mess_result <- tryCatch(
      compute_mess(env$env_train, env$env_project),
      error = function(e) {
        log_message(log_fun, "MESS computation failed: ", conditionMessage(e))
        NULL
      }
    )
    if (!is.null(mess_result)) {
      mess_tag <- format(Sys.time(), "%Y%m%d_%H%M%S")
      output_mess_tif <- file.path(output_dir, paste0("mess_", mess_tag, ".tif"))
      terra::writeRaster(mess_result$mess, output_mess_tif,
        overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      extra_paths[["mess_tif"]] <- output_mess_tif
      log_message(log_fun, "MESS surface: ", sprintf("%.1f%%", mess_result$pct_extrapolation * 100), " of projection area is extrapolation")
    }
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  response_curves <- compute_response_curves(
    fit = fit,
    model_data = fit$model_data,
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
  extra_paths <- list()
  suit <- tryCatch({
    if (identical(model_id, "multi_ensemble")) {
      predict_multi_model_ensemble(fit, env$env_project_scaled, output_tif, n_cores, log_fun,
        export_components = isTRUE(export_ensemble_components),
        include_uncertainty = isTRUE(cfg$include_uncertainty),
        export_stats = isTRUE(export_ensemble_stats),
        ensemble_weighting = multi_ensemble_weighting,
        ensemble_power = multi_ensemble_power,
        user_threshold = threshold
      )
    } else if (identical(model_id, "esm_glm") || identical(model_id, "esm_maxnet")) {
      pred <- predict_esm_suitability(fit, env$env_project_scaled, output_tif, n_cores, log_fun)
      esm_pair_sd_tif <- attr(pred, "esm_pair_sd_tif")
      if (!is.null(esm_pair_sd_tif)) extra_paths[["esm_pair_sd"]] <- esm_pair_sd_tif
      pred
    } else {
      predict_sdm_model(fit, env$env_project_scaled, output_tif, n_cores, log_fun)
    }
  }, error = function(e) {
    log_message(log_fun, "Prediction failed: ", conditionMessage(e))
    log_message(log_fun, "Traceback: ", paste(utils::tail(traceback(), 5), collapse = " <- "))
    stop("Prediction failed: ", conditionMessage(e), call. = FALSE)
  })

  # Ensemble variable importance (multi-model) — must come after suit is assigned
  if (identical(model_id, "multi_ensemble") && !is.null(attr(suit, "ensemble_importance"))) {
    importance_result <- attr(suit, "ensemble_importance")
    log_message(log_fun, "Ensemble weighted importance computed across ", importance_result$n_models[1], " models")
  }

  # PA replication: average predictions across replicates
  if (pa_replicates > 1 && !is.null(fit$pa_replicates)) {
    suit_sum <- suit
    valid_reps <- 1L
    for (rep_i in seq_len(pa_replicates)[-1]) {
      rep_fit <- replicate_fits[[rep_i]]
      if (is.null(rep_fit)) next
      rep_tif <- tempfile(pattern = paste0("pa_rep", rep_i, "_"), fileext = ".tif")
      rep_suit <- tryCatch(
        predict_sdm_model(rep_fit, env$env_project_scaled, rep_tif, n_cores, log_fun),
        error = function(e) {
          log_message(log_fun, "  PA replicate ", rep_i, " prediction failed: ", conditionMessage(e))
          NULL
        }
      )
      if (!is.null(rep_suit)) {
        suit_sum <- suit_sum + rep_suit
        valid_reps <- valid_reps + 1L
        unlink(rep_tif)
      }
    }
    if (valid_reps > 1) {
      suit <- suit_sum / valid_reps
      terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      log_message(log_fun, "PA-averaged suitability from ", valid_reps, " replicates written to ", output_tif)
    }
  }
  progress_step(progress_fun, 0.90, "Writing output raster")
  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }

  # Climate matching (optional)
  climate_match_result <- NULL
  if (isTRUE(cfg$climate_matching)) {
    climate_match_result <- tryCatch({
      cm_method <- cfg$climate_matching_method %||% "mahalanobis"
      # Use presence points for training reference if available
      pres_points <- NULL
      if (!is.null(fit$occurrence_used) && all(c("longitude", "latitude") %in% names(fit$occurrence_used))) {
        pres_points <- data.frame(
          x = fit$occurrence_used$longitude,
          y = fit$occurrence_used$latitude
        )
      }
      compute_climate_match(
        env_train = env$env_train_scaled,
        env_proj = env$env_project_scaled,
        method = cm_method,
        presence_points = pres_points,
        log_fun = log_fun
      )
    }, error = function(e) {
      log_message(log_fun, "Climate matching failed: ", conditionMessage(e))
      NULL
    })
    if (!is.null(climate_match_result)) {
      cm_tif <- file.path(output_dir, paste0(base_name, "_climatch.tif"))
      terra::writeRaster(climate_match_result$similarity, cm_tif,
        overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      extra_paths[["climate_matching_tif"]] <- cm_tif
    }
  }

  future <- NULL
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
    if (identical(cfg$source %||% "worldclim", "chelsa")) {
      log_message(log_fun, "Note: Future projection uses WorldClim CMIP6 data regardless of current climate source. CHELSA v2.1 future data is not supported. Future layers will be loaded from: ", future_worldclim_dir)
    }
    progress_step(progress_fun, 0.95, "Projecting future climate scenario")
    mask_extrapolation <- isTRUE(cfg$extrapolation_mask %||% TRUE)
    mess_threshold <- cfg$mess_threshold %||% 0
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
      log_fun = log_fun,
      mask_extrapolation = mask_extrapolation,
      mess_threshold = mess_threshold
    )
    extra_paths <- c(extra_paths, future$paths)
  }

  # Second future scenario (multi-SSP comparison)
  future_worldclim_dir2 <- cfg$future_worldclim_dir2 %||% NULL
  future_label2 <- cfg$future_label2 %||% "Future climate 2"
  future2 <- NULL
  if (isTRUE(future_projection) && !is.null(future_worldclim_dir2) && nzchar(future_worldclim_dir2) && dir.exists(future_worldclim_dir2)) {
    progress_step(progress_fun, 0.97, paste0("Projecting 2nd scenario: ", future_label2))
    future2 <- tryCatch(
      project_future_suitability(
        fit = fit,
        current_suitability = suit,
        env = env,
        future_worldclim_dir = future_worldclim_dir2,
        selected_biovars = selected_biovars,
        projection_extent = projection_extent,
        aggregation_factor = aggregation_factor,
        output_future_tif = file.path(output_dir, paste0(base_name, "_future2_suitability.tif")),
        output_delta_tif = file.path(output_dir, paste0(base_name, "_future2_delta.tif")),
        n_cores = n_cores,
        log_fun = log_fun
      ),
      error = function(e) {
        log_message(log_fun, "2nd scenario failed: ", conditionMessage(e))
        NULL
      }
    )
    if (!is.null(future2)) {
      future2$summary <- summarise_suitability(future2$suitability, threshold)
      extra_paths <- c(extra_paths, future2$paths)

      # Comparison summary
      area1 <- future$summary$high_risk_area_km2 %||% NA_real_
      area2 <- future2$summary$high_risk_area_km2 %||% NA_real_
      if (is.finite(area1) && is.finite(area2)) {
        log_message(log_fun, "Scenario comparison: ", cfg$future_label, "=", sprintf("%.0f km2", area1),
          " | ", future_label2, "=", sprintf("%.0f km2", area2))
      }
    }
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }
  progress_step(progress_fun, 1.0, "Summarising outputs")
  suitability_summary <- summarise_suitability(suit, threshold)
  if (!is.null(future)) future$summary <- summarise_suitability(future$suitability, threshold)

  future_pngs <- save_future_pngs(future, occ, projection_extent, species, threshold, future_label, output_dir, base_name)
  if (!is.null(future_pngs$future_png)) extra_paths$future_suitability_png <- future_pngs$future_png
  if (!is.null(future_pngs$delta_png)) extra_paths$future_delta_png <- future_pngs$delta_png

  future2_pngs <- save_future_pngs(future2, occ, projection_extent, species, threshold, future_label2, output_dir, base_name, suffix = "2")
  if (!is.null(future2_pngs$future_png)) extra_paths$future2_suitability_png <- future2_pngs$future_png
  if (!is.null(future2_pngs$delta_png)) extra_paths$future2_delta_png <- future2_pngs$delta_png

  # EOO/AOO calculation
  eoo_aoo_result <- NULL
  if (!is.null(fit$occurrence_used)) {
    eoo_aoo_result <- tryCatch(
      compute_eoo_aoo(fit$occurrence_used, aoo_cell_size_km = 2, log_fun = log_fun),
      error = function(e) {
        log_message(log_fun, "EOO/AOO calculation failed: ", conditionMessage(e))
        NULL
      }
    )
  }

  projection_metrics <- NULL
  if (!is.null(training_extent) && !identical(projection_extent, training_extent)) {
    train_pres_suit <- tryCatch(as.numeric(fit$presence_suit), error = function(e) NULL)
    if (!is.null(train_pres_suit) && length(train_pres_suit) > 0 && !anyNA(train_pres_suit)) {
      validation_occ_df <- NULL
      if (!is.null(validation_occurrences)) {
        if (is.character(validation_occurrences) && length(validation_occurrences) == 1 && file.exists(validation_occurrences)) {
          validation_occ_df <- tryCatch(
            read.csv(validation_occurrences, stringsAsFactors = FALSE, check.names = FALSE),
            error = function(e) {
              log_message(log_fun, "  Validation occurrence file read failed: ", conditionMessage(e))
              NULL
            }
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
    suitability = suit, future = future, future2 = future2, climate_match = climate_match_result,
    mess = mess_result,
    eoo_aoo = eoo_aoo_result,
    aoa = aoa_result,
    summary = suitability_summary, metrics = metrics,
    paths = c(list(tif = output_tif, png = output_png, report = output_report), extra_paths)
  )
  result$report_text <- output_report
  write_manifest(result, output_dir, base_name, cpu_ms = metrics$elapsed_seconds * 1000)
  write_summary_report(result, result$report_text)
  result
}

# --- Pipeline stage API (I39) ---
# Allows running individual stages of the SDM pipeline independently.
# Each stage function takes a partial result and returns an updated one.

#' Run SDM pipeline: Stage 1 — Clean occurrence data
sdm_stage_clean <- function(cfg, log_fun = NULL) {
  log_message(log_fun, "Stage 1: Cleaning occurrence data")
  cleaned <- clean_occurrences(
    cfg$occurrence_file,
    min_source_records = cfg$min_source_records,
    merge_small_sources = cfg$merge_small_sources,
    use_cc = cfg$use_cc,
    cc_tests = cfg$cc_tests,
    log_fun = log_fun,
    max_coordinate_uncertainty = cfg$max_coordinate_uncertainty
  )
  list(cleaned = cleaned, occ = cleaned$occ)
}

#' Run SDM pipeline: Stage 2 — Load and scale environmental covariates
sdm_stage_covariates <- function(cfg, occ, log_fun = NULL) {
  log_message(log_fun, "Stage 2: Loading covariates")
  load_environment(
    worldclim_dir = cfg$worldclim_dir,
    selected_biovars = cfg$selected_biovars,
    training_extent = cfg$training_extent,
    projection_extent = cfg$projection_extent,
    aggregation_factor = cfg$aggregation_factor,
    allow_download = cfg$allow_download %||% TRUE,
    worldclim_res = cfg$worldclim_res,
    log_fun = log_fun,
    n_cores = cfg$n_cores,
    use_elevation = cfg$use_elevation %||% FALSE,
    elevation_demtype = cfg$elevation_demtype %||% "SRTMGL1",
    opentopo_api_key = cfg$opentopo_api_key %||% NULL,
    use_soil = cfg$use_soil %||% FALSE,
    selected_soil_vars = cfg$selected_soil_vars %||% character(0),
    selected_soil_depths = cfg$selected_soil_depths %||% character(0),
    use_uv = cfg$use_uv %||% FALSE,
    selected_uv_vars = cfg$selected_uv_vars %||% character(0),
    selected_uv_months = cfg$selected_uv_months %||% character(0),
    use_vegetation = cfg$use_vegetation %||% FALSE,
    veg_year = cfg$veg_year %||% NULL,
    veg_products = cfg$veg_products %||% character(0),
    use_lulc = cfg$use_lulc %||% FALSE,
    lulc_year = cfg$lulc_year %||% NULL,
    use_hfp = cfg$use_hfp %||% FALSE,
    hfp_year = cfg$hfp_year %||% NULL,
    use_bioclim_season = cfg$use_bioclim_season %||% FALSE,
    use_drought = cfg$use_drought %||% FALSE,
    selected_drought_periods = cfg$selected_drought_periods %||% character(0),
    covariate_cache_dir = cfg$covariate_cache_dir %||% NULL,
    source = cfg$source,
    selected_chelsa_extras = cfg$selected_chelsa_extras
  )
}

#' Run SDM pipeline: Stage 3 — Fit model
sdm_stage_fit <- function(cfg, occ, env, log_fun = NULL, progress_fun = NULL) {
  log_message(log_fun, "Stage 3: Fitting model")
  extra_args <- list()
  # Build extra_args from cfg as in run_fast_sdm...
  fit <- do.call(fit_sdm_model, c(list(
    model_id = cfg$model_id, occ = occ, env_train_scaled = env$env_train_scaled,
    background_n = cfg$background_n, include_quadratic = cfg$include_quadratic,
    cv_folds = cfg$cv_folds, seed = cfg$seed, n_cores = cfg$n_cores, log_fun = log_fun,
    progress_fun = progress_fun,
    cv_strategy = cfg$cv_strategy, cv_block_size_km = cfg$cv_block_size_km,
    bias_method = cfg$bias_method, target_group_occ = cfg$target_group_occ,
    thickening_distance_km = cfg$thickening_distance_km
  ), extra_args))
  list(fit = fit)
}

#' Run SDM pipeline: Stage 4 — Predict suitability
sdm_stage_predict <- function(cfg, fit, env, output_tif, log_fun = NULL) {
  log_message(log_fun, "Stage 4: Predicting suitability")
  suit <- predict_sdm_model(fit, env$env_project_scaled, output_tif, cfg$n_cores, log_fun)
  list(suit = suit, output_tif = output_tif)
}

#' Run SDM pipeline: Stage 5 — Post-processing (climate match, EOO/AOO, AOA)
sdm_stage_postprocess <- function(cfg, fit, suit, env, log_fun = NULL) {
  log_message(log_fun, "Stage 5: Post-processing")
  result <- list()

  # EOO/AOO
  if (!is.null(fit$occurrence_used)) {
    result$eoo_aoo <- tryCatch(
      compute_eoo_aoo(fit$occurrence_used, aoo_cell_size_km = 2, log_fun = log_fun),
      error = function(e) {
        log_message(log_fun, "  EOO/AOO computation failed: ", conditionMessage(e))
        NULL
      }
    )
  }

  # AOA
  if (!is.null(fit$model_data) && !is.null(fit$covariates)) {
    result$aoa <- tryCatch(
      compute_aoa(fit$model_data, env$env_project_scaled, fit$covariates,
        variable_importance = fit$variable_importance, method = "cast", log_fun = log_fun),
      error = function(e) {
        log_message(log_fun, "  AOA computation failed: ", conditionMessage(e))
        NULL
      }
    )
  }

  # Climate matching
  if (isTRUE(cfg$climate_matching)) {
    result$climate_match <- tryCatch(
      compute_climate_match(env$env_train_scaled, env$env_project_scaled,
        method = cfg$climate_matching_method %||% "mahalanobis", log_fun = log_fun),
      error = function(e) {
        log_message(log_fun, "  Climate matching failed: ", conditionMessage(e))
        NULL
      }
    )
  }

  result
}
