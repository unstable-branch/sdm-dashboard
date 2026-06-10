#!/usr/bin/env Rscript
# Background covariate download script.
# Called by callr::r_bg via Plumber's POST /api/v1/covariates/download_bg.
# Reads job config from <job_dir>/meta.json and writes results back.

`%||%` <- function(a, b) if (!is.null(a)) a else b

if (!exists("job_dir", inherits = FALSE) || is.null(job_dir) || length(job_dir) != 1 ||
    is.na(job_dir) || !nzchar(job_dir)) {
  job_dir <- commandArgs(trailingOnly = TRUE)[1]
}
if (!exists("app_dir", inherits = FALSE) || is.null(app_dir) || length(app_dir) != 1 ||
    is.na(app_dir) || !nzchar(app_dir)) {
  app_dir <- commandArgs(trailingOnly = TRUE)[2]
}
if (is.na(job_dir) || !nzchar(job_dir)) stop("job_dir is required", call. = FALSE)
if (is.na(app_dir) || !nzchar(app_dir)) stop("app_dir is required", call. = FALSE)

meta_file <- file.path(job_dir, "meta.json")
progress_file <- file.path(job_dir, "progress.log")

log_fun <- function(...) {
  msg <- paste0(...)
  cat(msg, "\n")
  cat(msg, "\n", file = progress_file, append = TRUE)
}

progress_fun <- function(pct, msg) {
  line <- sprintf("[%d%%] %s", as.integer(pct), msg)
  cat(line, "\n")
  cat(line, "\n", file = progress_file, append = TRUE)
  if (exists("sdm_redis_progress_set", inherits = TRUE)) {
    tryCatch(sdm_redis_progress_set(job_id, line), error = function(e) NULL)
  }
  if (exists("sdm_redis_cancel_check", inherits = TRUE)) {
    if (sdm_redis_cancel_check(job_id)) {
      stop("CANCELLED", call. = FALSE)
    }
  }
}

read_meta <- function() jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

write_meta <- function(meta) {
  tmp_path <- tempfile(pattern = "meta", tmpdir = dirname(meta_file))
  on.exit(unlink(tmp_path))
  writeLines(jsonlite::toJSON(meta, null = "null", auto_unbox = TRUE), tmp_path)
  sdm_safe_rename(tmp_path, meta_file)
}

meta <- read_meta()
config <- meta$config %||% list()
type <- config$type %||% ""
job_id <- meta$id %||% basename(job_dir)

tryCatch({
  source(file.path(app_dir, "R", "core", "bootstrap.R"))
  sdm_set_project_root(app_dir)
  source(file.path(app_dir, "R", "engine_load.R"))
  redis_r <- file.path(app_dir, "plumber", "R", "redis.R")
  if (file.exists(redis_r)) source(redis_r, local = TRUE)

  extent <- config$extent %||% sdm_default_projection_extent
  extent <- as.numeric(unlist(extent))
  if (length(extent) != 4 || any(!is.finite(extent))) {
    extent <- sdm_extent_presets$aus_full
  }
  cache_base <- file.path(app_dir, sdm_default_covariate_cache_dir)

  progress_fun(10, paste("Downloading", type))

  result <- NULL
  if (type == "elevation") {
    source(file.path(app_dir, "R", "covariates", "covariates_elevation.R"))
    result <- tryCatch(
      load_elevation_covariate(
        training_extent = extent, projection_extent = extent,
        cache_dir = cache_base, demtype = config$dem_type %||% sdm_default_elevation_demtype,
        api_key = config$apikey, log_fun = log_fun
      ),
      error = function(e) { log_fun("Elevation download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "soil") {
    source(file.path(app_dir, "R", "covariates", "covariates_soil.R"))
    result <- tryCatch(
      load_soil_covariate(
        soil_path = NULL, cache_dir = cache_base,
        selected_soil_vars = config$soil_vars %||% sdm_default_soil_vars,
        selected_soil_depths = config$soil_depths %||% sdm_default_soil_depths,
        log_fun = log_fun
      ),
      error = function(e) { log_fun("Soil download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "uv") {
    source(file.path(app_dir, "R", "covariates", "covariates_uv.R"))
    result <- tryCatch(
      load_uv_covariate(cache_dir = cache_base, log_fun = log_fun),
      error = function(e) { log_fun("UV download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "vegetation") {
    source(file.path(app_dir, "R", "covariates", "covariates_vegetation.R"))
    result <- tryCatch(
      load_vegetation_covariate(
        veg_year = config$veg_year %||% NULL,
        extent_vec = extent, cache_dir = cache_base, log_fun = log_fun
      ),
      error = function(e) { log_fun("Vegetation download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "lulc") {
    source(file.path(app_dir, "R", "covariates", "covariates_lulc.R"))
    result <- tryCatch(
      load_lulc_covariate(
        lulc_year = config$lulc_year %||% 2020,
        extent_vec = extent, cache_dir = cache_base, log_fun = log_fun
      ),
      error = function(e) { log_fun("LULC download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "hfp") {
    source(file.path(app_dir, "R", "covariates", "covariates_human_footprint.R"))
    result <- tryCatch(
      load_human_footprint_covariate(
        hfp_year = config$hfp_year %||% 2020,
        extent_vec = extent, cache_dir = cache_base, log_fun = log_fun
      ),
      error = function(e) { log_fun("HFP download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "drought") {
    source(file.path(app_dir, "R", "covariates", "covariates_drought.R"))
    result <- tryCatch(
      load_drought_covariate(
        selected_periods = config$drought_periods %||% "annual_mean",
        extent_vec = extent, cache_dir = cache_base, log_fun = log_fun
      ),
      error = function(e) { log_fun("Drought download failed: ", conditionMessage(e)); NULL }
    )
  } else if (type == "bioclim_seasonality") {
    source(file.path(app_dir, "R", "covariates", "covariates_bioclim_seasonality.R"))
    result <- tryCatch(
      load_bioclim_seasonality(
        extent_vec = extent, cache_dir = cache_base, log_fun = log_fun
      ),
      error = function(e) { log_fun("Bioclim seasonality download failed: ", conditionMessage(e)); NULL }
    )
  } else {
    stop("Unknown covariate type: ", type, call. = FALSE)
  }

  if (is.null(result)) {
    stop("Download returned no result — see progress log for details", call. = FALSE)
  }

  progress_fun(100, paste(type, "download complete"))
  meta$status <- "completed"
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  meta$result <- list(
    status = "success",
    message = paste("Downloaded", type, "successfully"),
    files = result$files %||% list()
  )
  write_meta(meta)

}, error = function(e) {
  err_msg <- conditionMessage(e)
  log_fun("Fatal error: ", err_msg)
  meta$status <- "failed"
  meta$error <- err_msg
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  write_meta(meta)
  if (!identical(err_msg, "CANCELLED")) {
    sdm_redis_progress_clear(job_id)
    sdm_redis_cancel_clear(job_id)
  }
})
