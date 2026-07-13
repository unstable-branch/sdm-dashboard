# WorldClim discovery, download, cropping, and scaling helpers.

# Simple file-based lock for concurrent download protection.
# timeout_sec MUST be >= stale_sec, otherwise a waiter can never reclaim
# a stale lock left behind by a crashed process.
sdm_download_lock <- function(lock_path, timeout_sec = 600, poll_ms = 500, stale_sec = 300) {
  lock_dir <- paste0(lock_path, ".lock")
  lock_info <- file.path(lock_dir, ".lock_info")
  deadline <- Sys.time() + timeout_sec
  while (Sys.time() < deadline) {
    if (dir.create(lock_dir, showWarnings = FALSE)) {
      writeLines(format(Sys.time(), "%Y-%m-%dT%H:%M:%S"), lock_info)
      return(lock_dir)
    }
    # Stale lock detection: check .lock_info first, fall back to dir mtime
    lock_time <- if (file.exists(lock_info)) {
      tryCatch(as.POSIXct(readLines(lock_info, warn = FALSE)[1]), error = function(e) NA)
    } else {
      tryCatch(file.info(lock_dir)$mtime, error = function(e) NA)
    }
    if (!is.na(lock_time) && is.finite(lock_time) &&
        difftime(Sys.time(), lock_time, units = "secs") > stale_sec) {
      unlink(lock_dir, recursive = TRUE)
      next
    }
    Sys.sleep(poll_ms / 1000)
  }
  stop("Download lock timeout after ", timeout_sec, "s for: ", lock_path,
       "\n  A previous download may have crashed. Try removing: ", lock_dir,
       call. = FALSE)
}

sdm_download_unlock <- function(lock_dir) {
  if (!is.null(lock_dir) && dir.exists(lock_dir)) {
    unlink(lock_dir, recursive = TRUE)
  }
}

sdm_worldclim_res_label <- function(res) {
  if (isTRUE(all.equal(as.numeric(res), 0.5))) "30s" else paste0(format(as.numeric(res), scientific = FALSE, trim = TRUE), "m")
}

find_worldclim_files <- function(worldclim_dir, selected_biovars, source = c("worldclim", "chelsa"), res = NULL) {
  source <- match.arg(source)
  if (is.null(worldclim_dir) || length(worldclim_dir) == 0 || !nzchar(worldclim_dir)) {
    return(setNames(rep(NA_character_, length(as.integer(selected_biovars))), as.character(as.integer(selected_biovars))))
  }
  pattern <- if (source == "worldclim" && !is.null(res)) {
    sprintf("wc2\\.1_%s.*\\.tif$", sdm_worldclim_res_label(res))
  } else {
    "\\.tif$"
  }
  files <- if (dir.exists(worldclim_dir)) list.files(worldclim_dir, pattern = pattern, full.names = TRUE, recursive = TRUE) else character()
  selected_biovars <- as.integer(selected_biovars)
  if (length(files) == 0 || length(selected_biovars) == 0) {
    return(setNames(rep(NA_character_, length(selected_biovars)), as.character(selected_biovars)))
  }

  matched <- vapply(selected_biovars, function(bv) {
    if (source == "worldclim") {
      nm1 <- paste0("bio", bv)
      nm2 <- if (bv < 10) paste0("bio0", bv) else paste0("bio", bv)
      pat1 <- paste0("_(", nm1, ")[^0-9]")
      pat2 <- paste0("_(", nm2, ")[^0-9]")
      pat3 <- paste0("bio_", bv, "($|[^0-9])")
      hit <- unique(c(
        files[grepl(pat1, basename(files), ignore.case = TRUE, perl = TRUE)],
        files[grepl(pat2, basename(files), ignore.case = TRUE, perl = TRUE)],
        files[grepl(pat3, basename(files), ignore.case = TRUE, perl = TRUE)]
      ))
    } else {
      if (bv < 10) {
        pattern1 <- sprintf("CHELSA_bio0%d_.*\\.tif$", bv)
        pattern2 <- sprintf("CHELSA_bio%d_.*\\.tif$", bv)
        hit <- files[grepl(pattern1, basename(files), ignore.case = TRUE)]
        if (length(hit) == 0) hit <- files[grepl(pattern2, basename(files), ignore.case = TRUE)]
      } else {
        pattern1 <- sprintf("CHELSA_bio%d_.*\\.tif$", bv)
        hit <- files[grepl(pattern1, basename(files), ignore.case = TRUE)]
      }
    }
    if (length(hit) == 0) {
      NA_character_
    } else if (length(hit) > 1) {
      sizes <- vapply(hit, function(f) as.numeric(file.info(f)$size), numeric(1))
      idx <- which.max(sizes)
      if (length(idx) == 0) NA_character_ else hit[idx]
    } else {
      hit[1]
    }
  }, character(1))
  names(matched) <- as.character(selected_biovars)
  matched
}

check_internet_connectivity <- function(target_url = "https://os.unil.cloud.switch.ch/",
                                         retries = 3, timeout = 10, connect_timeout = 5,
                                         log_fun = NULL) {
  if (!sdm_internet_check_enabled) return(TRUE)
  log <- log_fun %||% function(msg, level = "info") {
    if (tolower(level) %in% c("warn", "error")) message(msg)
  }
  for (attempt in seq_len(retries)) {
    result <- tryCatch({
      handle <- curl::new_handle(timeout = timeout, connecttimeout = connect_timeout)
      resp <- curl::curl_fetch_memory(target_url, handle = handle)
      list(success = TRUE, status = resp$status)
    }, error = function(e) list(success = FALSE, error = conditionMessage(e)))
    if (result$success && result$status >= 200 && result$status < 400) return(TRUE)
    err_detail <- if (!is.null(result$error)) result$error else paste0("HTTP ", result$status)
    log(paste0("[Connectivity] Attempt ", attempt, "/", retries,
               " failed for ", target_url, ": ", err_detail,
               ". Retrying in ", attempt * 5, "s..."), "warn")
    Sys.sleep(attempt * 5)
  }
  log(paste0("[Connectivity] All ", retries, " attempts failed for ", target_url,
             ". Proceeding with download anyway."), "warn")
  TRUE
}

categorize_download_error <- function(error_msg) {
  if (grepl("Could not resolve host|Name or service not known", error_msg)) {
    "DNS resolution failed. Check your network and DNS settings."
  } else if (grepl("Connection refused", error_msg)) {
    "Connection refused. Check firewall or VPN settings."
  } else if (grepl("Timeout was reached|connection timed out", error_msg)) {
    "Connection timed out. Check internet connectivity."
  } else if (grepl("HTTP [45][0-9][0-9]", error_msg)) {
    code <- sub(".*HTTP ([0-9]{3}).*", "\\1", error_msg)
    paste0("Server error (HTTP ", code, "). Try again later.")
  } else {
    paste0("Download failed: ", error_msg)
  }
}

# CHELSA bioclim-plus extra variables (gdd5, gsl, fcf, npp, etc.)
# These are available as separate GeoTIFF downloads from CHELSA v2.1.
chelsa_extra_vars <- c(
  "gdd5"  = "gdd5", # Growing degree days above 5C
  "gdd10" = "gdd10", # Growing degree days above 10C
  "gsl"   = "gsl", # Growing season length
  "fcf"   = "fcf", # Frost change frequency
  "npp"   = "npp", # Net primary productivity
  "scd"   = "scd" # Snow cover days
)

find_chelsa_extra_files <- function(chelsa_dir, selected_extras = names(chelsa_extra_vars)) {
  if (!dir.exists(chelsa_dir)) {
    return(setNames(rep(NA_character_, length(selected_extras)), selected_extras))
  }
  files <- list.files(chelsa_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(files) == 0) {
    return(setNames(rep(NA_character_, length(selected_extras)), selected_extras))
  }

  matched <- vapply(selected_extras, function(var) {
    pattern <- sprintf("CHELSA_%s_.*\\.tif$", var)
    hit <- files[grepl(pattern, basename(files), ignore.case = TRUE)]
    if (length(hit) == 0) NA_character_ else hit[1]
  }, character(1))
  names(matched) <- as.character(selected_extras)
  matched
}

# Configurable CHELSA URL (Fix 1)
get_chelsa_url <- function() {
  getOption("sdm.chelsa.url", sdm_default_chelsa_url)
}

get_chelsa_base_url <- function() {
  "https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/bioclim"
}

get_chelsa_bio_url <- function(bio_num, period = "1981-2010") {
  base <- get_chelsa_url()
  bio_id <- if (bio_num < 10) sprintf("bio0%d", bio_num) else sprintf("bio%d", bio_num)
  file_name <- sprintf("CHELSA_%s_%s_V.2.1.tif", bio_id, period)
  paste0(base, "/", bio_id, "/", period, "/", file_name)
}

get_chelsa_extra_url <- function(var_name, period = "1981-2010") {
  base <- get_chelsa_url()
  file_name <- sprintf("CHELSA_%s_%s_V.2.1.tif", var_name, period)
  paste0(base, "/", var_name, "/", period, "/", file_name)
}

# Configurable CHELSA timeout (Fix 6)
get_chelsa_timeout <- function() {
  as.integer(getOption("sdm.chelsa.timeout", sdm_default_chelsa_timeout))
}

# Configurable CHELSA retry count (Fix 2)
get_chelsa_retries <- function() {
  as.integer(getOption("sdm.chelsa.retries", sdm_default_chelsa_retries))
}

# Configurable geodata cache URL (Fix 11)
get_geodata_cache_url <- function() {
  opts <- getOption("sdm.geodata.cache.url")
  if (nzchar(opts %||% "")) return(opts)
  if (nzchar(sdm_geodata_cache_url)) return(sdm_geodata_cache_url)
  ""
}

# Check if partial file exists and get its size (Fix 12 - resume support)
get_partial_file_size <- function(path) {
  if (file.exists(path)) {
    fi <- file.info(path)
    if (!is.na(fi$size) && fi$size > 0) as.numeric(fi$size) else NA_real_
  } else {
    NA_real_
  }
}

# HTTP HEAD request to get content-length (Fix 12)
get_content_length <- function(url, timeout = 30) {
  tryCatch({
    handle <- curl::new_handle(customrequest = "HEAD", timeout = timeout, connecttimeout = 10)
    response <- curl::curl_fetch_memory(url, handle = handle)
    headers <- response$headers
    if (is.null(headers)) return(NULL)
    header_str <- rawToChar(headers)
    matches <- regmatches(header_str, regexpr("content-length:\\s*(\\d+)", header_str, ignore.case = TRUE))
    if (length(matches) == 0) return(NULL)
    as.numeric(gsub("\\D", "", matches))
  }, error = function(e) NULL)
}

# Improved GeoTIFF validation — checks magic bytes (Fix 3)
# Handles classic TIFF (II*\x00, MM\x00*), BigTIFF (II2B..., MM2B...), and rejects GIF
validate_geotiff <- function(path) {
  if (!file.exists(path)) return(FALSE)
  con <- file(path, "rb")
  bytes <- readBin(con, "raw", n = 8)
  close(con)
  if (length(bytes) < 4) return(FALSE)
  # Classic TIFF little-endian: II*\x00 (0x49 0x49 0x2A 0x00)
  if (identical(bytes[1:4], as.raw(c(0x49, 0x49, 0x2A, 0x00)))) return(TRUE)
  # Classic TIFF big-endian: MM\x00* (0x4D 0x4D 0x00 0x2A)
  if (identical(bytes[1:4], as.raw(c(0x4D, 0x4D, 0x00, 0x2A)))) return(TRUE)
  # BigTIFF little-endian: II2B... (0x49 0x49 0x2B ...)
  if (identical(bytes[1:2], as.raw(c(0x49, 0x49))) && bytes[3] == 0x2B) return(TRUE)
  # BigTIFF big-endian: MM2B... (0x4D 0x4D 0x2B ...)
  if (identical(bytes[1:2], as.raw(c(0x4D, 0x4D))) && bytes[3] == 0x2B) return(TRUE)
  # GIF
  if (identical(bytes[1:3], as.raw(c(0x47, 0x49, 0x46)))) return(FALSE)
  FALSE
}

# Legacy helper — kept for compatibility with any direct callers
is_valid_geotiff <- function(path) {
  validate_geotiff(path)
}

sdm_emit_download_progress <- function(progress_fun = NULL, value = 0, detail = "",
                                       file_index = NULL, file_total = NULL,
                                       bytes_downloaded = NULL, bytes_total = NULL,
                                       cached = FALSE) {
  if (!is.function(progress_fun)) return(invisible(NULL))
  progress_fun(list(
    value = max(0, min(1, as.numeric(value))),
    detail = detail,
    stage = "climate_download",
    file_index = file_index,
    file_total = file_total,
    bytes_downloaded = bytes_downloaded,
    bytes_total = bytes_total,
    cached = isTRUE(cached)
  ))
  invisible(NULL)
}

download_chelsa_file <- function(url, dest, log_fun = NULL, progress_fun = NULL,
                                  file_index = NULL, file_total = NULL) {
  retries <- get_chelsa_retries()
  timeout <- get_chelsa_timeout()
  partial_path <- paste0(dest, ".part")

  check_internet_connectivity("https://os.unil.cloud.switch.ch/", log_fun = log_fun)
  expected_size <- get_content_length(url, timeout = min(timeout, 30))

  for (attempt in seq_len(retries)) {
    if (attempt > 1) {
      backoff <- 2 ^ (attempt - 1)
      log_message(log_fun, "  Retry ", attempt, "/", retries, " after ", backoff, "s...")
      Sys.sleep(backoff)
    }

    partial_size <- get_partial_file_size(partial_path)
    can_resume <- is.finite(partial_size) &&
      (is.null(expected_size) || !is.finite(expected_size) || partial_size < expected_size)
    tmp <- if (can_resume) tempfile(fileext = ".part") else partial_path
    if (!can_resume && file.exists(partial_path)) unlink(partial_path, force = TRUE)
    last_reported_pct <- -1L

    fetch_ok <- tryCatch({
      handle <- curl::new_handle(timeout = timeout, noprogress = FALSE, failonerror = TRUE)
      if (can_resume) {
        log_message(log_fun, "  Resuming from byte ", partial_size, " (expected ", expected_size, ")")
        curl::handle_setheaders(handle, Range = sprintf("bytes=%.0f-", partial_size))
      }
      if (is.function(progress_fun)) {
        curl::handle_setopt(handle, progressfunction = function(down, up) {
          current_raw <- if (!is.null(names(down)) && "current" %in% names(down)) down[["current"]] else down[min(2L, length(down))]
          total_raw <- if (!is.null(names(down)) && "total" %in% names(down)) down[["total"]] else down[1L]
          current <- suppressWarnings(as.numeric(current_raw))
          total <- suppressWarnings(as.numeric(total_raw))
          base <- if (can_resume) partial_size else 0
          current <- if (is.finite(current)) base + current else base
          total <- if (!is.null(expected_size) && is.finite(expected_size)) expected_size else if (is.finite(total) && total > 0) base + total else NA_real_
          pct <- if (is.finite(total) && total > 0) floor(100 * current / total) else last_reported_pct + 1L
          if (pct >= last_reported_pct + 2L || (is.finite(total) && current >= total)) {
            last_reported_pct <<- pct
            file_fraction <- if (is.finite(total) && total > 0) min(1, current / total) else 0
            overall <- if (!is.null(file_index) && !is.null(file_total) && file_total > 0) {
              ((file_index - 1) + file_fraction) / file_total
            } else file_fraction
            sdm_emit_download_progress(
              progress_fun, overall,
              sprintf("Downloading %s (file %d/%d, %s / %s)", basename(dest), file_index %||% 1L,
                      file_total %||% 1L, format(current, big.mark = ",", scientific = FALSE),
                      if (is.finite(total)) format(total, big.mark = ",", scientific = FALSE) else "unknown bytes"),
              file_index, file_total, current, if (is.finite(total)) total else NULL
            )
          }
          TRUE
        })
      }
      resp <- curl::curl_fetch_disk(url, tmp, handle = handle)
      if (can_resume) {
        if (identical(as.integer(resp$status_code), 206L)) {
          if (!file.append(partial_path, tmp)) stop("Could not append resumed CHELSA download")
          unlink(tmp, force = TRUE)
        } else {
          log_message(log_fun, "  Server ignored byte range; replacing partial download")
          sdm_safe_rename(tmp, partial_path)
        }
      }
      size <- get_partial_file_size(partial_path)
      is.finite(size) && size > 1024 && (is.null(expected_size) || size >= expected_size * 0.99)
    }, error = function(e) {
      log_message(log_fun, "  Attempt ", attempt, " error: ", conditionMessage(e))
      if (can_resume && file.exists(tmp)) unlink(tmp, force = TRUE)
      FALSE
    })

    if (fetch_ok && validate_geotiff(partial_path)) {
      sdm_safe_rename(partial_path, dest)
      final_size <- as.numeric(file.info(dest)$size)
      log_message(log_fun, "  Downloaded: ", basename(dest))
      return(list(success = TRUE, bytes = final_size, resumed = can_resume))
    }
    if (fetch_ok) log_message(log_fun, "  Invalid GeoTIFF: ", basename(dest))
  }

  log_message(log_fun, "  All ", retries, " attempts exhausted for: ", basename(dest),
              "; partial data retained at ", partial_path)
  list(success = FALSE, bytes = get_partial_file_size(partial_path), resumed = FALSE)
}

download_chelsa_extras <- function(chelsa_dir, selected_extras = names(chelsa_extra_vars),
                                   log_fun = NULL, n_cores = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for CHELSA downloads. Install with: install.packages('curl')", call. = FALSE)
  }
  ensure_sdm_packages(c("terra", "geodata"), n_cores = n_cores)
  dir.create(chelsa_dir, recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Downloading CHELSA bioclim-plus extra variables to ", chelsa_dir)

  check_internet_connectivity("https://os.unil.cloud.switch.ch/", log_fun = log_fun)
  failed <- character()

  for (var in selected_extras) {
    fname <- sprintf("CHELSA_%s_1981-2010_V.2.1.tif", var)
    dest <- file.path(chelsa_dir, fname)
    if (file.exists(dest)) {
      log_message(log_fun, "CHELSA extra already exists: ", var)
      next
    }
    url <- get_chelsa_extra_url(var)
    download <- download_chelsa_file(url, dest, log_fun)
    if (!isTRUE(download$success)) {
      failed <- c(failed, var)
    }
  }

  list(
    files = find_chelsa_extra_files(chelsa_dir, selected_extras),
    failed = failed
  )
}

download_worldclim_archive <- function(res, worldclim_dir, progress_fun = NULL,
                                        log_fun = NULL, timeout_sec = 600) {
  label <- sdm_worldclim_res_label(res)
  archive_name <- sprintf("wc2.1_%s_bio.zip", label)
  url <- paste0("https://geodata.ucdavis.edu/climate/worldclim/2_1/base/", archive_name)
  archive <- file.path(worldclim_dir, archive_name)
  partial <- paste0(archive, ".part")
  if (file.exists(archive)) {
    valid_archive <- tryCatch(nrow(utils::unzip(archive, list = TRUE)) > 0L, error = function(e) FALSE)
    if (isTRUE(valid_archive)) {
      size <- as.numeric(file.info(archive)$size)
      sdm_emit_download_progress(progress_fun, 0.85,
        sprintf("Using cached WorldClim archive (%s bytes)", format(size, big.mark = ",", scientific = FALSE)),
        1L, 1L, size, size, cached = TRUE)
      return(archive)
    }
    unlink(archive, force = TRUE)
  }
  expected_size <- get_content_length(url, timeout = 30)
  retries <- max(1L, get_chelsa_retries())

  for (attempt in seq_len(retries)) {
    partial_size <- get_partial_file_size(partial)
    can_resume <- is.finite(partial_size) && (is.null(expected_size) || !is.finite(expected_size) || partial_size < expected_size)
    tmp <- if (can_resume) tempfile(fileext = ".part") else partial
    if (!can_resume && file.exists(partial)) unlink(partial, force = TRUE)
    last_pct <- -1L

    ok <- tryCatch({
      handle <- curl::new_handle(timeout = timeout_sec, noprogress = FALSE, failonerror = TRUE)
      if (can_resume) curl::handle_setheaders(handle, Range = sprintf("bytes=%.0f-", partial_size))
      curl::handle_setopt(handle, progressfunction = function(down, up) {
        current_raw <- if (!is.null(names(down)) && "current" %in% names(down)) down[["current"]] else down[min(2L, length(down))]
        total_raw <- if (!is.null(names(down)) && "total" %in% names(down)) down[["total"]] else down[1L]
        base <- if (can_resume) partial_size else 0
        current <- base + suppressWarnings(as.numeric(current_raw))
        total <- if (!is.null(expected_size) && is.finite(expected_size)) expected_size else base + suppressWarnings(as.numeric(total_raw))
        if (!is.finite(current)) current <- base
        if (!is.finite(total) || total <= 0) total <- NA_real_
        pct <- if (is.finite(total)) floor(100 * current / total) else last_pct + 1L
        if (pct >= last_pct + 2L || (is.finite(total) && current >= total)) {
          last_pct <<- pct
          fraction <- if (is.finite(total)) min(1, current / total) else 0
          sdm_emit_download_progress(
            progress_fun, 0.85 * fraction,
            sprintf("Downloading %s (%s / %s)", archive_name,
                    format(current, big.mark = ",", scientific = FALSE),
                    if (is.finite(total)) format(total, big.mark = ",", scientific = FALSE) else "unknown bytes"),
            1L, 1L, current, if (is.finite(total)) total else NULL
          )
        }
        TRUE
      })
      response <- curl::curl_fetch_disk(url, tmp, handle = handle)
      if (can_resume) {
        if (identical(as.integer(response$status_code), 206L)) {
          if (!file.append(partial, tmp)) stop("Could not append resumed WorldClim archive")
          unlink(tmp, force = TRUE)
        } else {
          sdm_safe_rename(tmp, partial)
        }
      }
      size <- get_partial_file_size(partial)
      is.finite(size) && size > 1024 && (is.null(expected_size) || size >= expected_size * 0.99)
    }, error = function(e) {
      if (can_resume && file.exists(tmp)) unlink(tmp, force = TRUE)
      log_message(log_fun, "  WorldClim archive attempt ", attempt, "/", retries, " failed: ", conditionMessage(e))
      FALSE
    })

    if (ok) {
      sdm_safe_rename(partial, archive)
      return(archive)
    }
    if (attempt < retries) Sys.sleep(2 ^ (attempt - 1))
  }
  stop("WorldClim archive download failed after ", retries, " attempts; partial data retained at ", partial, call. = FALSE)
}

download_worldclim_bio <- function(worldclim_dir, selected_biovars, res = 10, log_fun = NULL, progress_fun = NULL, n_cores = NULL) {
  worldclim_dir <- sdm_resolve_project_path(worldclim_dir)
  selected_biovars <- as.integer(selected_biovars)
  dir.create(worldclim_dir, recursive = TRUE, showWarnings = FALSE)
  existing <- find_worldclim_files(worldclim_dir, selected_biovars, source = "worldclim", res = res)
  if (length(existing) > 0 && !anyNA(existing)) {
    for (i in seq_along(existing)) {
      size <- as.numeric(file.info(existing[i])$size)
      sdm_emit_download_progress(progress_fun, i / length(existing),
        sprintf("Using cached WorldClim BIO%d (file %d/%d, %s bytes)", selected_biovars[i], i, length(existing), format(size, big.mark = ",", scientific = FALSE)),
        i, length(existing), size, size, cached = TRUE)
    }
    return(list(files = existing, failed = character(), downloaded = character(), cached = TRUE))
  }

  ensure_sdm_packages(c("terra", "geodata"), n_cores = n_cores)
  if (!requireNamespace("geodata", quietly = TRUE)) {
    stop("geodata package required for WorldClim download but is not installed. Run install.packages('geodata') to install it.", call. = FALSE)
  }
  check_internet_connectivity("https://geodata.ucdavis.edu/", log_fun = log_fun)
  cache_url <- get_geodata_cache_url()
  if (nzchar(cache_url)) {
    options(gdal_cloud_cache_dir = cache_url)
    log_message(log_fun, "Using GDAL cache URL: ", cache_url)
  }

  timeout_sec <- if (res <= 2.5) 1800 else if (res <= 5) 1200 else 600
  old_timeout <- getOption("timeout")
  options(timeout = timeout_sec)
  on.exit(options(timeout = old_timeout), add = TRUE)
  sdm_emit_download_progress(progress_fun, 0, sprintf("Downloading WorldClim v2.1 archive (%.1f arc-min)", res), 1L, 1L, 0, NULL)
  if (requireNamespace("curl", quietly = TRUE)) {
    archive <- download_worldclim_archive(res, worldclim_dir, progress_fun, log_fun, timeout_sec)
    extracted <- tryCatch(utils::unzip(archive, exdir = worldclim_dir), error = function(e) {
      stop("Could not extract WorldClim archive: ", conditionMessage(e), call. = FALSE)
    })
    if (length(extracted) == 0L) stop("WorldClim archive contained no extractable files", call. = FALSE)
  } else {
    # geodata remains a compatibility fallback; production images include curl
    # so archive byte progress and resumability are normally available.
    geodata::worldclim_global(var = "bio", res = res, path = worldclim_dir)
    archive <- NULL
  }

  files <- find_worldclim_files(worldclim_dir, selected_biovars, source = "worldclim", res = res)
  for (i in seq_along(files)) {
    size <- if (!is.na(files[i]) && file.exists(files[i])) as.numeric(file.info(files[i])$size) else 0
    sdm_emit_download_progress(progress_fun, 0.85 + 0.15 * i / length(files),
      sprintf("Prepared WorldClim BIO%d (file %d/%d, %s bytes)", selected_biovars[i], i, length(files), format(size, big.mark = ",", scientific = FALSE)),
      i, length(files), size, size, cached = FALSE)
  }
  if (!is.null(archive) && !anyNA(files)) unlink(archive, force = TRUE)
  failed <- selected_biovars[is.na(files)]
  list(files = files, failed = failed, downloaded = files[!is.na(files)], cached = FALSE)
}

download_chelsa_bio <- function(chelsa_dir, selected_biovars, log_fun = NULL, progress_fun = NULL, n_cores = NULL, period = "1981-2010") {
  chelsa_dir <- sdm_resolve_project_path(chelsa_dir)
  dir.create(chelsa_dir, recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Downloading CHELSA v2.1 BIO layers to ", chelsa_dir)

  biovars <- as.integer(selected_biovars)
  n_biovars <- length(biovars)
  results <- lapply(seq_along(biovars), function(i) {
    bv <- biovars[i]
    bio_padded <- if (bv < 10) sprintf("bio0%d", bv) else sprintf("bio%d", bv)
    fname <- sprintf("CHELSA_%s_%s_V.2.1.tif", bio_padded, period)
    dest <- file.path(chelsa_dir, fname)

    if (file.exists(dest) && validate_geotiff(dest)) {
      size <- as.numeric(file.info(dest)$size)
      sdm_emit_download_progress(progress_fun, i / n_biovars,
        sprintf("Using cached CHELSA BIO%d (file %d/%d, %s bytes)", bv, i, n_biovars, format(size, big.mark = ",", scientific = FALSE)),
        i, n_biovars, size, size, cached = TRUE)
      return(list(success = TRUE, bio = bv, file = dest, downloaded = FALSE, bytes = size))
    }

    if (!requireNamespace("curl", quietly = TRUE)) {
      stop("curl package required for missing CHELSA downloads. Install with: install.packages('curl')", call. = FALSE)
    }
    download <- download_chelsa_file(get_chelsa_bio_url(bv, period), dest, log_fun, progress_fun, i, n_biovars)
    sdm_emit_download_progress(progress_fun, i / n_biovars,
      sprintf("CHELSA BIO%d complete (file %d/%d, %s bytes)", bv, i, n_biovars,
              format(download$bytes %||% 0, big.mark = ",", scientific = FALSE)),
      i, n_biovars, download$bytes, download$bytes, cached = FALSE)
    list(success = isTRUE(download$success), bio = bv,
         file = if (isTRUE(download$success)) dest else NA_character_,
         downloaded = isTRUE(download$success), bytes = download$bytes)
  })

  failed_biovars <- vapply(results[!vapply(results, function(x) isTRUE(x$success), logical(1))],
                           function(x) as.character(x$bio %||% "unknown"), character(1))
  files <- find_worldclim_files(chelsa_dir, biovars, source = "chelsa")
  downloaded <- vapply(results[vapply(results, function(x) isTRUE(x$downloaded), logical(1))], `[[`, character(1), "file")
  if (length(failed_biovars) > 0) log_message(log_fun, "Warning: failed to download CHELSA BIO: ", paste(failed_biovars, collapse = ", "))
  list(files = files, failed = failed_biovars, downloaded = downloaded, cached = length(downloaded) == 0L)
}

crop_and_optionally_aggregate <- function(r, extent_vec, aggregation_factor = 1) {
  cropped <- terra::crop(r, terra::ext(extent_vec[1], extent_vec[2], extent_vec[3], extent_vec[4]), snap = "out")
  aggregation_factor <- as.integer(aggregation_factor)
  if (is.na(aggregation_factor) || aggregation_factor < 1) aggregation_factor <- 1
  if (aggregation_factor > 1) cropped <- terra::aggregate(cropped, fact = aggregation_factor, fun = mean, na.rm = TRUE)
  cropped
}

scale_raster_stack <- function(r, means, sds) {
  out <- (r - means) / sds
  names(out) <- names(r)
  out
}

load_climate_covariates <- function(worldclim_dir, selected_biovars, training_extent, projection_extent,
                                    aggregation_factor = 1, allow_download = TRUE, worldclim_res = 10,
                                    log_fun = NULL, n_cores = NULL,
                                    source = c("worldclim", "chelsa"),
                                    selected_chelsa_extras = NULL,
                                    chelsa_dir = sdm_default_chelsa_dir,
                                    progress_fun = NULL) {
  source <- match.arg(source)
  ensure_sdm_packages("terra", n_cores = n_cores)
  selected_biovars <- validate_biovars(selected_biovars)

  worldclim_dir <- sdm_resolve_project_path(worldclim_dir)
  chelsa_dir <- sdm_resolve_project_path(chelsa_dir)
  climate_dir <- if (source == "chelsa") chelsa_dir else worldclim_dir
  model_download_progress <- if (is.function(progress_fun)) function(event) {
    event$value <- 0.20 + 0.019 * max(0, min(1, as.numeric(event$value %||% 0)))
    event$stage <- "climate_download"
    progress_fun(event)
  } else NULL

  files <- find_worldclim_files(climate_dir, selected_biovars, source = source)
  if (any(is.na(files)) && allow_download) {
    lock_dir <- NULL
    tryCatch({
      lock_dir <- sdm_download_lock(climate_dir)
      # Re-check after acquiring lock — another worker may have downloaded while we waited
      files <- find_worldclim_files(climate_dir, selected_biovars, source = source)
      if (any(is.na(files))) {
        if (identical(source, "chelsa")) {
          result <- download_chelsa_bio(chelsa_dir = chelsa_dir, selected_biovars = selected_biovars, log_fun = log_fun, progress_fun = model_download_progress, n_cores = n_cores)
          files <- result$files
          if (length(result$failed) > 0) {
            log_message(log_fun, "Partial failure: ", length(result$failed), " CHELSA BIO layers failed to download")
          }
        } else {
          result <- download_worldclim_bio(worldclim_dir = worldclim_dir, selected_biovars = selected_biovars, res = worldclim_res, log_fun = log_fun, progress_fun = model_download_progress, n_cores = n_cores)
          files <- result$files
        }
      }
    }, finally = {
      sdm_download_unlock(lock_dir)
    })
  }
  if (any(is.na(files))) {
    missing <- selected_biovars[is.na(files)]
    stop("Missing WorldClim layer(s): ", paste(paste0("BIO", missing), collapse = ", "),
      ". Restore the Worldclim folder or enable Download missing WorldClim layers.",
      call. = FALSE)
  }

  # When source is CHELSA, auto-compute aggregation factor to match worldclim_res
  if (identical(source, "chelsa") && length(files) > 0 && any(!is.na(files))) {
    sample_file <- files[!is.na(files)][1]
    if (!is.na(sample_file) && file.exists(sample_file)) {
      sample_rast <- terra::rast(sample_file)
      native_res_deg <- max(terra::res(sample_rast))
      rm(sample_rast)
      native_res_arcmin <- native_res_deg * 60
      target_agg <- max(1L, as.integer(ceiling(worldclim_res / native_res_arcmin)))
      if (target_agg > aggregation_factor) {
        log_message(log_fun, sprintf(
          "CHELSA native resolution ~%.2f arc-min; auto-aggregating %dx to match worldclim_res=%g arc-min (effective ~%.1f arc-min)",
          native_res_arcmin, target_agg, worldclim_res, native_res_arcmin * target_agg
        ))
        aggregation_factor <- target_agg
      } else if (aggregation_factor > target_agg) {
        log_message(log_fun, sprintf(
          "CHELSA native resolution ~%.2f arc-min; using user-specified aggregation %dx (>=%dx needed for worldclim_res=%g arc-min)",
          native_res_arcmin, aggregation_factor, target_agg, worldclim_res
        ))
      } else {
        log_message(log_fun, sprintf(
          "CHELSA native resolution ~%.2f arc-min already matches worldclim_res=%g arc-min; no additional aggregation",
          native_res_arcmin, worldclim_res
        ))
      }
    }
  }

  log_message(log_fun, "Loading ", length(files), " ", source, " layer(s) from ", climate_dir)
  env_global <- terra::rast(unname(files))
  names(env_global) <- paste0("bio", selected_biovars)

  extra_files <- character(0)
  if (identical(source, "chelsa") && !is.null(selected_chelsa_extras) && length(selected_chelsa_extras) > 0) {
    chelsa_files <- find_chelsa_extra_files(chelsa_dir, selected_chelsa_extras)
    missing_extras <- names(chelsa_files)[is.na(chelsa_files)]
    if (length(missing_extras) > 0 && allow_download) {
      lock_dir <- NULL
      tryCatch({
        lock_dir <- sdm_download_lock(chelsa_dir)
        downloaded <- download_chelsa_extras(chelsa_dir, missing_extras, log_fun, n_cores)
        chelsa_files <- find_chelsa_extra_files(chelsa_dir, selected_chelsa_extras)
      }, finally = {
        sdm_download_unlock(lock_dir)
      })
      if (length(downloaded$failed) > 0) {
        log_message(log_fun, "Partial failure: ", length(downloaded$failed), " CHELSA extra vars failed to download")
      }
    }
    valid_extras <- chelsa_files[!is.na(chelsa_files)]
    if (length(valid_extras) > 0) {
      log_message(log_fun, "Loading CHELSA extra variables: ", paste(names(valid_extras), collapse = ", "))
      extra_rast <- terra::rast(unname(valid_extras))
      names(extra_rast) <- names(valid_extras)
      env_global <- c(env_global, extra_rast)
      extra_files <- valid_extras
    }
  }

  # Allow NULL extents for download-only calls (Get Data tab)
  env_train <- if (!is.null(training_extent)) crop_and_optionally_aggregate(env_global, training_extent, aggregation_factor) else env_global
  env_project <- if (!is.null(projection_extent)) crop_and_optionally_aggregate(env_global, projection_extent, aggregation_factor) else env_global

  list(
    env_train = env_train,
    env_project = env_project,
    selected_biovars = selected_biovars,
    files = c(files, extra_files)
  )
}