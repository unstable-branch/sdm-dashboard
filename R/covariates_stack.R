# Build the complete environmental covariate stack used by the model.

align_covariate_to_template <- function(r, template, method = "bilinear") {
  same_crs <- tryCatch(isTRUE(terra::same.crs(r, template)), error = function(e) FALSE)
  if (!same_crs) r <- terra::project(r, template, method = method)
  r <- terra::crop(r, terra::ext(template), snap = "out")
  terra::resample(r, template, method = method)
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
<<<<<<< HEAD
                                  use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                                  use_soil = FALSE, soil_path = sdm_default_soil_path,
                                  selected_soil_vars = sdm_default_soil_vars, covariate_cache_dir = sdm_default_covariate_cache_dir,
                                  allow_download = TRUE, log_fun = NULL) {
=======
                                   use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                                   use_soil = FALSE, soil_path = sdm_default_soil_path,
                                   selected_soil_vars = config$soil_vars_default, selected_depths = config$soil_depths_default, covariate_cache_dir = sdm_default_covariate_cache_dir,
                                   allow_download = TRUE, log_fun = NULL) {
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  sources <- list()
  metadata <- list()
  files <- list()

  if (isTRUE(use_elevation)) {
    elev <- load_elevation_covariate(training_extent, projection_extent, covariate_cache_dir,
                                     elevation_demtype, opentopo_api_key, allow_download, log_fun)
    if (!is.null(elev)) {
      sources$elevation <- elev
      metadata$elevation <- elev$source
      files$elevation <- elev$files
    }
  }

  if (isTRUE(use_soil)) {
<<<<<<< HEAD
    soil <- load_soil_covariate(soil_path, selected_soil_vars, log_fun)
    if (!is.null(soil)) {
      sources$soil <- soil
      metadata$soil <- list(source = soil$source, variables = soil$variables)
      files$soil <- soil$files
    }
=======
    # Use the new SoilGrids loader to build a stack of continuous variables
    source('R/covariates_soilgrid.R', local = TRUE)
    soil_stack <- build_soilstack(vars = selected_soil_vars, depths = selected_depths)
    # Wrap the stack in a list compatible with the existing align_covariate_stack function
    soil <- list(raster = soil_stack, methods = NULL, source = 'SoilGrids', variables = selected_soil_vars, files = NULL)
    sources$soil <- soil
    metadata$soil <- list(source = soil$source, variables = soil$variables)
    files$soil <- soil$files
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  }

  if (length(sources) == 0) return(list(train = NULL, project = NULL, metadata = metadata, files = files))

  aligned <- lapply(sources, align_covariate_stack, template_train = template_train, template_project = template_project)
  train <- do.call(c, lapply(aligned, `[[`, "train"))
  project <- do.call(c, lapply(aligned, `[[`, "project"))
  list(train = train, project = project, metadata = metadata, files = files)
}

load_environment <- function(worldclim_dir, selected_biovars, training_extent, projection_extent,
<<<<<<< HEAD
                             aggregation_factor = sdm_default_aggregation_factor, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                             log_fun = NULL, n_cores = NULL,
                             use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                             use_soil = FALSE, soil_path = sdm_default_soil_path,
                             selected_soil_vars = sdm_default_soil_vars, covariate_cache_dir = sdm_default_covariate_cache_dir) {
=======
                               aggregation_factor = sdm_default_aggregation_factor, allow_download = TRUE, worldclim_res = sdm_default_worldclim_res,
                               log_fun = NULL, n_cores = NULL,
                               use_elevation = FALSE, elevation_demtype = sdm_default_elevation_demtype, opentopo_api_key = NULL,
                               use_soil = TRUE, soil_path = sdm_default_soil_path,
                               selected_soil_vars = config$soil_vars_default, selected_depths = config$soil_depths_default, covariate_cache_dir = sdm_default_covariate_cache_dir) {
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  climate <- load_climate_covariates(worldclim_dir, selected_biovars, training_extent, projection_extent,
                                     aggregation_factor, allow_download, worldclim_res, log_fun, n_cores)

  env_train <- climate$env_train
  env_project <- climate$env_project
  extras <- load_extra_covariates(env_train[[1]], env_project[[1]], training_extent, projection_extent,
                                  use_elevation, elevation_demtype, opentopo_api_key,
<<<<<<< HEAD
                                  use_soil, soil_path, selected_soil_vars, covariate_cache_dir,
=======
                                   use_soil, soil_path, selected_soil_vars, selected_depths, covariate_cache_dir,
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
                                  allow_download, log_fun)
  if (!is.null(extras$train)) {
    env_train <- c(env_train, extras$train)
    env_project <- c(env_project, extras$project)
    log_message(log_fun, "Added optional covariates: ", paste(names(extras$train), collapse = ", "))
  }

  means <- terra::global(env_train, "mean", na.rm = TRUE)[, 1]
  sds <- terra::global(env_train, "sd", na.rm = TRUE)[, 1]
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
  log_message(log_fun, "Prepared covariates: ", terra::nlyr(env_train_scaled), " layer(s); training cells = ",
              format(terra::ncell(env_train_scaled), big.mark = ","), "; projection cells = ",
              format(terra::ncell(env_project_scaled), big.mark = ","))

  list(env_train = env_train, env_project = env_project,
       env_train_scaled = env_train_scaled, env_project_scaled = env_project_scaled,
       means = means, sds = sds, selected_biovars = climate$selected_biovars,
       files = c(list(climate = climate$files), extras$files), extra_covariates = extras$metadata)
}
