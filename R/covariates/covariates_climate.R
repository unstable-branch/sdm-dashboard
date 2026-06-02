# WorldClim discovery, download, cropping, and scaling helpers.

# Simple file-based lock for concurrent download protection
sdm_download_lock <- function(lock_path, timeout_sec = 300, poll_ms = 500) {
  lock_dir <- paste0(lock_path, ".lock")
  deadline <- Sys.time() + timeout_sec
  while (Sys.time() < deadline) {
    if (dir.create(lock_dir, showWarnings = FALSE)) {
      return(lock_dir)
    }
    Sys.sleep(poll_ms / 1000)
  }
  stop("Download lock timeout after ", timeout_sec, "s for: ", lock_path, call. = FALSE)
}

sdm_download_unlock <- function(lock_dir) {
  if (!is.null(lock_dir) && dir.exists(lock_dir)) {
    unlink(lock_dir, recursive = TRUE)
  }
}

find_worldclim_files <- function(worldclim_dir, selected_biovars, source = c("worldclim", "chelsa"), res = NULL) {
  source <- match.arg(source)
  if (is.null(worldclim_dir) || length(worldclim_dir) == 0 || !nzchar(worldclim_dir)) {
    return(setNames(rep(NA_character_, length(as.integer(selected_biovars))), as.character(as.integer(selected_biovars))))
  }
  pattern <- if (source == "worldclim" && !is.null(res)) {
    sprintf("wc2\\.1_%sm.*\\.tif$", res)
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
      sizes <- vapply(hit, function(f) as.integer(file.info(f)$size), integer(1))
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
  base <- get_chelsa_base_url()
  bio_id <- if (bio_num < 10) sprintf("bio0%d", bio_num) else sprintf("bio%d", bio_num)
  file_name <- sprintf("CHELSA_%s_%s_V.2.1.tif", bio_id, period)
  paste0(base, "/", bio_id, "/", period, "/", file_name)
}

get_chelsa_extra_url <- function(var_name, period = "1981-2010") {
  base <- get_chelsa_base_url()
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
    if (!is.na(fi$size) && fi$size > 0) as.integer(fi$size) else NA_integer_
  } else {
    NA_integer_
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
    as.integer(gsub("\\D", "", matches))
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

download_chelsa_file <- function(url, dest, log_fun = NULL) {
  retries <- get_chelsa_retries()
  timeout <- get_chelsa_timeout()

  check_internet_connectivity("https://os.unil.cloud.switch.ch/", log_fun = log_fun)
  expected_size <- get_content_length(url, timeout = min(timeout, 30))

  for (attempt in seq_len(retries)) {
    if (attempt > 1) {
      backoff <- 2 ^ (attempt - 1)
      log_message(log_fun, "  Retry ", attempt, "/", retries, " after ", backoff, "s...")
      Sys.sleep(backoff)
    }

    partial_size <- get_partial_file_size(dest)
    tmp <- tempfile(fileext = ".tif")

    fetch_ok <- tryCatch({
      handle <- curl::new_handle(timeout = timeout)

      if (!is.na(partial_size) && !is.null(expected_size) && partial_size < expected_size) {
        log_message(log_fun, "  Resuming from byte ", partial_size, " (expected ", expected_size, ")")
        curl::handle_setheaders(handle, Range = sprintf("bytes=%d-", partial_size))
        resp <- curl::curl_fetch_disk(url, tmp, handle = handle)
        fi <- file.info(tmp)
        if (!is.na(fi$size) && !is.na(partial_size)) {
          new_size <- partial_size + fi$size
          if (!is.null(expected_size) && new_size < expected_size * 0.99) {
            log_message(log_fun, "  Resumed file size (", new_size, ") < expected (", expected_size, ") — re-downloading from scratch")
            unlink(tmp, force = TRUE)
            return(FALSE)
          }
        }
      } else {
        resp <- curl::curl_fetch_disk(url, tmp, handle = handle)
      }
      fi <- file.info(tmp)
      !is.na(fi$size) && fi$size > 1024
    }, error = function(e) {
      log_message(log_fun, "  Attempt ", attempt, " error: ", conditionMessage(e))
      if (file.exists(tmp)) unlink(tmp, force = TRUE)
      FALSE
    })

    if (fetch_ok && file.exists(tmp) && file.info(tmp)$size > 1024) {
      if (validate_geotiff(tmp)) {
        if (!is.na(partial_size) && file.exists(dest)) {
          file.remove(dest)
        }
        file.rename(tmp, dest)
        log_message(log_fun, "  Downloaded: ", basename(dest))
        return(TRUE)
      } else {
        log_message(log_fun, "  Invalid GeoTIFF (failed terra validation): ", basename(dest))
        unlink(tmp, force = TRUE)
      }
    } else {
      if (file.exists(tmp)) unlink(tmp, force = TRUE)
      log_message(log_fun, "  Attempt ", attempt, " failed (fetch or size check)")
    }
  }

  log_message(log_fun, "  All ", retries, " attempts exhausted for: ", basename(dest))
  FALSE
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
    success <- download_chelsa_file(url, dest, log_fun)
    if (!success) {
      failed <- c(failed, var)
    }
  }

  list(
    files = find_chelsa_extra_files(chelsa_dir, selected_extras),
    failed = failed
  )
}

download_worldclim_bio <- function(worldclim_dir, selected_biovars, res = 10, log_fun = NULL, n_cores = NULL) {
  ensure_sdm_packages(c("terra", "geodata"), n_cores = n_cores)
  dir.create(worldclim_dir, recursive = TRUE, showWarnings = FALSE)

  check_internet_connectivity("https://geodata.ucdavis.edu/", log_fun = log_fun)
  cache_url <- get_geodata_cache_url()
  if (nzchar(cache_url)) {
    options(gdal_cloud_cache_dir = cache_url)
    log_message(log_fun, "Using GDAL cache URL: ", cache_url)
  }

  if (res <= 2.5) {
    log_message(log_fun, "  NOTE: ", res, " arc-min WorldClim is approximately 320 MB compressed.")
    log_message(log_fun, "  Estimated download time: 3-15 minutes depending on connection speed.")
  } else if (res <= 5) {
    log_message(log_fun, "  NOTE: ", res, " arc-min WorldClim is approximately 80 MB compressed.")
  }

  timeout_sec <- if (res <= 2.5) 1800 else if (res <= 5) 1200 else 600
  old_timeout <- getOption("timeout")
  options(timeout = timeout_sec)
  on.exit(options(timeout = old_timeout), add = TRUE)
  log_message(log_fun, sprintf("  Download timeout set to %d seconds (resolution: %d arc-min)", timeout_sec, res))

  log_message(log_fun, "  Downloading WorldClim (this may take a while)...")
  wc <- geodata::worldclim_global(var = "bio", res = res, path = worldclim_dir)
  log_message(log_fun, "  WorldClim download complete.")
  failed <- character()

  # geodata writes files to worldclim_dir/climate/wc2.1_{res}m/ — use them directly
  # No need to write duplicate top-level copies (H3 fix)
  list(
    files = find_worldclim_files(worldclim_dir, selected_biovars),
    failed = failed
  )
}

download_chelsa_bio <- function(chelsa_dir, selected_biovars, log_fun = NULL, n_cores = NULL, period = "1981-2010") {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for CHELSA downloads. Install with: install.packages('curl')", call. = FALSE)
  }
  ensure_sdm_packages("terra", n_cores = n_cores)
  dir.create(chelsa_dir, recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Downloading CHELSA v2.1 BIO layers to ", chelsa_dir)

  check_internet_connectivity("https://os.unil.cloud.switch.ch/", log_fun = log_fun)
  biovars <- as.integer(selected_biovars)

  # Determine parallel workers — use at most length(biovars) but cap at n_cores
  n_workers <- min(length(biovars), max(1L, n_cores %||% 2L))

  log_message(log_fun, "Downloading ", length(biovars), " BIO layers using lapply (fork-safe serial; parallel disabled to avoid RPostgres fork deadlock) (period: ", period, ")")

  # Serial download using lapply — mclapply (fork) is unsafe inside Plumber (inherits DB pool, Redis connections)
  results <- lapply(biovars, function(bv) {
    bio_padded <- if (bv < 10) sprintf("bio0%d", bv) else sprintf("bio%d", bv)
    fname <- sprintf("CHELSA_%s_%s_V.2.1.tif", bio_padded, period)
    dest <- file.path(chelsa_dir, fname)

    if (file.exists(dest)) {
      if (validate_geotiff(dest)) {
        return(list(success = TRUE, bio = bv, file = dest))
      }
    }

    url <- get_chelsa_bio_url(bv, period)
    success <- download_chelsa_file(url, dest, log_fun)
    list(success = success, bio = bv, file = if (success) dest else NA_character_)
  })

  failed_biovars <- character()
  for (res_item in results) {
    if (is.null(res_item$success) || !res_item$success) {
      failed_biovars <- c(failed_biovars, res_item$bio %||% "unknown")
    }
  }

  files <- find_worldclim_files(chelsa_dir, biovars, source = "chelsa")

  if (length(failed_biovars) > 0) {
    log_message(log_fun, "Warning: failed to download CHELSA BIO: ", paste(failed_biovars, collapse = ", "))
  }

  list(
    files = files,
    failed = failed_biovars
  )
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
                                    chelsa_dir = sdm_default_chelsa_dir) {
  source <- match.arg(source)
  ensure_sdm_packages("terra", n_cores = n_cores)
  selected_biovars <- validate_biovars(selected_biovars)

  climate_dir <- if (source == "chelsa") chelsa_dir else worldclim_dir

  files <- find_worldclim_files(climate_dir, selected_biovars, source = source)
  if (any(is.na(files)) && allow_download) {
    lock_dir <- NULL
    tryCatch({
      lock_dir <- sdm_download_lock(climate_dir)
      # Re-check after acquiring lock — another worker may have downloaded while we waited
      files <- find_worldclim_files(climate_dir, selected_biovars, source = source)
      if (any(is.na(files))) {
        if (identical(source, "chelsa")) {
          result <- download_chelsa_bio(chelsa_dir, selected_biovars, log_fun, n_cores)
          files <- result$files
          if (length(result$failed) > 0) {
            log_message(log_fun, "Partial failure: ", length(result$failed), " CHELSA BIO layers failed to download")
          }
        } else {
          result <- download_worldclim_bio(worldclim_dir, selected_biovars, worldclim_res, log_fun, n_cores)
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

  terra::terraOptions(memfrac = 0.5, progress = 0)

  list(
    env_train = env_train,
    env_project = env_project,
    selected_biovars = selected_biovars,
    files = c(files, extra_files)
  )
}