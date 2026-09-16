# Optional future-climate projection helpers.

future_projection_files <- function(future_worldclim_dir, selected_biovars) {
  find_cmip6_files(sdm_resolve_project_path(future_worldclim_dir), selected_biovars)
}

future_projection_ready <- function(future_worldclim_dir, selected_biovars) {
  files <- future_projection_files(future_worldclim_dir, selected_biovars)
  length(files) > 0 && !any(is.na(files))
}

project_future_suitability <- function(fit, current_suitability, env, future_worldclim_dir,
                                       selected_biovars, projection_extent, aggregation_factor = 1,
                                       output_future_tif, output_delta_tif, n_cores = 1,
                                       log_fun = NULL, mask_extrapolation = TRUE,
                                       mess_threshold = 0, mess_train_data = NULL) {
  if (length(mess_threshold) != 1L || !is.numeric(mess_threshold) || !is.finite(mess_threshold)) {
    stop("mess_threshold must be one finite numeric value", call. = FALSE)
  }
  future_worldclim_dir <- sdm_resolve_project_path(future_worldclim_dir)
  if (!dir.exists(future_worldclim_dir)) stop("Future WorldClim/CMIP6 folder does not exist: ", future_worldclim_dir, call. = FALSE)
  selected_biovars <- validate_biovars(selected_biovars)
  future_files <- future_projection_files(future_worldclim_dir, selected_biovars)
  if (any(is.na(future_files))) {
    missing <- selected_biovars[is.na(future_files)]
    stop("Missing future climate layer(s): ", paste(paste0("BIO", missing), collapse = ", "), ". Add matching future/CMIP6 BIO GeoTIFFs or turn future projection off.", call. = FALSE)
  }

  # MESS and prediction must use the exact post-VIF feature set. The caller
  # supplies a scaled training snapshot; its names are the authoritative model
  # feature names, so dropped predictors cannot leak back into this projection.
  mess_input <- if (!is.null(mess_train_data)) mess_train_data else if (!is.null(env$env_train_scaled)) env$env_train_scaled else if (!is.null(env$env_train)) {
    scale_raster_stack(env$env_train, env$means[names(env$env_train)], env$sds[names(env$env_train)])
  } else stop("MESS training predictors are unavailable; future projection cannot continue", call. = FALSE)
  required_names <- names(mess_input)
  if (length(required_names) == 0L) stop("MESS training predictors have no names", call. = FALSE)
  env_project_raw <- env$env_project %||% env$env_project_for_future
  if (is.null(env_project_raw)) stop("Current projection predictors are unavailable; future projection cannot continue", call. = FALSE)

  log_message(log_fun, "Loading future climate layers from ", future_worldclim_dir)
  future_climate <- cmip6_load_future_covariates(
    cmip6_dir = future_worldclim_dir, selected_biovars = selected_biovars,
    training_extent = projection_extent, projection_extent = projection_extent,
    aggregation_factor = aggregation_factor, log_fun = log_fun
  )
  future_project <- future_climate$env_future
  static_names <- setdiff(required_names, names(future_project))
  if (length(static_names) > 0L) {
    missing_static <- setdiff(static_names, names(env_project_raw))
    if (length(missing_static) > 0L) stop("Future projection is missing static covariate layer(s): ", paste(missing_static, collapse = ", "), call. = FALSE)
    log_message(log_fun, "Reusing current static covariates for future projection: ", paste(static_names, collapse = ", "))
    future_project <- c(future_project, env_project_raw[[static_names]])
  }
  missing_names <- setdiff(required_names, names(future_project))
  if (length(missing_names) > 0L) stop("Future projection is missing covariate layer(s): ", paste(missing_names, collapse = ", "), call. = FALSE)
  future_project <- future_project[[required_names]]

  # The future climate is raw; transform it with the same training means and
  # sds used by the fitted model before both prediction and MESS.
  future_scaled <- scale_raster_stack(future_project, env$means[required_names], env$sds[required_names])
  if (!identical(sort(names(mess_input)), sort(names(future_scaled)))) stop("MESS training and future predictors have incompatible names", call. = FALSE)
  mess_result <- compute_mess(mess_input, future_scaled)

  output_stem <- sub("\\.tif$", "", output_future_tif)
  output_stem <- sub("_suitability$", "", output_stem)
  output_mess_tif <- paste0(output_stem, "_mess.tif")
  output_mod_tif <- paste0(output_stem, "_mod.tif")
  terra::writeRaster(mess_result$mess, output_mess_tif, overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
  terra::writeRaster(compute_mod(mess_result$per_variable), output_mod_tif, overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"), datatype = "INT1U"))

  if (!is.null(fit$model$components) && length(fit$model$components) >= 2) {
    log_message(log_fun, "Using multi-model ensemble prediction for future projection")
    future_suitability <- predict_multi_model_ensemble(fit, future_scaled, output_future_tif, n_cores, log_fun, export_components = FALSE)
  } else {
    future_suitability <- predict_sdm_model(fit, future_scaled, output_future_tif, n_cores, log_fun)
  }

  mask_applied <- isTRUE(mask_extrapolation)
  masked_cells <- 0L
  if (mask_applied) {
    mask <- mess_result$mess < mess_threshold
    masked_count <- terra::global(mask, "sum", na.rm = TRUE)[1, 1]
    if (is.finite(masked_count)) masked_cells <- as.integer(masked_count)
    future_suitability <- terra::ifel(mask, NA, future_suitability)
    names(future_suitability) <- "suitability"
  }
  delta <- future_suitability - current_suitability
  names(delta) <- "suitability_delta"
  terra::writeRaster(future_suitability, output_future_tif, overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
  terra::writeRaster(delta, output_delta_tif, overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))

  log_message(log_fun, sprintf("MESS: %.1f%% of cells extrapolate beyond training envelope", mess_result$pct_extrapolation * 100))
  if (mask_applied) log_message(log_fun, "MESS mask applied at threshold ", mess_threshold, ": ", masked_cells, " cell(s) masked")
  else log_message(log_fun, "MESS mask disabled; no extrapolation cells were masked")
  gc(verbose = FALSE)

  list(
    suitability = future_suitability, delta = delta,
    summary = sdm_step("summarise-future", summarise_suitability(future_suitability, log_fun = log_fun)),
    files = future_files,
    paths = list(future_tif = output_future_tif, delta_tif = output_delta_tif, mess_tif = output_mess_tif, mod_tif = output_mod_tif),
    mess = list(pct_extrapolation = mess_result$pct_extrapolation, mask_applied = mask_applied,
                mask_threshold = mess_threshold, masked_cells = masked_cells)
  )
}

average_gcm_suitability <- function(gcm_suitability_paths, output_dir, base_name,
                                    include_sd = TRUE, log_fun = NULL) {
  if (length(gcm_suitability_paths) == 0) {
    stop("gcm_suitability_paths must be a non-empty named list of GCM raster paths", call. = FALSE)
  }
  if (is.null(names(gcm_suitability_paths))) {
    stop("gcm_suitability_paths must be a named list with GCM names as names", call. = FALSE)
  }
  if (!dir.exists(output_dir)) {
    dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  }

  log_message(log_fun, "Loading ", length(gcm_suitability_paths), " GCM suitability rasters")
  rasts <- lapply(gcm_suitability_paths, function(p) {
    if (!file.exists(p)) {
      stop("Suitability raster not found: ", p, call. = FALSE)
    }
    terra::rast(p)
  })

  stacked <- terra::sprc(rasts)
  avg_suit <- terra::app(stacked, mean, na.rm = TRUE)
  names(avg_suit) <- "suitability_gcm_avg"

  avg_path <- file.path(output_dir, paste0(base_name, "_gcm_avg_suitability.tif"))
  terra::writeRaster(avg_suit, avg_path,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
  )

  result <- list(
    averaged_suitability = avg_suit,
    sd_suitability = NULL,
    gcms_averaged = names(gcm_suitability_paths),
    n_gcms = length(gcm_suitability_paths)
  )

  if (include_sd) {
    sd_suit <- terra::app(stacked, stats::sd, na.rm = TRUE)
    names(sd_suit) <- "suitability_gcm_sd"
    sd_path <- file.path(output_dir, paste0(base_name, "_gcm_sd_suitability.tif"))
    terra::writeRaster(sd_suit, sd_path,
      overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
    )
    result$sd_suitability <- sd_suit
  }

  log_message(log_fun, "Averaged ", result$n_gcms, " GCMs -> ", avg_path)
  result
}

discover_gcm_suitability_dirs <- function(output_dir, pattern) {
  if (!dir.exists(output_dir)) {
    return(character(0))
  }
  dirs <- list.dirs(output_dir, full.names = TRUE, recursive = FALSE)
  dirs[grepl(pattern, basename(dirs), fixed = TRUE)]
}
