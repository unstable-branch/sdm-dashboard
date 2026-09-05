handle_future_scenarios <- function(res, app_dir) {
  base_dir <- sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  if (!dir.exists(base_dir)) {
    return(list(available_scenarios = list(), message = paste("Directory not found:", base_dir)))
  }

  available <- list()
  subdirs <- list.dirs(base_dir, recursive = FALSE, full.names = FALSE)
  for (sd_name in subdirs) {
    sd <- file.path(base_dir, sd_name)
    tif_files <- list.files(sd, pattern = "\\.tif$", full.names = TRUE)
    if (length(tif_files) == 0) next

    is_averaged <- startsWith(sd_name, "averaged_")
    if (is_averaged) {
      parts <- strsplit(sub("^averaged_", "", sd_name), "_")[[1]]
      if (length(parts) < 4) next
      period <- parts[length(parts)]
      ssp_raw <- parts[length(parts) - 1]
      ssp <- if (grepl("-", ssp_raw)) ssp_raw else paste0("SSP", substr(ssp_raw, 1, 1), "-", substr(ssp_raw, 2, 3))
      gcm <- paste(parts[1:(length(parts) - 2)], collapse = "_")
      gcm <- paste0("Averaged (", gcm, ")")
    } else {
      parts <- strsplit(sd_name, "_")[[1]]
      if (length(parts) < 3) next
      period <- parts[length(parts)]
      ssp_raw <- parts[length(parts) - 1]
      ssp <- if (grepl("-", ssp_raw)) ssp_raw else paste0("SSP", substr(ssp_raw, 1, 1), "-", substr(ssp_raw, 2, 3))
      gcm <- paste(parts[1:(length(parts) - 2)], collapse = "_")
    }

    available <- c(available, list(list(
      gcm = gcm,
      ssp = ssp,
      period = period,
      path = sd,
      file_count = length(tif_files),
      files = tif_files
    )))
  }

  list(available_scenarios = available, base_directory = base_dir)
}

handle_climate_download <- function(req, app_dir) {
  body <- req$postBody
  if (is.null(body)) body <- list()
  if (is.character(body)) body <- jsonlite::fromJSON(body, simplifyVector = FALSE)

  download_type <- body$type %||% "cmip6"
  job_id <- paste0("climate_", format(Sys.time(), "%Y%m%d_%H%M%S"), "_", paste(sample(letters, 6), collapse = ""))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"
  job_meta <- list(
    id = job_id,
    type = download_type,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    completed_at = NULL,
    error = NULL,
    user_id = user_id,
    config = body
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  # Pre-flight: if every requested layer for worldclim/chelsa is already on disk
  # and verified, skip the callr::r_bg spawn entirely. Returns synchronously with
  # cached = TRUE so the frontend's "Download N missing" button no longer
  # appears to "re-download" files that already exist.
  cached_preflight <- tryCatch(preflight_climate_download(body, app_dir),
                               error = function(e) NULL)
  if (isTRUE(cached_preflight$cached)) {
    job_meta$status <- "completed"
    job_meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    job_meta$cached <- TRUE
    sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")
    return(list(
      job_id  = job_id,
      status  = "completed",
      cached  = TRUE,
      message = "All requested climate layers were already present; no download performed"
    ))
  }

  script_path <- file.path(app_dir, "plumber", "R", "climate_download.R")
  if (!file.exists(script_path)) {
    stop("Climate download script not found at: ", script_path, call. = FALSE)
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir), stdout = file.path(job_dir, "stdout.log"), stderr = file.path(job_dir, "stderr.log"),
  r_limit_memory = sdm_vsize_to_bytes())
  sdm_process_registry[[job_id]] <- list(proc = proc, device = "cpu")
  job_meta$process_pid <- proc$get_pid()
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  list(
    job_id = job_id,
    status = "running",
    message = "Climate download started in background"
  )
}

handle_climate_status <- function(res, job_id, app_dir) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Download job not found"))
  }

  meta <- sdm_read_meta_json(meta_file)
  if (is.null(meta)) { res$status <- 503L; return(list(error = "meta.json is unreadable; retry shortly")) }

  if (identical(meta$status, "running")) {
    entry <- sdm_process_registry[[basename(job_id)]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({ ps_info <- tools::ps(); process_alive <- pid %in% ps_info$PID }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
    }
  }

  if (identical(meta$status, "running") && sdm_redis_cancel_check(basename(job_id))) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[basename(job_id)]] <- NULL
  }

  nullify <- function(x) {
    if (is.null(x)) return(NULL)
    if (is.list(x) && length(x) == 0) return(NULL)
    if (length(x) == 1 && is.na(x)) return(NULL)
    x
  }

  redis_progress <- sdm_redis_progress_get(basename(job_id), 50)
  if (!is.null(redis_progress) && length(redis_progress) > 0) {
    progress_lines <- redis_progress
  } else {
    progress_lines <- character(0)
    if (file.exists(progress_file)) {
      progress_lines <- tail(readLines(progress_file, warn = FALSE), 50)
    }
  }

  list(
    id = meta$id,
    type = meta$type,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = nullify(meta$completed_at) %||% NA,
    error = nullify(meta$error) %||% NA,
    error_category = nullify(meta$error_category) %||% NA,
    failed_vars = nullify(meta$failed_vars) %||% NA,
    config = nullify(meta$config) %||% NA,
    progress_log = progress_lines
  )
}

handle_climate_scenarios <- function(res, app_dir) {
  future_dir <- sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  current_dir <- sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
  chelsa_dir <- sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir)

  scenarios <- list()

  if (dir.exists(future_dir)) {
    subdirs <- list.dirs(future_dir, recursive = FALSE, full.names = FALSE)
    for (sd_name in subdirs) {
      sd <- file.path(future_dir, sd_name)
      tif_files <- list.files(sd, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
      total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
      is_averaged <- startsWith(sd_name, "averaged_")

      gcm <- ""
      ssp <- ""
      period <- ""
      if (is_averaged) {
        parts <- strsplit(sd_name, "_")[[1]]
        if (length(parts) >= 4) {
          gcm <- paste(parts[2:(length(parts) - 2)], collapse = "_")
          ssp_code <- parts[length(parts) - 1]
          ssp <- paste0("SSP", substr(ssp_code, 1, 1), "-", substr(ssp_code, 2, 3))
          period <- parts[length(parts)]
        }
      } else {
        parts <- strsplit(sd_name, "_")[[1]]
        if (length(parts) >= 3) {
          period <- parts[length(parts)]
          ssp_raw <- parts[length(parts) - 1]
          ssp <- if (grepl("-", ssp_raw)) ssp_raw else paste0("SSP", substr(ssp_raw, 1, 1), "-", substr(ssp_raw, 2, 3))
          gcm <- paste(parts[1:(length(parts) - 2)], collapse = "_")
        }
      }

      scenarios <- c(scenarios, list(list(
        id = sd_name,
        type = "future",
        gcm = gcm,
        ssp = ssp,
        period = period,
        file_count = length(tif_files),
        size_bytes = total_size,
        is_averaged = is_averaged
      )))
    }
  }

  if (dir.exists(current_dir)) {
    tif_files <- list.files(current_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
    scenarios <- c(scenarios, list(list(
      id = "worldclim_current",
      type = "current",
      source = "worldclim",
      file_count = length(tif_files),
      size_bytes = total_size
    )))
  }

  if (dir.exists(chelsa_dir)) {
    tif_files <- list.files(chelsa_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
    scenarios <- c(scenarios, list(list(
      id = "chelsa_current",
      type = "current",
      source = "chelsa",
      file_count = length(tif_files),
      size_bytes = total_size
    )))
  }

  list(scenarios = scenarios)
}

handle_climate_delete <- function(res, scenario_id, app_dir) {
  future_dir <- sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  current_dir <- sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
  chelsa_dir <- sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir)

  target_dir <- NULL
  if (scenario_id == "worldclim_current") {
    target_dir <- current_dir
  } else if (scenario_id == "chelsa_current") {
    target_dir <- chelsa_dir
  } else {
    target_dir <- file.path(future_dir, basename(scenario_id))
  }

  if (is.null(target_dir) || !dir.exists(target_dir)) {
    res$status <- 404L; return(list(error = "Scenario not found"))
  }

  unlink(target_dir, recursive = TRUE, force = TRUE)

  list(ok = TRUE, message = paste("Scenario deleted:", scenario_id))
}

handle_climate_cancel <- function(req, job_id, app_dir) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- sdm_read_meta_json(meta_file)
  if (is.null(meta)) { res$status <- 503L; return(list(error = "meta.json is unreadable; retry shortly")) }
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this download"))
      }
    }
  }

  sdm_redis_cancel_set(basename(job_id))

  entry <- sdm_process_registry[[basename(job_id)]]
  proc <- sdm_registry_proc(entry)
  killed <- FALSE
  if (!is.null(proc) && inherits(proc, "process") && proc$is_alive()) {
    proc$kill()
    killed <- TRUE
    for (i in seq_len(30)) {
      if (!proc$is_alive()) break
      Sys.sleep(0.1)
    }
    if (proc$is_alive()) {
      pid <- proc$get_pid()
      tryCatch({
        if (file.exists("/proc") && !is.na(suppressWarnings(as.numeric(pid)))) {
          cmdline <- tryCatch(readLines(file.path("/proc", pid, "cmdline"), warn = FALSE), error = function(e) "")
          if (length(cmdline) == 0 || identical(cmdline, "")) stop("PID not found")
        }
        tools::pskill(pid, signal = 9)
      }, error = function(e) NULL)
    }
    rm(list = basename(job_id), envir = sdm_process_registry)
  }

  if (file.exists(meta_file)) {
    meta <- sdm_read_meta_json(meta_file)
  if (is.null(meta)) { res$status <- 503L; return(list(error = "meta.json is unreadable; retry shortly")) }
    if (!is.null(meta$status) && meta$status %in% c("completed", "failed", "cancelled")) {
      return(list(ok = TRUE, message = "Download already terminated"))
    }
    if (!killed && !is.null(meta$process_pid)) {
      pid <- meta$process_pid
      tryCatch({
        if (file.exists("/proc") && !is.na(suppressWarnings(as.numeric(pid)))) {
          cmdline <- tryCatch(readLines(file.path("/proc", pid, "cmdline"), warn = FALSE), error = function(e) "")
          if (length(cmdline) == 0 || identical(cmdline, "")) stop("PID not found")
        }
        tools::pskill(pid, signal = 9)
        killed <- TRUE
      }, error = function(e) NULL)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
  }

  list(ok = TRUE, message = if (killed) "Download cancelled and process terminated" else "Download cancelled")
}

handle_climate_check <- function(res, app_dir, source = "worldclim", resolution = "10", biovars = "", gcm = "", ssp = "", period = "") {
  tryCatch({
    if (length(biovars) > 1) biovars <- paste(biovars, collapse = ",")
    requested <- as.integer(unlist(strsplit(as.character(biovars), ",")))
    requested <- unique(requested[!is.na(requested)])

    if (!exists("match_worldclim_biovars", inherits = TRUE)) {
      source_local(file.path(app_dir, "R", "covariates", "match_climate_layers.R"), local = TRUE)
    }
    if (!exists("validate_geotiff", inherits = TRUE) && file.exists(file.path(app_dir, "R", "covariates", "covariates_climate.R"))) {
      source_local(file.path(app_dir, "R", "covariates", "covariates_climate.R"), local = TRUE)
    }
    if (!exists("read_cache_manifest", inherits = TRUE) &&
        file.exists(file.path(app_dir, "R", "covariates", "climate_cache_manifest.R"))) {
      source_local(file.path(app_dir, "R", "covariates", "climate_cache_manifest.R"), local = TRUE)
    }

    existing_nums <- integer(0)
    base_dir <- NULL

    if (source == "worldclim") {
      res_label <- sdm_worldclim_res_label(resolution)
      base_dir <- sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
      all_tifs <- if (dir.exists(base_dir)) list.files(base_dir, pattern = "\\.tif$",
                                                      full.names = TRUE, recursive = TRUE) else character()
      manifest_ok <- if (file.exists(file.path(app_dir, "R", "covariates", "climate_cache_manifest.R"))) {
        tryCatch(check_manifest_for_biovars(base_dir, "worldclim", requested, names_fn = function(bv) {
          paste0("wc2.1_", res_label, "_bio_", bv, ".tif")
        }), error = function(e) NULL)
      } else NULL
      matched_worldclim <- match_worldclim_biovars(all_tifs, requested, res_label)
      existing_nums <- matched_worldclim$biovars
      if (!is.null(manifest_ok)) {
        existing_nums <- intersect(manifest_ok, existing_nums)
      }
    } else if (source == "chelsa") {
      base_dir <- sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir)
      all_tifs <- if (dir.exists(base_dir)) list.files(base_dir, pattern = "\\.tif$",
                                                      full.names = TRUE, recursive = TRUE) else character()
      existing_nums <- match_chelsa_biovars(all_tifs, requested)$biovars
    } else if (source == "cmip6") {
      if (nzchar(gcm) && nzchar(ssp) && nzchar(period)) {
        if (grepl("(\\.\\./|\\.\\.\\\\|/)", paste(gcm, ssp, period))) {
          stop("Invalid climate path parameters", call. = FALSE)
        }
        base_dir <- file.path(sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir),
                              paste0(gcm, "_", ssp, "_", period))
        all_tifs <- if (dir.exists(base_dir)) list.files(base_dir, pattern = "\\.tif$",
                                                         full.names = TRUE, recursive = TRUE) else character()
        existing_nums <- match_cmip6_biovars(all_tifs, requested)$biovars
      }
    }

    available <- intersect(requested, existing_nums)
    missing   <- setdiff(requested, existing_nums)
    perm_issues <- tryCatch(audit_climate_dir_permissions(app_dir),
                           error = function(e) list())

    list(
      source            = source,
      res               = resolution,
      available         = as.list(available),
      missing           = as.list(missing),
      permission_issues = perm_issues
    )
  }, error = function(e) {
    requested_safe <- if (exists("requested", inherits = FALSE)) requested else integer(0)
    list(
      source            = source,
      res               = resolution,
      available         = as.list(integer(0)),
      missing           = as.list(requested_safe),
      permission_issues = list()
    )
  })
}

# Pre-flight check: returns list(cached = TRUE) if every requested layer is
# already on disk and verifies as a valid GeoTIFF. Otherwise NULL.
preflight_climate_download <- function(body, app_dir) {
  type <- tolower(as.character(body$type %||% "cmip6"))
  if (!type %in% c("worldclim", "chelsa")) return(NULL)

  if (!exists("match_worldclim_biovars", inherits = TRUE)) {
    source_local(file.path(app_dir, "R", "covariates", "match_climate_layers.R"), local = TRUE)
  }
  if (!exists("validate_geotiff", inherits = TRUE) && file.exists(file.path(app_dir, "R", "covariates", "covariates_climate.R"))) {
    source_local(file.path(app_dir, "R", "covariates", "covariates_climate.R"), local = TRUE)
  }

  res_char <- as.character(body$res %||% "10")
  biovars <- as.integer(unlist(strsplit(as.character(body$biovars %||% ""), ",")))
  biovars <- biovars[!is.na(biovars)]
  if (length(biovars) == 0) return(NULL)

  if (type == "worldclim") {
    base_dir <- sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
    if (!dir.exists(base_dir)) return(NULL)
    tifs <- list.files(base_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    res_label <- sdm_worldclim_res_label(res_char)
    found <- match_worldclim_biovars(tifs, biovars, res_label)$biovars
    if (length(found) == length(biovars)) return(list(cached = TRUE, type = type))
    return(NULL)
  }
  if (type == "chelsa") {
    base_dir <- sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir)
    if (!dir.exists(base_dir)) return(NULL)
    tifs <- list.files(base_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    found <- match_chelsa_biovars(tifs, biovars)$biovars
    if (length(found) == length(biovars)) return(list(cached = TRUE, type = type))
    return(NULL)
  }
  NULL
}

# Audit each known climate directory for unreadable files (often caused by
# bind-mount uid mismatches). Returns a list of issue dicts suitable for JSON.
audit_climate_dir_permissions <- function(app_dir) {
  out <- list()
  dirs <- c(
    worldclim = sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir),
    chelsa    = sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir),
    future    = sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  )
  for (nm in names(dirs)) {
    d <- dirs[[nm]]
    if (!dir.exists(d)) next
    fts <- list.files(d, pattern = "\\.tif$", recursive = TRUE, full.names = TRUE)
    if (length(fts) == 0) next
    sample <- fts[1]
    read_test <- tryCatch({
      con <- file(sample, "rb")
      on.exit(close(con), add = TRUE)
      bytes <- readBin(con, "raw", n = 4)
      isTRUE(length(bytes) >= 4)
    }, error = function(e) FALSE, warning = function(w) FALSE)
    if (!isTRUE(read_test)) {
      out[[length(out) + 1L]] <- list(
        dir         = d,
        sample_file = sample,
        reason      = "unreadable"
      )
      next
    }
  }
  out
}

