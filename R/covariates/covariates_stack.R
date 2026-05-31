# Build the complete environmental covariate stack used by the model.

align_covariate_to_template <- function(r, template, method = "bilinear", log_fun = NULL) {
  same_crs <- tryCatch(isTRUE(terra::same.crs(r, template)), error = function(e) FALSE)
  if (!same_crs) {
    r <- tryCatch(terra::project(r, template, method = method), error = function(e) {
      stop("CRS reprojection failed: ", conditionMessage(e), call. = FALSE)
    })
  }
  r <- tryCatch(terra::crop(r, terra::ext(template), snap = "out"), error = function(e) {
    stop("Raster crop failed: ", conditionMessage(e), call. = FALSE)
  })
  tryCatch(terra::resample(r, template, method = method), error = function(e) {
    stop("Raster resample failed: ", conditionMessage(e), call. = FALSE)
  })
}

align_covariate_stack <- function(source, template_train, template_project) {
  r <- source$raster
  methods <- source$methods
  if (is.null(methods) || length(methods) == 0) methods <- rep("bilinear", terra::nlyr(r))
  if (length(methods) == 1L) methods <- rep(methods, terra::nlyr(r))
  names(methods) <- names(r)

  train_layers <- list()
  project_layers <- list()
  for (i in seq_len(terra::nlyr(r))) {
    nm <- names(r)[i]
    method <- methods[[nm]]
    train_layers[[nm]] <- align_covariate_to_template(r[[i]], template_train, method)
    project_layers[[nm]] <- align_covariate_to_template(r[[i]], template_project, method)
    names(train_layers[[nm]]) <- nm
    names(project_layers[[nm]]) <- nm
  }
  list(train = do.call(c, train_layers), project = do.call(c, project_layers))
}

load_extra_covariates <- function(template_train, template_project, training_extent, projection_extent,
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
                                  covariate_cache_dir = sdm_default_covariate_cache_dir,
                                  allow_download = TRUE, log_fun = NULL) {
  sources <- list()
  metadata <- list()
  files <- list()

  if (isTRUE(use_elevation)) {
    elev <- tryCatch(
      load_elevation_covariate(training_extent, projection_extent, covariate_cache_dir,
        elevation_demtype, opentopo_api_key, allow_download, log_fun),
      error = function(e) { log_message(log_fun, "Failed to load elevation: ", conditionMessage(e)); NULL }
    )
    if (!is.null(elev)) {
      sources$elevation <- elev
      metadata$elevation <- elev$source
      files$elevation <- elev$files
    }
  }

  if (isTRUE(use_soil)) {
    soil <- tryCatch(
      load_soil_covariate(soil_path = NULL, selected_soil_vars, selected_soil_depths, covariate_cache_dir, allow_download, log_fun),
      error = function(e) { log_message(log_fun, "Failed to load soil: ", conditionMessage(e)); NULL }
    )
    if (!is.null(soil)) {
      sources$soil <- soil
      metadata$soil <- list(source = soil$source, variables = soil$variables)
      files$soil <- soil$files
    }
  }

  if (isTRUE(use_uv)) {
    uv <- tryCatch(
      load_uv_covariate(selected_uv_vars, selected_uv_months, covariate_cache_dir, allow_download, log_fun),
      error = function(e) { log_message(log_fun, "Failed to load UV: ", conditionMessage(e)); NULL }
    )
    if (!is.null(uv)) {
      sources$uv <- uv
      metadata$uv <- list(source = uv$source, variables = uv$variables)
      files$uv <- uv$files
    }
  }

  if (isTRUE(use_vegetation)) {
    ndvi <- tryCatch(
      load_vegetation_covariate(veg_year = veg_year, selected_products = veg_products,
        extent_vec = training_extent, aggregate_factor = 18L,
        covariate_cache_dir = covariate_cache_dir, allow_download = allow_download, log_fun = log_fun),
      error = function(e) { log_message(log_fun, "Failed to load vegetation: ", conditionMessage(e)); NULL }
    )
    if (!is.null(ndvi)) {
      sources$vegetation <- ndvi
      metadata$vegetation <- list(source = ndvi$source, products = ndvi$variables$products)
      files$vegetation <- ndvi$files
    }
  }

  if (isTRUE(use_lulc)) {
    lulc <- tryCatch(
      load_lulc_covariate(lulc_year = lulc_year, extent_vec = training_extent,
        aggregate_factor = 18L, covariate_cache_dir = covariate_cache_dir,
        allow_download = allow_download, log_fun = log_fun),
      error = function(e) { log_message(log_fun, "Failed to load LULC: ", conditionMessage(e)); NULL }
    )
    if (!is.null(lulc)) {
      sources$lulc <- lulc
      metadata$lulc <- list(source = lulc$source, variables = lulc$variables)
      files$lulc <- lulc$files
    }
  }

  if (isTRUE(use_hfp)) {
    hfp <- tryCatch(
      load_human_footprint_covariate(hfp_year = hfp_year, extent_vec = training_extent,
        aggregate_factor = 18L, covariate_cache_dir = covariate_cache_dir,
        allow_download = allow_download, log_fun = log_fun),
      error = function(e) { log_message(log_fun, "Failed to load human footprint: ", conditionMessage(e)); NULL }
    )
    if (!is.null(hfp)) {
      sources$hfp <- hfp
      metadata$hfp <- list(source = hfp$source, variables = hfp$variables)
      files$hfp <- hfp$files
    }
  }

  if (isTRUE(use_bioclim_season)) {
    bioclim <- tryCatch(
      load_bioclim_seasonality(extent_vec = training_extent,
        covariate_cache_dir = covariate_cache_dir, allow_download = allow_download, log_fun = log_fun),
      error = function(e) { log_message(log_fun, "Failed to load bioclim seasonality: ", conditionMessage(e)); NULL }
    )
    if (!is.null(bioclim)) {
      sources$bioclim_season <- bioclim
      metadata$bioclim_season <- list(source = bioclim$source, variables = bioclim$variables)
      files$bioclim_season <- bioclim$files
    }
  }

  if (isTRUE(use_drought)) {
    drought <- tryCatch(
      load_drought_covariate(selected_periods = selected_drought_periods,
        extent_vec = training_extent, aggregate_factor = 3L,
        covariate_cache_dir = covariate_cache_dir, allow_download = allow_download, log_fun = log_fun),
      error = function(e) { log_message(log_fun, "Failed to load drought: ", conditionMessage(e)); NULL }
    )
    if (!is.null(drought)) {
      sources$drought <- drought
      metadata$drought <- list(source = drought$source, variables = drought$variables)
      files$drought <- drought$files
    }
  }

  if (length(sources) == 0) {
    return(list(train = NULL, project = NULL, metadata = metadata, files = files))
  }

  aligned <- lapply(sources, align_covariate_stack, template_train = template_train, template_project = template_project)
  train <- do.call(c, lapply(aligned, `[[`, "train"))
  project <- do.call(c, lapply(aligned, `[[`, "project"))
  list(train = train, project = project, metadata = metadata, files = files)
}

load_environment <- function(worldclim_dir, selected_biovars, training_extent, projection_extent,
                             aggregation_factor = sdm_default_aggregation_factor, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                             log_fun = NULL, n_cores = NULL,
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
                             covariate_cache_dir = sdm_default_covariate_cache_dir,
                             source = sdm_default_climate_source,
                             selected_chelsa_extras = NULL) {
  climate <- load_climate_covariates(worldclim_dir, selected_biovars, training_extent, projection_extent,
    aggregation_factor, allow_download, worldclim_res, log_fun, n_cores,
    source = source, selected_chelsa_extras = selected_chelsa_extras
  )

  env_train <- climate$env_train
  env_project <- climate$env_project
  extras <- load_extra_covariates(
    env_train[[1]], env_project[[1]], training_extent, projection_extent,
    use_elevation, elevation_demtype, opentopo_api_key,
    use_soil, selected_soil_vars, selected_soil_depths,
    use_uv, selected_uv_vars, selected_uv_months,
    use_vegetation, veg_year, veg_products,
    use_lulc, lulc_year,
    use_hfp, hfp_year,
    use_bioclim_season,
    use_drought, selected_drought_periods,
    covariate_cache_dir,
    allow_download, log_fun
  )
  if (!is.null(extras$train)) {
    env_train <- c(env_train, extras$train)
    env_project <- c(env_project, extras$project)
    log_message(log_fun, "Added optional covariates: ", paste(names(extras$train), collapse = ", "))
  }

  means <- tryCatch(terra::global(env_train, "mean", na.rm = TRUE)[, 1],
    error = function(e) {
      stop("Failed to compute covariate means: ", conditionMessage(e), call. = FALSE)
    })
  sds <- tryCatch(terra::global(env_train, "sd", na.rm = TRUE)[, 1],
    error = function(e) {
      stop("Failed to compute covariate standard deviations: ", conditionMessage(e), call. = FALSE)
    })
  names(means) <- names(env_train)
  names(sds) <- names(env_train)
  keep <- is.finite(means) & is.finite(sds) & sds > 0
  if (!all(keep)) {
    log_message(log_fun, "Dropping zero-variance/empty covariates: ", paste(names(env_train)[!keep], collapse = ", "))
    env_train <- env_train[[keep]]
    env_project <- env_project[[keep]]
    means <- means[keep]
    sds <- sds[keep]
  }
  if (terra::nlyr(env_train) < 2) stop("Too few usable environmental layers after filtering.", call. = FALSE)

  env_train_scaled <- scale_raster_stack(env_train, means, sds)
  env_project_scaled <- scale_raster_stack(env_project, means, sds)
  log_message(
    log_fun, "Prepared covariates: ", terra::nlyr(env_train_scaled), " layer(s); training cells = ",
    format(terra::ncell(env_train_scaled), big.mark = ","), "; projection cells = ",
    format(terra::ncell(env_project_scaled), big.mark = ",")
  )

  list(
    env_train = env_train, env_project = env_project,
    env_train_scaled = env_train_scaled, env_project_scaled = env_project_scaled,
    means = means, sds = sds, selected_biovars = climate$selected_biovars,
    files = c(list(climate = climate$files), extras$files), extra_covariates = extras$metadata
  )
}
