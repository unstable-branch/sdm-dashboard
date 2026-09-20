SDM_CLIMATE_COLLECTION_MANIFEST_VERSION <- 1L

# The API registers this artifact by its server-generated path, then resolves
# every member through the same exact roots. Keep this mapping deliberately
# narrow: climate data is not allowed to inherit a broad project/data root.
sdm_climate_asset_roots <- function(app_dir) {
  list(
    worldclim = sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir),
    chelsa = sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir),
    future_worldclim = sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  )
}

sdm_climate_path_is_symlink <- function(path) {
  path <- path.expand(as.character(path)[1L])
  if (!grepl("^/", path)) path <- file.path(getwd(), path)
  parts <- strsplit(path, "/", fixed = TRUE)[[1L]]
  current <- if (startsWith(path, "/")) "/" else ""
  for (part in parts[nzchar(parts)]) {
    current <- file.path(current, part)
    link <- tryCatch(Sys.readlink(current), error = function(e) "")
    if (length(link) > 0L && nzchar(link[1L])) return(TRUE)
  }
  FALSE
}

sdm_climate_sha256 <- function(path) {
  if (!requireNamespace("digest", quietly = TRUE)) {
    stop("The digest package is required to publish climate collection manifests", call. = FALSE)
  }
  hash <- digest::digest(file = path, algo = "sha256")
  if (!is.character(hash) || length(hash) != 1L || !grepl("^[0-9a-f]{64}$", hash, ignore.case = TRUE)) {
    stop("Could not compute a SHA-256 identity for climate output", call. = FALSE)
  }
  tolower(hash)
}

sdm_climate_relative_locator <- function(path, roots) {
  path <- normalizePath(path, winslash = "/", mustWork = FALSE)
  matches <- vapply(names(roots), function(root_name) {
    root <- normalizePath(roots[[root_name]], winslash = "/", mustWork = FALSE)
    identical(path, root) || startsWith(path, paste0(root, "/"))
  }, logical(1))
  if (!any(matches)) return(NULL)
  candidates <- names(roots)[matches]
  root_lengths <- vapply(roots[candidates], function(root) nchar(normalizePath(root, winslash = "/", mustWork = FALSE)), integer(1))
  root_name <- candidates[[which.max(root_lengths)]]
  root <- normalizePath(roots[[root_name]], winslash = "/", mustWork = FALSE)
  relative <- substring(path, nchar(root) + 2L)
  if (!nzchar(relative) || grepl("(^|/)\\.\\.?(/|$)|^/", relative, perl = TRUE)) return(NULL)
  paste(root_name, relative, sep = "/")
}

sdm_climate_valid_output <- function(path) {
  info <- tryCatch(file.info(path), error = function(e) NULL)
  if (is.null(info) || nrow(info) != 1L || !isTRUE(info$isdir == FALSE) ||
      is.na(info$size) || info$size <= 0 || sdm_climate_path_is_symlink(path)) return(FALSE)
  if (exists("validate_geotiff", mode = "function", inherits = TRUE)) {
    return(isTRUE(tryCatch(validate_geotiff(path), error = function(e) FALSE)))
  }
  tryCatch({
    con <- file(path, "rb")
    on.exit(close(con), add = TRUE)
    magic <- readBin(con, "raw", n = 4L)
    length(magic) == 4L &&
      ((identical(as.integer(magic), c(73L, 73L, 42L, 0L))) ||
       (identical(as.integer(magic), c(77L, 77L, 0L, 42L))))
  }, error = function(e) FALSE)
}

sdm_climate_safe_metadata <- function(key, value) {
  is.character(key) && length(key) == 1L && nzchar(key) && nchar(key) <= 128L &&
    grepl("^[A-Za-z][A-Za-z0-9_.-]*$", key) &&
    !grepl("path|file|dir|secret|token|password|credential|auth", key, ignore.case = TRUE) &&
    length(value) == 1L && !is.na(value) &&
    (is.character(value) || is.logical(value) || (is.numeric(value) && is.finite(value))) &&
    (!is.character(value) || (nchar(value) <= 256L && !grepl("[/\\\\]|[[:cntrl:]]", value)))
}

sdm_climate_member_metadata <- function(path, metadata = list()) {
  name <- basename(path)
  match <- regexec("bio[c]?_?0*([0-9]{1,2})", name, ignore.case = TRUE, perl = TRUE)
  pieces <- regmatches(name, match)[[1L]]
  variable <- if (length(pieces) > 1L) paste0("bio", as.integer(pieces[[2L]])) else "climate"
  base <- list(variable = variable)
  for (key in names(metadata)) {
    value <- metadata[[key]]
    if (!sdm_climate_safe_metadata(key, value)) next
    base[[key]] <- value
  }
  base
}

sdm_climate_manifest_members <- function(files, app_dir, metadata = list(), roots = sdm_climate_asset_roots(app_dir)) {
  # Do not normalize before validation: normalizePath follows symlinks and
  # would erase the very redirect that the producer must reject.
  files <- unique(path.expand(as.character(files)))
  files <- sort(files)
  if (length(files) == 0L) stop("Climate collection has no output members", call. = FALSE)
  members <- lapply(files, function(path) {
    if (!sdm_climate_valid_output(path)) stop("Climate output is missing, invalid, or unsafe", call. = FALSE)
    locator <- sdm_climate_relative_locator(path, roots)
    if (is.null(locator)) stop("Climate output is outside configured climate roots", call. = FALSE)
    list(
      locator = locator,
      sha256 = sdm_climate_sha256(path),
      size = as.numeric(file.info(path)$size),
      metadata = sdm_climate_member_metadata(path, metadata)
    )
  })
  locators <- vapply(members, function(member) member$locator, character(1))
  roots_used <- sub("/.*$", "", locators)
  if (length(unique(roots_used)) != 1L) {
    stop("Climate collection members must share one configured climate root", call. = FALSE)
  }
  members
}

sdm_publish_climate_collection_manifest <- function(files, app_dir, metadata = list(), roots = sdm_climate_asset_roots(app_dir)) {
  members <- sdm_climate_manifest_members(files, app_dir, metadata = metadata, roots = roots)
  locators <- vapply(members, function(member) member$locator, character(1))
  root_name <- sub("/.*$", "", locators[[1L]])
  root <- normalizePath(roots[[root_name]], winslash = "/", mustWork = FALSE)
  if (!dir.exists(root)) stop("Climate manifest root is unavailable", call. = FALSE)
  safe_metadata <- list()
  for (key in names(metadata)) {
    value <- metadata[[key]]
    if (sdm_climate_safe_metadata(key, value)) safe_metadata[[key]] <- value
  }
  payload <- list(
    version = SDM_CLIMATE_COLLECTION_MANIFEST_VERSION,
    metadata = safe_metadata,
    members = members
  )
  encoded <- jsonlite::toJSON(payload, auto_unbox = TRUE, null = "null", pretty = FALSE)
  if (!requireNamespace("digest", quietly = TRUE)) stop("The digest package is required to publish climate collection manifests", call. = FALSE)
  identity <- tolower(digest::digest(encoded, algo = "sha256", serialize = FALSE))
  manifest_path <- file.path(root, paste0("climate_collection_v1_", identity, ".json"))
  if (file.exists(manifest_path)) {
    existing <- tryCatch(paste(readLines(manifest_path, warn = FALSE), collapse = "\n"), error = function(e) NULL)
    if (is.null(existing) || !isTRUE(existing == encoded)) stop("Immutable climate manifest identity collision", call. = FALSE)
    return(manifest_path)
  }
  temporary <- tempfile(pattern = ".climate-collection-", tmpdir = root, fileext = ".tmp")
  on.exit(if (file.exists(temporary)) unlink(temporary, force = TRUE), add = TRUE)
  connection <- file(temporary, open = "wb")
  tryCatch(writeBin(charToRaw(enc2utf8(encoded)), connection), finally = close(connection))
  if (!file.rename(temporary, manifest_path)) {
    existing <- tryCatch(paste(readLines(manifest_path, warn = FALSE), collapse = "\n"), error = function(e) NULL)
    if (is.null(existing) || !isTRUE(existing == encoded)) stop("Could not atomically publish climate manifest", call. = FALSE)
  }
  if (!file.exists(manifest_path)) stop("Climate manifest publication was not verified", call. = FALSE)
  manifest_path
}

sdm_climate_verified_files <- function(directory) {
  if (is.null(directory) || !dir.exists(directory)) return(character())
  files <- list.files(directory, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE, ignore.case = TRUE)
  files[vapply(files, sdm_climate_valid_output, logical(1))]
}

sdm_publish_climate_directory_manifest <- function(directory, app_dir, source, metadata = list(), roots = sdm_climate_asset_roots(app_dir)) {
  files <- sdm_climate_verified_files(directory)
  if (length(files) == 0L) stop("Climate output is incomplete or has no verified members", call. = FALSE)
  sdm_publish_climate_collection_manifest(files, app_dir, metadata = c(list(source = source), metadata), roots = roots)
}

handle_future_scenarios <- function(res, app_dir) {
  base_dir <- sdm_resolve_project_path(sdm_default_future_worldclim_dir, app_dir)
  if (!dir.exists(base_dir)) {
    return(list(available_scenarios = list(), message = "No future climate scenarios are available"))
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

    manifest_path <- tryCatch(
      sdm_publish_climate_directory_manifest(
        sd, app_dir, source = "cmip6",
        metadata = list(gcm = gcm, ssp = ssp, period = period, is_averaged = is_averaged)
      ),
      error = function(e) NULL
    )
    if (is.null(manifest_path)) next
    available <- c(available, list(list(
      gcm = gcm,
      ssp = ssp,
      period = period,
      file_count = length(tif_files),
      manifest_path = manifest_path,
      status = "completed",
      is_averaged = is_averaged
    )))
  }

  list(available_scenarios = available)
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
  if (!is.null(cached_preflight$error)) {
    return(list(error = cached_preflight$error, message = cached_preflight$message %||% "Climate preflight failed"))
  }
  if (isTRUE(cached_preflight$cached)) {
    cached_manifest <- tryCatch({
      cached_dir <- if (identical(tolower(as.character(download_type)), "worldclim")) {
        sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
      } else {
        sdm_resolve_project_path(sdm_default_chelsa_dir, app_dir)
      }
      sdm_publish_climate_directory_manifest(
        cached_dir, app_dir, source = tolower(as.character(download_type)),
        metadata = list(resolution = as.character(body$res %||% if (identical(tolower(as.character(download_type)), "chelsa")) "0.5" else "10"))
      )
    }, error = function(e) NULL)
    if (is.null(cached_manifest)) {
      job_meta$status <- "failed"
      job_meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      job_meta$error <- "Cached climate output could not be verified and published"
      sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")
      return(list(job_id = job_id, status = "failed", error = job_meta$error))
    }
    job_meta$status <- "completed"
    job_meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    job_meta$cached <- TRUE
    job_meta$manifest_path <- cached_manifest
    sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")
    return(list(
      job_id  = job_id,
      status  = "completed",
      cached  = TRUE,
      manifest_path = cached_manifest,
      message = "All requested climate layers were already present; no download performed"
    ))
  }

  script_path <- file.path(app_dir, "plumber", "R", "climate_download.R")
  if (!file.exists(script_path)) {
    stop("Climate download script not found at: ", script_path, call. = FALSE)
  }

  spawn_error <- NULL
  proc <- tryCatch(
    sdm_spawn_background(
      function(script, job_dir, app_dir) {
        source(script, local = TRUE)
      },
      args = list(script_path, job_dir, app_dir),
      stdout = file.path(job_dir, "stdout.log"),
      stderr = file.path(job_dir, "stderr.log")
    ),
    error = function(e) {
      spawn_error <<- conditionMessage(e)
      NULL
    }
  )
  if (is.null(proc)) {
    job_meta$status <- "failed"
    job_meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    job_meta$error <- paste0("Failed to start climate download: ", spawn_error)
    sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")
    return(list(
      job_id  = job_id,
      status  = "failed",
      error   = job_meta$error
    ))
  }
  sdm_registry_set(job_id, proc, device = "cpu")
  job_meta$process_pid <- sdm_process_pid(proc)
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  list(
    job_id = job_id,
    status = "running",
    message = "Climate download started in background"
  )
}

handle_climate_status <- function(req, res, job_id, app_dir) {
  # The loader validates the principal, resource, owner, and metadata before
  # this handler parses or exposes any metadata-derived status.
  auth <- sdm_load_authorized_job(req, res, job_id, app_dir)
  if (!isTRUE(auth$ok)) return(list(error = auth$error))
  job_dir <- auth$job_dir
  meta_file <- auth$meta_file
  progress_file <- file.path(job_dir, "progress.log")
  meta <- auth$meta

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
    manifest_path = if (identical(meta$status, "completed")) nullify(meta$manifest_path) %||% NA else NA,
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
        is_averaged = is_averaged,
        manifest_path = tryCatch(
          sdm_publish_climate_directory_manifest(
            sd, app_dir, source = "cmip6",
            metadata = list(gcm = gcm, ssp = ssp, period = period, is_averaged = is_averaged)
          ),
          error = function(e) NULL
        )
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
      resolution = as.numeric(sdm_default_worldclim_res),
      file_count = length(tif_files),
      size_bytes = total_size,
      status = "completed",
      manifest_path = tryCatch(
        sdm_publish_climate_directory_manifest(
          current_dir, app_dir, source = "worldclim",
          metadata = list(resolution = as.character(sdm_default_worldclim_res))
        ),
        error = function(e) NULL
      )
    )))
  }

  if (dir.exists(chelsa_dir)) {
    tif_files <- list.files(chelsa_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
    scenarios <- c(scenarios, list(list(
      id = "chelsa_current",
      type = "current",
      source = "chelsa",
      resolution = 0.5,
      file_count = length(tif_files),
      size_bytes = total_size,
      status = "completed",
      manifest_path = tryCatch(
        sdm_publish_climate_directory_manifest(
          chelsa_dir, app_dir, source = "chelsa",
          metadata = list(resolution = "0.5")
        ),
        error = function(e) NULL
      )
    )))
  }

  scenarios <- Filter(function(scenario) {
    is.list(scenario) && is.character(scenario$manifest_path) && length(scenario$manifest_path) == 1L
  }, scenarios)
  list(scenarios = scenarios)
}

handle_climate_cancel <- function(req, res, job_id, app_dir) {
  auth <- sdm_load_authorized_job(req, res, job_id, app_dir)
  if (!isTRUE(auth$ok)) return(list(error = auth$error))
  job_dir <- auth$job_dir
  meta_file <- auth$meta_file
  meta <- auth$meta

  # Cancellation side effects occur only after resource authorization and metadata validation.
  sdm_redis_cancel_set(basename(job_id))

  cancel_result <- sdm_cancel_pid_first(basename(job_id), meta_file)
  killed <- cancel_result$killed
  if (cancel_result$from_registry) {
    sdm_registry_remove(basename(job_id), "cancelled")
  }

  if (file.exists(meta_file)) {
    meta <- sdm_read_meta_json(meta_file)
    if (is.null(meta)) { if (!is.null(res)) res$status <- 503L; return(list(error = "meta.json is unreadable; retry shortly")) }
    if (!is.null(meta$status) && meta$status %in% c("completed", "failed", "cancelled")) {
      return(list(ok = TRUE, message = "Download already terminated"))
    }
    if (!killed) {
      killed <- sdm_kill_pid(meta$process_pid)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
  }

  list(ok = TRUE, message = if (killed) "Download cancelled and process terminated" else "Download cancelled")
}

handle_climate_check <- function(res, app_dir, source = "worldclim", resolution = "10", biovars = "", gcm = "", ssp = "", period = "") {
  # Hoisted so the error handler below can always report the request; the
  # handler's frame does NOT see bindings made inside the tryCatch body.
  requested <- integer(0)
  tryCatch({
    if (length(biovars) > 1) biovars <- paste(biovars, collapse = ",")
    requested <- as.integer(unlist(strsplit(as.character(biovars), ",")))
    requested <- unique(requested[!is.na(requested)])

    # Matcher/manifest helpers are loaded at startup by R/engine_load.R (or
    # R/load.R) and by tests/testthat/helper-load.R. Fail loudly if absent —
    # a previous runtime-sourcing attempt via a non-existent source_local()
    # helper crashed here and the silent fallback reported empty results.
    if (!exists("match_worldclim_biovars", inherits = TRUE)) {
      stop("match_worldclim_biovars not loaded: R/covariates/match_climate_layers.R is missing from the module loader", call. = FALSE)
    }
    if (!exists("check_manifest_for_biovars", inherits = TRUE)) {
      stop("check_manifest_for_biovars not loaded: R/covariates/climate_cache_manifest.R is missing from the module loader", call. = FALSE)
    }

    existing_nums <- integer(0)
    base_dir <- NULL

    if (source == "worldclim") {
      res_label <- sdm_worldclim_res_label(resolution)
      base_dir <- sdm_resolve_project_path(sdm_default_worldclim_dir, app_dir)
      all_tifs <- if (dir.exists(base_dir)) list.files(base_dir, pattern = "\\.tif$",
                                                      full.names = TRUE, recursive = TRUE) else character()
      manifest_ok <- tryCatch(check_manifest_for_biovars(base_dir, "worldclim", requested, names_fn = function(bv) {
        paste0("wc2.1_", res_label, "_bio_", bv, ".tif")
      }), error = function(e) NULL)
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
    message("[climate-check] error: ", conditionMessage(e))
    list(
      source            = source,
      res               = resolution,
      available         = as.list(integer(0)),
      missing           = as.list(requested),
      permission_issues = list()
    )
  })
}

# Pre-flight check: returns list(cached = TRUE) if every requested layer is
# already on disk and verifies as a valid GeoTIFF. Otherwise NULL.
preflight_climate_download <- function(body, app_dir) {
  type <- tolower(as.character(body$type %||% "cmip6"))
  # CMIP6 is handled by the background producer. Only current climate sources
  # have a synchronous cache pre-flight here.
  if (!type %in% c("worldclim", "chelsa")) return(NULL)

  if (!exists("match_worldclim_biovars", inherits = TRUE)) {
    stop("match_worldclim_biovars not loaded: R/covariates/match_climate_layers.R is missing from the module loader", call. = FALSE)
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

