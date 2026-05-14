# Optional future-climate projection helpers.

future_projection_files <- function(future_worldclim_dir, selected_biovars) {
  find_worldclim_files(future_worldclim_dir, selected_biovars)
}

future_projection_ready <- function(future_worldclim_dir, selected_biovars) {
  files <- future_projection_files(future_worldclim_dir, selected_biovars)
  length(files) > 0 && !any(is.na(files))
}

project_future_suitability <- function(fit, current_suitability, env, future_worldclim_dir,
                                       selected_biovars, projection_extent, aggregation_factor = 1,
                                       output_future_tif, output_delta_tif, n_cores = 1,
                                       log_fun = NULL) {
  if (!dir.exists(future_worldclim_dir)) {
    stop("Future WorldClim/CMIP6 folder does not exist: ", future_worldclim_dir, call. = FALSE)
  }
  selected_biovars <- validate_biovars(selected_biovars)
  future_files <- future_projection_files(future_worldclim_dir, selected_biovars)
  if (any(is.na(future_files))) {
    missing <- selected_biovars[is.na(future_files)]
    stop("Missing future climate layer(s): ", paste(paste0("BIO", missing), collapse = ", "),
         ". Add matching future/CMIP6 BIO GeoTIFFs or turn future projection off.", call. = FALSE)
  }

  log_message(log_fun, "Loading future climate layers from ", future_worldclim_dir)
  future_climate <- load_climate_covariates(
    worldclim_dir = future_worldclim_dir,
    selected_biovars = selected_biovars,
    training_extent = projection_extent,
    projection_extent = projection_extent,
    aggregation_factor = aggregation_factor,
    allow_download = FALSE,
    worldclim_res = sdm_default_worldclim_res,
    log_fun = log_fun,
    n_cores = n_cores
  )

  future_project <- future_climate$env_project
  static_names <- setdiff(names(env$env_project), names(future_project))
  if (length(static_names) > 0) {
    log_message(log_fun, "Reusing current static covariates for future projection: ", paste(static_names, collapse = ", "))
    future_project <- c(future_project, env$env_project[[static_names]])
  }

  required_names <- names(env$env_project)
  missing_names <- setdiff(required_names, names(future_project))
  if (length(missing_names) > 0) {
    stop("Future projection is missing covariate layer(s): ", paste(missing_names, collapse = ", "), call. = FALSE)
  }
  future_project <- future_project[[required_names]]
  future_scaled <- scale_raster_stack(future_project, env$means[required_names], env$sds[required_names])

  if (!is.null(fit$model$components) && length(fit$model$components) >= 2) {
    log_message(log_fun, "Using multi-model ensemble prediction for future projection")
    future_suitability <- predict_multi_model_ensemble(fit, future_scaled, output_future_tif, n_cores, log_fun, export_components = FALSE)
  } else {
    future_suitability <- predict_sdm_model(fit, future_scaled, output_future_tif, n_cores, log_fun)
  }
  delta <- future_suitability - current_suitability
  names(delta) <- "suitability_delta"
  terra::writeRaster(delta, output_delta_tif, overwrite = TRUE,
                     wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))

  log_message(log_fun, "Computing MESS extrapolation surface")
  mess_result <- compute_mess(env$env_train, future_project)

  output_mess_tif <- sub("_future_suitability\\.tif$", "_future_mess.tif", output_future_tif)
  output_mod_tif <- sub("_future_suitability\\.tif$", "_future_mod.tif", output_future_tif)

  terra::writeRaster(mess_result$mess, output_mess_tif, overwrite = TRUE,
                     wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))

  mod_raster <- compute_mod(mess_result$per_variable)
  terra::writeRaster(mod_raster, output_mod_tif, overwrite = TRUE,
                     wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"), datatype = "INT1U"))

  log_message(log_fun, sprintf("MESS: %.1f%% of cells extrapolate beyond training envelope", mess_result$pct_extrapolation * 100))

  list(
    suitability = future_suitability,
    delta = delta,
    summary = summarise_suitability(future_suitability),
    files = future_files,
    paths = list(future_tif = output_future_tif, delta_tif = output_delta_tif,
                 mess_tif = output_mess_tif, mod_tif = output_mod_tif),
    mess = list(
      pct_extrapolation = mess_result$pct_extrapolation
    )
  )
}
