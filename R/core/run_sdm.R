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
  analysis_crs <- cfg$analysis_crs %||% sdm_default_analysis_crs
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
  multi_ensemble_export <- cfg$multi_ensemble_export
  multi_ensemble_uncertainty <- cfg$multi_ensemble_uncertainty
  biomod2_models <- cfg$biomod2_models
  esm_n_runs <- cfg$esm_n_runs
  esm_split <- cfg$esm_split
  esm_min_auc <- cfg$esm_min_auc
  esm_weighting_metric <- cfg$esm_weighting_metric %||% "AUC"
  esm_power <- cfg$esm_power
  esm_biovars <- cfg$esm_biovars
  rangebag_n_bags <- cfg$rangebag_n_bags
  rangebag_bag_fraction <- cfg$rangebag_bag_fraction
  rangebag_vars_per_bag <- cfg$rangebag_vars_per_bag
  maxnet_auto_tune <- isTRUE(cfg$maxnet_auto_tune)
  rf_num_trees <- cfg$rf_num_trees %||% 500L
  rf_mtry <- cfg$rf_mtry %||% NA_integer_
  rf_min_node_size <- cfg$rf_min_node_size %||% 10L
  gam_k <- cfg$gam_k %||% 5L
  xgb_max_depth <- cfg$xgb_max_depth %||% 6L
  xgb_eta <- cfg$xgb_eta %||% 0.3
  xgb_nrounds <- cfg$xgb_nrounds %||% 100L
  dnn_model_type <- cfg$dnn_model_type %||% "DNN_Medium"
  dnn_dropout <- cfg$dnn_dropout %||% 0.3
  dnn_lambda <- cfg$dnn_lambda %||% 0.001
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

  tryCatch({
    mem_info <- terra::mem_info()
    if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
      if (mem_info$memavail < 0.5) {
        stop(sprintf("System memory critically low (%.1f GB available). Aborting run.", mem_info$memavail), call. = FALSE)
      }
      if (mem_info$memavail < 2.0) {
        log_message(log_fun, sprintf("Low memory warning: %.1f GB available", mem_info$memavail))
      }
    }
  }, error = function(e) {
    if (grepl("^System memory", conditionMessage(e))) stop(e)
  })

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
    ), call. = FALSE)
  }
  dwca_doi <- attr(cleaned$raw, "gbif_doi")
  if (!is.null(dwca_doi) && !is.na(dwca_doi) && nzchar(dwca_doi)) {
    log_message(log_fun, "DwC-A GBIF dataset DOI: ", dwca_doi)
  }
  cleaned$raw <- NULL
  gc(verbose = FALSE)
  if (is.null(training_extent)) training_extent <- make_training_extent(occ, buffer = 2)
  log_message(log_fun, "Training extent: ", paste(training_extent, collapse = ", "))
  if (is.null(projection_extent)) {
    auto <- sdm_auto_extent(occ, buffer_deg = 2)
    projection_extent <- auto
    log_message(log_fun, "  Auto-detected projection extent from occurrence data: ", paste(projection_extent, collapse = ", "))
  }
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
          safe_keep <- intersect(keep_vars, names(env$means))
          env$means <- env$means[safe_keep]
          env$sds <- env$sds[safe_keep]
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
      biovars = esm_biovars, min_auc = esm_min_auc, weighting_metric = esm_weighting_metric, power = esm_power,
      n_runs_eval = esm_n_runs, data_split = esm_split
    )
  } else if (identical(model_id, "rangebag") || identical(model_id, "ensemble_glm_rangebag")) {
    list(
      n_bags = rangebag_n_bags, bag_fraction = rangebag_bag_fraction,
      vars_per_bag = rangebag_vars_per_bag
    )
  } else if (identical(model_id, "rf")) {
    list(
      num_trees = rf_num_trees, mtry = if (is.na(rf_mtry)) NULL else rf_mtry,
      min_node_size = rf_min_node_size
    )
  } else if (identical(model_id, "gam")) {
    list(max_k = gam_k)
  } else if (identical(model_id, "xgboost")) {
    list(
      max_depth = xgb_max_depth, eta = xgb_eta, nrounds = xgb_nrounds
    )
  } else if (identical(model_id, "dnn")) {
    list(
      dnn_model_type = dnn_model_type, dropout = dnn_dropout, lambda = dnn_lambda
    )
  } else {
    character(0)
  }

  # MaxNet auto-tune: override features/regmult with grid search results
  if (identical(model_id, "maxnet") && isTRUE(maxnet_auto_tune)) {
    log_message(log_fun, "Auto-tuning MaxNet hyperparameters via grid search")
    if (!requireNamespace("maxnet", quietly = TRUE)) {
      log_message(log_fun, "  maxnet package not available — using manual settings")
    } else {
      model_data <- occ_data$model_data
      covariates <- occ_data$covariates
      if (!is.null(model_data) && length(covariates) > 0) {
        tune_result <- tryCatch(
          tune_maxnet(model_data, covariates,
            regmult_grid = c(0.5, 1.0, 1.5, 2.0, 3.0),
            feature_sets = c("lqph", "lqp", "lp", "l"),
            k = max(cv_folds, 3L), seed = seed, n_cores = n_cores, log_fun = log_fun
          ),
          error = function(e) {
            log_message(log_fun, "  Auto-tune failed: ", conditionMessage(e))
            NULL
          }
        )
        if (!is.null(tune_result)) {
          best <- attr(tune_result, "best")
          if (!is.null(best)) {
            maxnet_features <- best$features
            maxnet_regmult <- best$regmult
            log_message(log_fun, "  Best: features=", maxnet_features, " regmult=", sprintf("%.1f", maxnet_regmult))
          }
        }
      }
    }
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

  gc(verbose = FALSE)

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
        as.numeric(predict(mod$model, df, clamp = TRUE, type = "link"))
      },
      function(mod, newdata) stop("No importance prediction defined for model: ", model_id)
    )
    if (is.data.frame(importance_result) && nrow(importance_result) > 0) {
      log_message(log_fun, "Importance computed for ", nrow(importance_result), " variables")
    }
  } else if (!is.null(fit$variable_importance) && is.data.frame(fit$variable_importance)) {
    importance_result <- fit$variable_importance
  }

  extra_paths <- list()

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

  # MESS (Multivariate Environmental Similarity Surface) for current predictions
  mess_result <- NULL
  if (!is.null(env$env_train) && !is.null(env$env_project)) {
    mess_result <- tryCatch(
      compute_mess(env$env_train, env$env_project),
      error = function(e) {
        log_message(log_fun, "MESS computation failed: ", conditionMessage(e))
        NULL
      }
    )
  }
  if (!is.null(mess_result)) {
    log_message(log_fun, "  MESS: ", sprintf("%.1f%%", mess_result$pct_extrapolation * 100), " of projection area outside training range")
  }

  if (check_cancelled(log_fun)) {
    return(invisible(NULL))
  }

  # Pre-flight memory check: reject if prediction likely exceeds 60% of available RAM
  tryCatch({
    mem_info <- terra::mem_info()
    if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
      n_cells <- terra::ncell(env$env_project_scaled)
      n_layers <- terra::nlyr(env$env_project_scaled)
      est_gb <- n_cells * n_layers * 8 / (1024^3) * 3.0
      if (is.finite(est_gb) && est_gb > mem_info$memavail * 0.6) {
        stop(sprintf(
          "Estimated prediction memory (%.1f GB) exceeds 60%% of available RAM (%.1f GB). ",
          est_gb, mem_info$memavail
        ), call. = FALSE)
      }
    }
  }, error = function(e) {
    if (grepl("^Estimated prediction memory", conditionMessage(e))) stop(e)
  })

  # ESM-specific memory guard: ecospat loads entire raster into R memory,
  # bypassing terra's chunked processing. ESM memory multiplier is ~8x.
  if (identical(model_id, "esm_glm") || identical(model_id, "esm_maxnet")) {
    tryCatch({
      mem_info <- terra::mem_info()
      if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
        n_cells <- terra::ncell(env$env_project_scaled)
        n_layers <- terra::nlyr(env$env_project_scaled)
        esm_est_gb <- n_cells * n_layers * 8 / (1024^3) * 8.0
        if (is.finite(esm_est_gb) && esm_est_gb > mem_info$memavail * 0.6) {
          stop(sprintf(
            "ESM prediction estimated at %.1f GB — exceeds 60%% of available RAM (%.1f GB). ",
            esm_est_gb, mem_info$memavail
          ), call. = FALSE)
        }
      }
    }, error = function(e) {
      if (grepl("^ESM prediction estimated", conditionMessage(e))) stop(e)
    })
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

  # Pre-flight memory check: warn if raster prediction may exceed available RAM
  tryCatch({
    if (requireNamespace("terra", quietly = TRUE)) {
      mem_avail <- terra::mem_info()$memavail
      n_cells <- terra::ncell(env$env_project_scaled)
      est_gb <- n_cells * length(names(env$env_project_scaled)) * 8 / (1024^3) * 2.5
      if (is.finite(est_gb) && is.finite(mem_avail) && est_gb > mem_avail * 0.8) {
        log_message(log_fun, "WARNING: Estimated prediction memory (", sprintf("%.1f GB", est_gb),
          ") exceeds 80% of available RAM (", sprintf("%.1f GB", mem_avail),
          "). Prediction may fail with OOM.")
      }
    }
  }, error = function(e) NULL)

  progress_step(progress_fun, 0.80, "Predicting projection raster")
  base_name <- paste0(safe_slug(species), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))
  output_tif <- file.path(output_dir, paste0(base_name, "_suitability.tif"))
  output_png <- file.path(output_dir, paste0(base_name, "_suitability.png"))
  output_report <- file.path(output_dir, paste0(base_name, "_report.txt"))
  suit <- tryCatch({
    if (identical(model_id, "multi_ensemble")) {
      predict_multi_model_ensemble(fit, env$env_project_scaled, output_tif, n_cores, log_fun,
        export_components = isTRUE(multi_ensemble_export),
        include_uncertainty = isTRUE(multi_ensemble_uncertainty),
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

  # Ensure suitability raster is clipped to projection extent
  if (!is.null(projection_extent) && inherits(suit, "SpatRaster")) {
    tmp_cropped <- tempfile(fileext = ".tif")
    suit <- terra::crop(suit,
      terra::ext(projection_extent[1], projection_extent[2], projection_extent[3], projection_extent[4]),
      filename = tmp_cropped, overwrite = TRUE)
    file.rename(tmp_cropped, output_tif)
    suit <- terra::rast(output_tif)
    mm <- tryCatch(terra::minmax(suit), error = function(e) NULL)
    if (!is.null(mm) && all(!is.finite(mm))) {
      stop("No valid cells in suitability raster — all predictions were NA", call. = FALSE)
    }
    log_message(log_fun, "  Clipped suitability raster to projection extent")
  }

  # Apply boundary mask if configured
  mask_type <- cfg$mask_type %||% sdm_default_mask_type
  if (mask_type != "none") {
    mask_file <- cfg$mask_file %||% sdm_default_mask_file
    buffer_deg <- cfg$mask_buffer_deg %||% sdm_default_mask_buffer_deg
    suit <- apply_boundary_mask(suit, mask_type, mask_file, buffer_deg, log_fun,
                                output_tif = output_tif)
    mm <- tryCatch(terra::minmax(suit), error = function(e) NULL)
    if (!is.null(mm) && all(!is.finite(mm))) {
      stop("Boundary mask produced all-NA raster — mask does not overlap projection extent", call. = FALSE)
    }
  }

  # Ensemble variable importance (multi-model) — must come after suit is assigned
  if (identical(model_id, "multi_ensemble") && !is.null(attr(suit, "ensemble_importance"))) {
    importance_result <- attr(suit, "ensemble_importance")
    log_message(log_fun, "Ensemble weighted importance computed across ", importance_result$n_models[1], " models")
  }

  # PA replication: average predictions across replicates
  if (pa_replicates > 1 && !is.null(fit$pa_replicates)) {
    pa_temp_files <- character(0)
    on.exit(unlink(pa_temp_files), add = TRUE)
    suit_sum <- suit
    valid_reps <- 1L
    for (rep_i in seq_len(pa_replicates)[-1]) {
      rep_fit <- replicate_fits[[rep_i]]
      if (is.null(rep_fit)) next
      rep_tif <- tempfile(pattern = paste0("pa_rep", rep_i, "_"), fileext = ".tif")
      pa_temp_files <- c(pa_temp_files, rep_tif)
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

  # --- XYZ tile generation (optional, non-fatal) ---
  if (isTRUE(cfg$generate_tiles %||% TRUE)) {
    output_tiles_dir <- file.path(output_dir, "map_tiles")
    tile_result <- tryCatch({
      tr <- generate_xyz_tiles(
        input       = suit,
        output_dir  = output_tiles_dir,
        palette     = c("#0A1624", "#123247", "#15545D", "#1F8A70", "#59C174",
                        "#C6D65B", "#F3C45A", "#F28A3C", "#E34B35", "#A51E3B"),
        value_range = c(0, 1),
        band_names  = "suitability",
        verbose     = FALSE,
        log         = function(msg) log_message(log_fun, "  ", msg)
      )
      log_message(log_fun, "  XYZ tiles: ", tr$bands[["suitability"]]$tile_count,
                  " tiles (zoom ", tr$bands[["suitability"]]$zoom_min, "-",
                  tr$bands[["suitability"]]$zoom_max, ") in ",
                  round(tr$generation_time, 1), "s")
      extra_paths[["tiles_dir"]] <- output_tiles_dir
      extra_paths[["tile_zoom_min"]] <- as.character(tr$bands[["suitability"]]$zoom_min)
      extra_paths[["tile_zoom_max"]] <- as.character(tr$bands[["suitability"]]$zoom_max)
      tr
    }, error = function(e) {
      log_message(log_fun, "  Tile generation skipped: ", conditionMessage(e))
      NULL
    })
  }

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
    if (isTRUE(multi_ensemble_export)) {
      comp_paths <- attr(suit, "component_paths")
      if (!is.null(comp_paths)) {
        for (m in names(comp_paths)) {
          extra_paths[[paste0("multi_ens_comp_", m)]] <- comp_paths[[m]]
        }
      }
    }
    extra_paths$multi_ens_mean_tif <- attr(suit, "ensemble_mean_tif")
    extra_paths$multi_ens_median_tif <- attr(suit, "ensemble_median_tif")
    extra_paths$multi_ens_committee_tif <- attr(suit, "ensemble_committee_tif")
    sd_tif <- attr(suit, "ensemble_sd_tif")
    if (!is.null(sd_tif)) extra_paths$multi_ens_sd_tif <- sd_tif
    cpaths <- attr(suit, "component_paths")
    if (!is.null(cpaths) && !is.null(cpaths[["disagreement"]])) {
      extra_paths$multi_ens_disagreement_tif <- cpaths[["disagreement"]]
    }
  }

  if (isTRUE(future_projection)) {
    if (identical(cfg$source %||% "worldclim", "chelsa")) {
      log_message(log_fun, "Note: Future projection uses WorldClim CMIP6 data regardless of current climate source. CHELSA v2.1 future data is not supported. Future layers will be loaded from: ", future_worldclim_dir)
    }
    progress_step(progress_fun, 0.95, "Projecting future climate scenario")
    mask_extrapolation <- isTRUE(cfg$extrapolation_mask %||% TRUE)
    mess_threshold <- cfg$mess_threshold %||% 0
    future <- tryCatch(
      project_future_suitability(
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
      ),
      error = function(e) {
        log_message(log_fun, "Future projection failed: ", conditionMessage(e))
        NULL
      }
    )
    if (!is.null(future)) extra_paths <- c(extra_paths, future$paths)
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
      compute_eoo_aoo(fit$occurrence_used, aoo_cell_size_km = 2, analysis_crs = analysis_crs, output_dir = output_dir, log_fun = log_fun),
      error = function(e) {
        log_message(log_fun, "EOO/AOO calculation failed: ", conditionMessage(e))
        NULL
      }
    )
  }
  if (!is.null(eoo_aoo_result)) {
    if (!is.null(eoo_aoo_result$eoo_polygon_geojson)) extra_paths$eoo_polygon <- eoo_aoo_result$eoo_polygon_geojson
    if (!is.null(eoo_aoo_result$aoo_grid_geojson)) extra_paths$aoo_grid <- eoo_aoo_result$aoo_grid_geojson
  }

  # Save MESS raster for current predictions
  if (!is.null(mess_result)) {
    mess_tif <- file.path(output_dir, paste0(base_name, "_mess.tif"))
    tryCatch({
      terra::writeRaster(mess_result$mess, mess_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
      extra_paths[["mess_tif"]] <- mess_tif
    }, error = function(e) {
      log_message(log_fun, "  Failed to write MESS raster: ", conditionMessage(e))
    })
  }

  projection_metrics <- NULL
  if (!is.null(training_extent) && !identical(projection_extent, training_extent)) {
    train_pres_suit <- tryCatch(as.numeric(fit$presence_suit), error = function(e) NULL)
    if (!is.null(train_pres_suit) && length(train_pres_suit) > 0 && !anyNA(train_pres_suit)) {
      validation_occ_df <- NULL
      if (!is.null(validation_occurrences)) {
        if (is.character(validation_occurrences) && length(validation_occurrences) == 1 && file.exists(validation_occurrences)) {
          validation_occ_df <- tryCatch({
            tmp_val <- tempfile()
            on.exit(unlink(tmp_val), add = TRUE)
            decrypt_file(validation_occurrences, tmp_val)
            read.csv(tmp_val, stringsAsFactors = FALSE, check.names = FALSE)
          },
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
        seed = seed,
        log_fun = log_fun
      )
    }
  }

  save_suitability_png(suit, occ, projection_extent, species, threshold, output_png)

  elapsed <- as.numeric(difftime(Sys.time(), start_time, units = "secs"))
  log_message(log_fun, "Completed in ", sprintf("%.1f", elapsed), " seconds")

  # Overfitting detection: compare training (in-sample) vs cross-validated performance
  train_auc <- fit$metrics$training_auc %||% fit$metrics$auc %||% NA_real_
  cv_auc <- fit$cv$auc_mean %||% NA_real_
  auc_diff <- if (is.finite(train_auc) && is.finite(cv_auc)) train_auc - cv_auc else NA_real_
  overfitting_level <- if (is.na(auc_diff)) {
    NA_character_
  } else if (auc_diff > 0.15) {
    "high"
  } else if (auc_diff > 0.07) {
    "medium"
  } else if (auc_diff > 0.03) {
    "low"
  } else {
    "none"
  }
  train_cbi <- fit$metrics$cbi %||% NA_real_
  cv_cbi_val <- fit$metrics$cv_cbi %||% NA_real_
  cbi_diff <- if (is.finite(train_cbi) && is.finite(cv_cbi_val)) train_cbi - cv_cbi_val else NA_real_
  if (!is.na(overfitting_level) && overfitting_level != "none") {
    log_message(log_fun, "Overfitting warning (", overfitting_level, "): training AUC (", sprintf("%.3f", train_auc),
      ") exceeds CV AUC (", sprintf("%.3f", cv_auc), ") by ", sprintf("%.3f", auc_diff))
  }

  metrics <- list(
    presence_records = nrow(fit$occurrence_used), background_points = nrow(fit$background_xy),
    auc_mean = fit$cv$auc_mean, auc_sd = fit$cv$auc_sd, cv_folds = fit$cv$k,
    n_cores = n_cores, elapsed_seconds = elapsed,
    cbi = fit$metrics$cbi %||% NA_real_,
    cv_cbi = fit$metrics$cv_cbi %||% NA_real_,
    projection = projection_metrics,
    training_auc = train_auc,
    auc_diff = auc_diff,
    overfitting_level = overfitting_level,
    cbi_diff = cbi_diff
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
    presence_suit = fit$presence_suit, background_suit = fit$background_suit,
    variable_importance = importance_result,
    response_curves = response_curves,
    suitability = suit, future = future, future2 = future2, climate_match = climate_match_result,
    mess = mess_result,
    eoo_aoo = eoo_aoo_result,
    mess = mess_result,
    aoa = aoa_result,
    summary = suitability_summary, metrics = metrics,
    paths = c(list(tif = output_tif, png = output_png, report = output_report), extra_paths)
  )
  result$report_text <- output_report
  tryCatch(write_manifest(result, output_dir, base_name, cpu_ms = metrics$elapsed_seconds * 1000),
    error = function(e) log_message(log_fun, "Manifest write failed: ", conditionMessage(e)))
  tryCatch(write_summary_report(result, result$report_text),
    error = function(e) log_message(log_fun, "Summary report write failed: ", conditionMessage(e)))
  result
}

# --- Pipeline stage API (I39) ---
# Allows running individual stages of the SDM pipeline independently.
# Each stage function takes a partial result and returns an updated one.

#' Run SDM pipeline: Stage 1 — Clean occurrence data
# Build model-specific extra_args from cfg (shared between run_fast_sdm and sdm_stage_fit)
build_stage_extra_args <- function(cfg, model_id) {
  if (identical(model_id, "maxnet")) {
    list(maxnet_features = cfg$maxnet_features, maxnet_regmult = cfg$maxnet_regmult)
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
    list(n_seeds = cfg$dnn_n_seeds %||% 5L, dnn_model_type = cfg$dnn_model_type %||% "DNN_Medium", dnn_device = cfg$dnn_device %||% "auto",
         dropout = cfg$dnn_dropout %||% 0.3, lambda = cfg$dnn_lambda %||% 0.001)
  } else if (identical(model_id, "gam")) {
    list(max_k = cfg$gam_k %||% 5L)
  } else if (identical(model_id, "rf")) {
    list(num_trees = cfg$rf_num_trees %||% 500L, mtry = cfg$rf_mtry %||% NULL, min_node_size = cfg$rf_min_node_size %||% 10L)
  } else if (identical(model_id, "xgboost")) {
    list(max_depth = cfg$xgb_max_depth %||% 6L, eta = cfg$xgb_eta %||% 0.3, nrounds = cfg$xgb_nrounds %||% 100L)
  } else if (identical(model_id, "bart")) {
    list(ntree = cfg$bart_ntree %||% 200L, ndpost = cfg$bart_ndpost %||% 1000L, nskip = cfg$bart_nskip %||% 500L)
  } else if (identical(model_id, "brms")) {
    list(chains = cfg$brms_chains %||% 4L, iter = cfg$brms_iter %||% 2000L, warmup = cfg$brms_warmup %||% 1000L)
  } else if (identical(model_id, "inla_spde")) {
    list(mesh_max_edge = cfg$inla_mesh_max_edge %||% NULL, mesh_cutoff = cfg$inla_mesh_cutoff %||% NULL,
      prior_range = cfg$inla_prior_range %||% NULL, prior_sigma = cfg$inla_prior_sigma %||% NULL)
  } else if (identical(model_id, "rangebag")) {
    list(n_bags = cfg$n_bags %||% sdm_default_rangebag_n_bags, bag_fraction = cfg$bag_fraction %||% sdm_default_rangebag_fraction,
      vars_per_bag = cfg$vars_per_bag %||% sdm_default_rangebag_vars_per_bag)
  } else if (identical(model_id, "occupancy")) {
    list(detection_formula = cfg$detection_formula %||% "~1", model_type = cfg$occupancy_model_type %||% "occu")
  } else if (identical(model_id, "dnn_multispecies")) {
    list(dnn_model_type = cfg$dnn_architecture %||% "DNN_Medium", n_seeds = cfg$dnn_multispecies_n_seeds %||% 3L,
      dnn_device = cfg$dnn_device %||% "auto")
  } else if (identical(model_id, "biomod2")) {
    list(models = cfg$biomod2_models %||% config$biomod2_default %||% c("GLM", "MAXNET", "RF"))
  } else if (identical(model_id, "multi_ensemble")) {
    list(
      selected_models = cfg$multi_ensemble_models, ensemble_weighting = cfg$multi_ensemble_weighting,
      ensemble_power = cfg$multi_ensemble_power, min_auc = cfg$multi_ensemble_min_auc,
      min_tss = cfg$multi_ensemble_min_tss, biomod2_models = cfg$biomod2_models
    )
  } else if (identical(model_id, "esm_glm") || identical(model_id, "esm_maxnet")) {
    list(
      biovars = cfg$esm_biovars, min_auc = cfg$esm_min_auc, weighting_metric = cfg$esm_weighting_metric,
      power = cfg$esm_power, n_runs_eval = cfg$esm_n_runs, data_split = cfg$esm_split
    )
  } else {
    character(0)
  }
}

sdm_stage_clean <- function(cfg, log_fun = NULL) {
  log_message(log_fun, "Stage 1: Cleaning occurrence data")
  cleaned <- tryCatch(
    clean_occurrences(
      cfg$occurrence_file,
      min_source_records = cfg$min_source_records,
      merge_small_sources = cfg$merge_small_sources,
      use_cc = cfg$use_cc,
      cc_tests = cfg$cc_tests,
      log_fun = log_fun,
      max_coordinate_uncertainty = cfg$max_coordinate_uncertainty
    ),
    error = function(e) {
      stop("Stage 1 (clean) failed: ", conditionMessage(e), call. = FALSE)
    }
  )
  list(cleaned = cleaned, occ = cleaned$occ)
}

#' Run SDM pipeline: Stage 2 — Load and scale environmental covariates
sdm_stage_covariates <- function(cfg, occ, log_fun = NULL) {
  log_message(log_fun, "Stage 2: Loading covariates")
  tryCatch(load_environment(
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
  ), error = function(e) {
    stop("Stage 2 (covariates) failed: ", conditionMessage(e), call. = FALSE)
  })
}

#' Run SDM pipeline: Stage 3 — Fit model
sdm_stage_fit <- function(cfg, occ, env, log_fun = NULL, progress_fun = NULL) {
  log_message(log_fun, "Stage 3: Fitting model")
  model_id <- cfg$model_id %||% "glm"
  extra_args <- build_stage_extra_args(cfg, model_id)
  fit <- tryCatch(
    do.call(fit_sdm_model, c(list(
      model_id = model_id, occ = occ, env_train_scaled = env$env_train_scaled,
      background_n = cfg$background_n, include_quadratic = cfg$include_quadratic,
      cv_folds = cfg$cv_folds, seed = cfg$seed, n_cores = cfg$n_cores, log_fun = log_fun,
      progress_fun = progress_fun,
      cv_strategy = cfg$cv_strategy, cv_block_size_km = cfg$cv_block_size_km,
      bias_method = cfg$bias_method, target_group_occ = cfg$target_group_occ,
      thickening_distance_km = cfg$thickening_distance_km
    ), extra_args)),
    error = function(e) {
      stop("Stage 3 (fit) failed: ", conditionMessage(e), call. = FALSE)
    }
  )
  list(fit = fit)
}

#' Run SDM pipeline: Stage 4 — Predict suitability
sdm_stage_predict <- function(cfg, fit, env, output_tif, log_fun = NULL) {
  log_message(log_fun, "Stage 4: Predicting suitability")
  suit <- tryCatch(
    predict_sdm_model(fit, env$env_project_scaled, output_tif, cfg$n_cores, log_fun),
    error = function(e) {
      stop("Stage 4 (predict) failed: ", conditionMessage(e), call. = FALSE)
    }
  )
  list(suit = suit, output_tif = output_tif)
}

#' Run SDM pipeline: Stage 4b — Future climate projection
sdm_stage_future <- function(cfg, fit, suit, env, output_dir, base_name, log_fun = NULL) {
  if (!isTRUE(cfg$future_projection) || is.null(cfg$future_worldclim_dir)) {
    return(list(future = NULL))
  }
  log_message(log_fun, "Stage 4b: Projecting future climate scenario")
  future <- tryCatch(project_future_suitability(
    fit = fit, current_suitability = suit, env = env,
    future_worldclim_dir = cfg$future_worldclim_dir,
    selected_biovars = cfg$selected_biovars,
    projection_extent = cfg$projection_extent,
    aggregation_factor = cfg$aggregation_factor %||% 1,
    output_future_tif = file.path(output_dir, paste0(base_name, "_future_suitability.tif")),
    output_delta_tif = file.path(output_dir, paste0(base_name, "_future_delta.tif")),
    n_cores = cfg$n_cores %||% 1, log_fun = log_fun,
    mask_extrapolation = isTRUE(cfg$extrapolation_mask %||% TRUE),
    mess_threshold = cfg$mess_threshold %||% 0
  ), error = function(e) {
    stop("Stage 4b (future) failed: ", conditionMessage(e), call. = FALSE)
  })
  list(future = future)
}

#' Run SDM pipeline: Stage 5 — Post-processing (climate match, EOO/AOO, AOA, XAI)
sdm_stage_postprocess <- function(cfg, fit, suit, env, log_fun = NULL) {
  log_message(log_fun, "Stage 5: Post-processing")
  result <- tryCatch({

  # EOO/AOO
  if (!is.null(fit$occurrence_used)) {
    result$eoo_aoo <- tryCatch(
      compute_eoo_aoo(fit$occurrence_used, aoo_cell_size_km = 2, analysis_crs = cfg$analysis_crs %||% sdm_default_analysis_crs, output_dir = cfg$output_dir %||% NULL, log_fun = log_fun),
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

  # Variable importance
  model_spec <- tryCatch(get_sdm_model(cfg$model_id %||% "glm"), error = function(e) NULL)
  if (!is.null(model_spec) && isTRUE(model_spec$supports_importance) && !is.null(fit$model_data)) {
    result$importance <- tryCatch(
      xai_importance(fit, seed = cfg$seed %||% 42, n_cores = cfg$n_cores %||% 1),
      error = function(e) { log_message(log_fun, "  Importance skipped: ", conditionMessage(e)); NULL }
    )
  }
  if (!is.null(fit$model_data)) {
    result$response_curves <- tryCatch(
      compute_response_curves(fit, fit$model_data, n_points = 50),
      error = function(e) { log_message(log_fun, "  Response curves skipped: ", conditionMessage(e)); NULL }
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
  }, error = function(e) {
    stop("Stage 5 (postprocess) failed: ", conditionMessage(e), call. = FALSE)
  })
}
