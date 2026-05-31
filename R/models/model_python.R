# Python executor bridge for SDM model backends.

fit_python_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                           include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                           seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                           cv_strategy = sdm_default_cv_strategy,
                           cv_block_size_km = sdm_default_cv_block_size_km,
                           threshold = sdm_default_threshold,
                           python_model_id = "elapid",
                           ...) {
  if (!requireNamespace("arrow", quietly = TRUE)) {
    stop("arrow package is required for the Python executor bridge. Install with: install.packages('arrow')", call. = FALSE)
  }

  manifest_path <- discover_python_models()
  model_manifest <- NULL
  for (mp in manifest_path) {
    m <- read_python_model_manifest(mp)
    if (identical(m$id, python_model_id)) {
      model_manifest <- m
      break
    }
  }
  if (is.null(model_manifest)) {
    stop("Python model '", python_model_id, "' not found in python_models/ directory.", call. = FALSE)
  }

  d <- prepare_sdm_data(occ, env_train_scaled, background_n,
    seed = seed, log_fun = log_fun,
    bias_method = "uniform",
    target_group_occ = NULL,
    thickening_distance_km = NULL
  )
  occ_used <- d$occ_used
  bg_xy <- d$bg_xy
  model_data <- d$model_data
  covariates <- d$covariates

  log_message(log_fun, "Fitting Python SDM (", python_model_id, ") with ",
    sum(model_data$presence == 1), " presences and ",
    sum(model_data$presence == 0), " background points")

  temp_dir <- tempfile(pattern = "python_sdm_")
  dir.create(temp_dir)

  train_data_path <- file.path(temp_dir, "train.feather")
  data_for_py <- model_data[, c("presence", covariates), drop = FALSE]
  data_for_py$.x <- model_data$.x
  data_for_py$.y <- model_data$.y
  arrow::write_feather(data_for_py, train_data_path)

  model_dir <- dirname(manifest_path)

  config <- list(
    data_path = normalizePath(train_data_path),
    output_dir = normalizePath(temp_dir),
    model_id = python_model_id,
    cv_folds = cv_folds,
    threshold = threshold,
    seed = seed
  )
  config_path <- file.path(temp_dir, "config.json")
  jsonlite::writeJSON(config, config_path, auto_unbox = TRUE)

  script_path <- file.path(model_dir, model_manifest$fit_script)
  if (!file.exists(script_path)) {
    stop("Fit script not found: ", script_path, call. = FALSE)
  }

  python_bin <- sdm_python_path()
  log_message(log_fun, "  Running: ", python_bin, " ", script_path)

  result <- system2(python_bin, c(normalizePath(script_path), normalizePath(config_path)),
    stdout = TRUE, stderr = TRUE)

  if (attr(result, "status") %||% 0 != 0) {
    error_msg <- paste(result[grepl("ERROR|Error|Traceback", result)], collapse = "\n")
    stop("Python SDM fit failed: ", error_msg, call. = FALSE)
  }

  model_path <- file.path(temp_dir, "model.pkl")
  if (!file.exists(model_path)) {
    stop("Python fit script did not produce model.pkl", call. = FALSE)
  }

  cv_results_path <- file.path(temp_dir, "cv_results.json")
  cv <- list(
    k = 0L, strategy = "none",
    auc_mean = NA_real_, auc_sd = NA_real_,
    tss_mean = NA_real_, tss_sd = NA_real_,
    fold_auc = numeric()
  )
  if (file.exists(cv_results_path)) {
    cv_results <- jsonlite::readJSON(cv_results_path)
  }

  importance_path <- file.path(temp_dir, "importance.feather")
  importance_df <- NULL
  if (file.exists(importance_path)) {
    importance_df <- arrow::read_feather(importance_path)
    imp_max <- max(importance_df$importance, na.rm = TRUE)
    if (is.finite(imp_max) && imp_max > 0) {
      importance_df$importance <- importance_df$importance / imp_max
    }
  }

  list(
    model = list(
      model_path = model_path,
      temp_dir = temp_dir,
      model_id = python_model_id,
      manifest = model_manifest,
      covariates = covariates
    ),
    formula = NULL,
    coefficients = data.frame(Message = paste("Python", python_model_id, "does not produce coefficients.")),
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = importance_df,
    python_params = list(model_id = python_model_id, temp_dir = temp_dir)
  )
}

predict_python_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be a Python model fit result list.", call. = FALSE)
  if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)

  model_path <- fit$model$model_path
  if (!file.exists(model_path)) {
    stop("Python model file not found: ", model_path, call. = FALSE)
  }

  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(fit$covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- fit$covariates[is.na(cov_idx)]
    stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]

  log_message(log_fun, "Predicting Python (", fit$model$model_id, ") suitability over ",
    terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster")

  env_df <- as.data.frame(terra::values(env_subset), stringsAsFactors = FALSE)
  names(env_df) <- fit$covariates
  complete_idx <- which(stats::complete.cases(env_df))
  n_cells <- length(complete_idx)

  if (n_cells == 0) {
    suit <- terra::rast(env_subset[[1]])
    names(suit) <- "suitability"
    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
    return(suit)
  }

  temp_dir <- tempfile(pattern = "python_pred_")
  dir.create(temp_dir)

  env_data_path <- file.path(temp_dir, "env.feather")
  arrow::write_feather(env_df[complete_idx, , drop = FALSE], env_data_path)

  config <- list(
    data_path = normalizePath(env_data_path),
    model_path = normalizePath(model_path),
    output_dir = normalizePath(temp_dir),
    model_id = fit$model$model_id
  )
  config_path <- file.path(temp_dir, "config.json")
  jsonlite::writeJSON(config, config_path, auto_unbox = TRUE)

  model_dir <- dirname(find_python_model_script(fit$model$model_id, "predict"))
  script_path <- file.path(model_dir, fit$model$manifest$predict_script)

  python_bin <- sdm_python_path()
  result <- system2(python_bin, c(normalizePath(script_path), normalizePath(config_path)),
    stdout = TRUE, stderr = TRUE)

  if (attr(result, "status") %||% 0 != 0) {
    error_msg <- paste(result[grepl("ERROR|Error|Traceback", result)], collapse = "\n")
    stop("Python prediction failed: ", error_msg, call. = FALSE)
  }

  pred_path <- file.path(temp_dir, "predictions.feather")
  if (!file.exists(pred_path)) {
    stop("Python predict script did not produce predictions.feather", call. = FALSE)
  }

  pred_df <- arrow::read_feather(pred_path)
  predictions <- pmax(0, pmin(1, pred_df$prediction))

  if (length(predictions) != n_cells) {
    stop("Python returned ", length(predictions), " predictions but expected ", n_cells, call. = FALSE)
  }

  suit <- terra::rast(env_subset[[1]])
  terra::values(suit) <- NA_real_
  suit[complete_idx] <- predictions
  names(suit) <- "suitability"

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
  log_message(log_fun, "Suitability raster written to: ", output_tif)

  unlink(temp_dir, recursive = TRUE)

  suit
}

find_python_model_script <- function(model_id, script_type) {
  manifests <- discover_python_models()
  for (mp in manifests) {
    m <- read_python_model_manifest(mp)
    if (identical(m$id, model_id)) {
      model_dir <- dirname(mp)
      script <- if (script_type == "fit") m$fit_script else m$predict_script
      return(file.path(model_dir, script))
    }
  }
  NULL
}
