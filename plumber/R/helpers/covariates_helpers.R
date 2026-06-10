handle_covariates_check <- function(res, app_dir) {
  tryCatch({
    covariate_dir <- file.path(app_dir, "covariates")
    
    check_dir <- function(subdir, patterns) {
      full_path <- file.path(covariate_dir, subdir)
      if (!dir.exists(full_path)) {
        return(list(available = FALSE, detail = "Not downloaded"))
      }
      files <- list.files(full_path, pattern = patterns)
      if (length(files) > 0) {
        size_bytes <- sum(file.info(file.path(full_path, files))$size, na.rm = TRUE)
        list(available = TRUE, detail = sprintf("%d file(s)", length(files)), file_count = length(files), size_bytes = size_bytes)
      } else {
        list(available = FALSE, detail = "Empty directory")
      }
    }
    
    list(
      covariates = list(
        elevation = check_dir("opentopo", "\\.tif$"),
        soil = check_dir("soilgrids", "\\.tif$"),
        uv = check_dir("gluv", "\\.(tif|asc)$"),
        vegetation = check_dir("vegetation", "\\.tif$"),
        lulc = check_dir("lulc", "\\.tif$"),
        hfp = check_dir("human_footprint", "\\.tif$"),
        drought = check_dir("drought", "\\.tif$"),
        bioclim_seasonality = check_dir("bioclim_season", "\\.tif$")
      )
    )
  }, error = function(e) {
    list(covariates = list(
      elevation = list(available = FALSE, detail = "Error"),
      soil = list(available = FALSE, detail = "Error"),
      uv = list(available = FALSE, detail = "Error"),
      vegetation = list(available = FALSE, detail = "Error"),
      lulc = list(available = FALSE, detail = "Error"),
      hfp = list(available = FALSE, detail = "Error"),
      drought = list(available = FALSE, detail = "Error"),
      bioclim_seasonality = list(available = FALSE, detail = "Error")
    ))
  })
}

handle_covariates_download <- function(req, app_dir) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(body)) {
    return(sdm_error(req, 400, "Request body is empty or not valid JSON"))
  }

  type <- body$type
  valid_types <- c("elevation", "soil", "uv", "vegetation", "lulc", "hfp", "drought", "bioclim_seasonality")
  if (is.null(type) || !nzchar(type) || !type %in% valid_types) {
    return(sdm_error(req, 400, paste0("Invalid or missing 'type'. Must be one of: ", paste(valid_types, collapse = ", "))))
  }

  tryCatch({
    extent <- body$extent %||% sdm_default_projection_extent
    extent <- as.numeric(unlist(extent))
    if (length(extent) != 4 || any(!is.finite(extent))) {
      extent <- sdm_extent_presets$aus_full
    }

    cache_base <- file.path(app_dir, sdm_default_covariate_cache_dir)

    if (type == "elevation") {
      source(file.path(app_dir, "R", "covariates", "covariates_elevation.R"))
      result <- load_elevation_covariate(
        training_extent = extent,
        projection_extent = extent,
        demtype = body$dem_type %||% sdm_default_elevation_demtype,
        api_key = body$apikey
      )
      cache_dir <- file.path(cache_base, "opentopo")
    } else if (type == "soil") {
      source(file.path(app_dir, "R", "covariates", "covariates_soil.R"))
      result <- load_soil_covariate(
        soil_path = NULL,
        selected_soil_vars = body$soil_vars %||% sdm_default_soil_vars,
        selected_soil_depths = body$soil_depths %||% sdm_default_soil_depths
      )
      cache_dir <- file.path(cache_base, "soilgrids")
    } else if (type == "uv") {
      source(file.path(app_dir, "R", "covariates", "covariates_uv.R"))
      result <- load_uv_covariate()
      cache_dir <- file.path(cache_base, "gluv")
    } else if (type == "vegetation") {
      source(file.path(app_dir, "R", "covariates", "covariates_vegetation.R"))
      result <- load_vegetation_covariate(
        veg_year = body$veg_year %||% NULL,
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "gimms")
    } else if (type == "lulc") {
      source(file.path(app_dir, "R", "covariates", "covariates_lulc.R"))
      result <- load_lulc_covariate(
        lulc_year = body$lulc_year %||% 2020,
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "lulc")
    } else if (type == "hfp") {
      source(file.path(app_dir, "R", "covariates", "covariates_human_footprint.R"))
      result <- load_human_footprint_covariate(
        hfp_year = body$hfp_year %||% 2020,
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "human_footprint")
    } else if (type == "drought") {
      source(file.path(app_dir, "R", "covariates", "covariates_drought.R"))
      result <- load_drought_covariate(
        selected_periods = body$drought_periods %||% "annual_mean",
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "drought")
    } else if (type == "bioclim_seasonality") {
      source(file.path(app_dir, "R", "covariates", "covariates_bioclim_seasonality.R"))
      result <- load_bioclim_seasonality(
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "bioclim_season")
    }

    if (is.null(result)) {
      return(list(status = "error", message = paste("Failed to download", type, "- check logs for details"), files = list()))
    }

    downloaded_files <- if (dir.exists(cache_dir)) {
      list.files(cache_dir, recursive = TRUE)
    } else {
      character(0)
    }

    list(
      status = "success",
      message = paste("Downloaded", type, "successfully"),
      files = downloaded_files
    )
  }, error = function(e) {
    list(status = "error", message = conditionMessage(e))
  })
}

handle_covariates_download_bg <- function(req, app_dir) {
  body <- req$postBody
  if (is.null(body)) body <- list()
  if (is.character(body)) body <- jsonlite::fromJSON(body, simplifyVector = FALSE)

  type <- body$type %||% ""
  job_id <- paste0("cov_", format(Sys.time(), "%Y%m%d_%H%M%S"), "_", paste(sample(letters, 6), collapse = ""))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  job_meta <- list(
    id = job_id,
    type = type,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    completed_at = NULL,
    error = NULL,
    config = body
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  script_path <- file.path(app_dir, "plumber", "R", "covariate_download.R")
  if (!file.exists(script_path)) {
    stop("Covariate download script not found at: ", script_path, call. = FALSE)
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  cmdargs = c("--no-save", "--no-restore", "--no-init-file"),
  env = c(
    HOME = "/app",
    R_MAX_VSIZE = sdm_detect_vsize()
  ))

  sdm_process_registry[[job_id]] <- list(proc = proc, device = "cpu")
  job_meta$process_pid <- proc$get_pid()
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  list(
    job_id = job_id,
    status = "running",
    message = paste("Covariate download started:", type)
  )
}
