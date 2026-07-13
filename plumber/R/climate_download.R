#!/usr/bin/env Rscript
# Background climate download script.
# Called by callr::r_bg via Plumber's POST /api/v1/climate/download.
# Reads job config from <job_dir>/meta.json and writes results back.
# Prevents closure serialization issues with callr.

# Support both: callr::r_bg with direct arguments (script, job_dir, app_dir in env)
# and CLI invocation via Rscript (commandArgs trailingOnly)
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

progress_fun <- function(pct, msg = NULL) {
  event <- if (is.list(pct)) pct else list(value = pct, detail = msg, stage = "download")
  raw_value <- suppressWarnings(as.numeric(event$value %||% 0))
  if (!is.finite(raw_value)) raw_value <- 0
  # Download helpers report a 0..1 fraction; endpoint lifecycle events use 0..100.
  display_pct <- if (is.list(pct)) 10 + 80 * max(0, min(1, raw_value)) else raw_value
  detail <- event$detail %||% msg %||% ""
  line <- sprintf("[%d%%] %s", as.integer(round(display_pct)), detail)
  cat(line, "\n")
  cat(line, "\n", file = progress_file, append = TRUE)
  if (job_id %||% "" != "") {
    entry <- c(list(
      timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      percent = display_pct,
      detail = detail,
      stage = event$stage %||% "download"
    ), event[setdiff(names(event), c("value", "detail", "stage"))])
    entry_json <- jsonlite::toJSON(entry, auto_unbox = TRUE, null = "null")
    if (exists("sdm_redis_progress_set", inherits = TRUE)) {
      tryCatch(sdm_redis_progress_set(job_id, entry_json), error = function(e) NULL)
    }
    if (exists("sdm_redis_cancel_check", inherits = TRUE) && sdm_redis_cancel_check(job_id)) {
      stop("CANCELLED", call. = FALSE)
    }
  }
}


read_meta <- function() {
  jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
}

write_meta <- function(meta) {
  tmp_path <- tempfile(pattern = "meta", tmpdir = dirname(meta_file))
  on.exit(unlink(tmp_path))
  writeLines(jsonlite::toJSON(meta, null = "null", auto_unbox = TRUE), tmp_path)
  sdm_safe_rename(tmp_path, meta_file)
}

meta <- read_meta()
config <- meta$config %||% list()
download_type <- config$type %||% "cmip6"
job_id <- meta$id %||% basename(job_dir)
created_files <- character()

cleanup_on_failure <- function() {
  partials <- character()
  roots <- c(
    sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir),
    sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir),
    sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  )
  for (root in roots[dir.exists(roots)]) {
    partials <- c(partials, list.files(root, pattern = "[.]part$", recursive = TRUE, full.names = TRUE))
  }
  if (length(partials) > 0) {
    log_fun("Retained ", length(partials), " partial download(s) for the next retry")
  }
}


tryCatch({
  progress_fun(5, "Initializing download")

  source(file.path(app_dir, "R", "core", "bootstrap.R"))
  sdm_set_project_root(app_dir)
  source(file.path(app_dir, "R", "engine_load.R"))
  # Source Redis helpers for background progress reporting
  redis_r <- file.path(app_dir, "plumber", "R", "redis.R")
  if (file.exists(redis_r)) source(redis_r, local = TRUE)

  if (download_type %in% c("cmip6", "cmip6_average")) {
    gcm <- config$gcm %||% "UKESM1-0-LL"
    ssp <- config$ssp %||% "SSP2-4.5"
    period <- config$period %||% "2041-2060"
    res <- as.numeric(config$res %||% 10)

    if (download_type == "cmip6") {
      progress_fun(10, "Downloading CMIP6")
      log_fun("Scenario: ", gcm, " / ", ssp, " / ", period, " (", res, "m)")
      source(file.path(app_dir, "R", "covariates", "covariates_climate_future.R"), local = TRUE)
      fetch_cmip6_worldclim(gcm = gcm, ssp = ssp, period = period, var = "bioc", res = res,
                            out_dir = sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir),
                            quiet = FALSE, log_fun = log_fun)
      progress_fun(90, "CMIP6 download complete")
    } else {
      gcm_list <- config$gcm_list %||% character(0)
      progress_fun(10, "Averaging CMIP6 GCMs")
      log_fun("GCMs: ", paste(gcm_list, collapse = ", "), " / ", ssp, " / ", period)
      source(file.path(app_dir, "R", "covariates", "covariates_climate_future.R"), local = TRUE)
      average_cmip6_gcms(gcm_list = gcm_list, ssp = ssp, period = period, var = "bioc", res = res,
                         out_dir = sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir),
                         quiet = FALSE, log_fun = log_fun, progress_fun = progress_fun)
      progress_fun(90, "GCM averaging complete")
    }
  } else if (download_type == "worldclim") {
    climate_res <- as.numeric(config$res %||% 10)
    biovars <- config$biovars
    if (is.character(biovars)) biovars <- as.integer(unlist(strsplit(biovars, ",")))
    worldclim_dir <- sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
    progress_fun(10, paste0("Downloading WorldClim v2.1 BIO layers (", climate_res, "m)"))
    log_fun("Requested BIO variables: ", paste(biovars, collapse = ", "))
    source(file.path(app_dir, "R", "covariates", "covariates_climate.R"), local = TRUE)
    result <- download_worldclim_bio(worldclim_dir = worldclim_dir, selected_biovars = biovars,
      res = climate_res, log_fun = log_fun, progress_fun = progress_fun)
    created_files <- result$downloaded %||% character()
    if (length(result$failed) > 0) {
      meta$failed_vars <- result$failed
      meta$status <- "partial"
      meta$error <- paste("Failed to download WorldClim BIO:", paste(result$failed, collapse = ", "))
      log_fun("Partial failure: ", length(result$failed), " layers failed")
      cleanup_on_failure()
    } else {
      progress_fun(90, "WorldClim download complete")
    }
  } else if (download_type == "chelsa") {
    biovars <- config$biovars
    if (is.character(biovars)) biovars <- as.integer(unlist(strsplit(biovars, ",")))
    chelsa_dir <- sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir)
    progress_fun(10, "Downloading CHELSA v2.1 BIO layers")
    log_fun("Requested BIO variables: ", paste(biovars, collapse = ", "))
    source(file.path(app_dir, "R", "covariates", "covariates_climate.R"), local = TRUE)
    result <- download_chelsa_bio(chelsa_dir = chelsa_dir, selected_biovars = biovars, log_fun = log_fun, progress_fun = progress_fun)
    created_files <- result$downloaded %||% character()
    if (length(result$failed) > 0) {
      meta$failed_vars <- result$failed
      meta$status <- "partial"
      meta$error <- paste("Failed to download CHELSA BIO:", paste(result$failed, collapse = ", "))
      log_fun("Partial failure: ", length(result$failed), " layers failed")
      cleanup_on_failure()
    } else {
      progress_fun(90, "CHELSA download complete")
    }
  } else {
    stop("Unknown download type: ", download_type, call. = FALSE)
  }

  progress_fun(95, "Finalizing persisted climate cache")
  if (is.null(meta$status) || meta$status == "running") {
    meta$status <- "completed"
  }
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  write_meta(meta)
  if (identical(meta$status, "partial")) {
    progress_fun(99, "Download finished with missing layers")
  } else {
    progress_fun(100, "Complete")
  }
}, error = function(e) {
  msg <- conditionMessage(e)
  if (identical(msg, "CANCELLED")) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    write_meta(meta)
    log_fun("Download cancelled by user")
    quit(save = "no", status = 0)
  }
  cleanup_on_failure()
  network_patterns <- c("ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "EPIPE")
  http_4xx_pattern <- "HTTP/[45][0-9][0-9]|curl.*error|connection.*fail|timeout"
  http_5xx_pattern <- "HTTP 5[0-9][0-9]|Service Unavailable|Gateway Timeout"
  is_network <- any(vapply(network_patterns, function(p) grepl(p, msg, ignore.case = TRUE), logical(1)))
  is_http_error <- grepl(http_4xx_pattern, msg, ignore.case = TRUE) || grepl(http_5xx_pattern, msg, ignore.case = TRUE)
  meta$error_category <- if (is_network) "network" else if (is_http_error) "http_error" else "unknown"
  meta$status <- "failed"
  meta$error <- msg
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  progress_fun(0, paste0("Failed: ", msg))
  write_meta(meta)
  quit(save = "no", status = 1)
})
