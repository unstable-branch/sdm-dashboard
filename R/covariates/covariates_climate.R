# WorldClim discovery, download, cropping, and scaling helpers.

find_worldclim_files <- function(worldclim_dir, selected_biovars, source = c("worldclim", "chelsa")) {
  source <- match.arg(source)
  if (is.null(worldclim_dir) || length(worldclim_dir) == 0 || !nzchar(worldclim_dir)) {
    return(setNames(rep(NA_character_, length(as.integer(selected_biovars))), as.character(as.integer(selected_biovars))))
  }
  files <- if (dir.exists(worldclim_dir)) list.files(worldclim_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE) else character()
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

find_chelsa_extra_files <- function(worldclim_dir, selected_extras = names(chelsa_extra_vars)) {
  if (!dir.exists(worldclim_dir)) {
    return(setNames(rep(NA_character_, length(selected_extras)), selected_extras))
  }
  files <- list.files(worldclim_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
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

download_chelsa_extras <- function(worldclim_dir, selected_extras = names(chelsa_extra_vars),
                                   log_fun = NULL, n_cores = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for CHELSA downloads. Install with: install.packages('curl')")
  }
  ensure_sdm_packages(c("terra", "geodata"), n_cores = n_cores)
  dir.create(worldclim_dir, recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Downloading CHELSA bioclim-plus extra variables to ", worldclim_dir)

  base_url <- "https://envicloud.wsl.ch/links/chelsaV21/climatologies/"
  for (var in selected_extras) {
    fname <- sprintf("CHELSA_%s_1981-2010_V.2.1.tif", var)
    dest <- file.path(worldclim_dir, fname)
    if (file.exists(dest)) {
      log_message(log_fun, "CHELSA extra already exists: ", var)
      next
    }
    url <- paste0(base_url, fname)
    tmp <- tempfile(fileext = ".tif")
    ok <- tryCatch(
      {
        curl::curl_fetch_disk(url, tmp)
        fi <- file.info(tmp)
        !is.na(fi$size) && fi$size > 1024
      },
      error = function(e) FALSE
    )
    if (ok && file.exists(tmp) && file.info(tmp)$size > 1024) {
      file.rename(tmp, dest)
      log_message(log_fun, "Downloaded CHELSA extra: ", var)
    } else {
      log_message(log_fun, "Failed to download CHELSA extra: ", var, " — URL: ", url)
      if (file.exists(tmp)) unlink(tmp, force = TRUE)
    }
  }
  invisible(find_chelsa_extra_files(worldclim_dir, selected_extras))
}

download_worldclim_layers <- function(worldclim_dir, selected_biovars, res = 10, log_fun = NULL, n_cores = NULL) {
  ensure_sdm_packages(c("terra", "geodata"), n_cores = n_cores)
  dir.create(worldclim_dir, recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Downloading WorldClim BIO layers to ", worldclim_dir, " (resolution ", res, " arc-min)")
  wc <- geodata::worldclim_global(var = "bio", res = res, path = worldclim_dir)
  for (bv in as.integer(selected_biovars)) {
    idx <- grep(sprintf("bio_?%d$", bv), names(wc), ignore.case = TRUE)
    # geodata names layers bio01-bio19; also try zero-padded form
    if (length(idx) == 0) idx <- grep(sprintf("bio%02d$", bv), names(wc), ignore.case = TRUE)
    if (length(idx) == 0 && bv <= terra::nlyr(wc)) idx <- bv
    if (length(idx) > 0) {
      out <- file.path(worldclim_dir, sprintf("wc2.1_%sm_bio_%d.tif", res, bv))
      if (!file.exists(out)) {
        wr <- try(terra::writeRaster(wc[[idx[1]]], out, overwrite = TRUE), silent = TRUE)
        if (inherits(wr, "try-error")) {
          log_message(log_fun, "Warning: failed to write ", basename(out), ": ", attr(wr, "condition")$message)
        }
      }
    }
  }
  invisible(find_worldclim_files(worldclim_dir, selected_biovars))
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
                                    selected_chelsa_extras = NULL) {
  source <- match.arg(source)
  ensure_sdm_packages("terra", n_cores = n_cores)
  selected_biovars <- validate_biovars(selected_biovars)

  files <- find_worldclim_files(worldclim_dir, selected_biovars, source = source)
  if (any(is.na(files)) && allow_download) {
    files <- download_worldclim_layers(worldclim_dir, selected_biovars, worldclim_res, log_fun, n_cores)
  }
  if (any(is.na(files))) {
    missing <- selected_biovars[is.na(files)]
    stop("Missing WorldClim layer(s): ", paste(paste0("BIO", missing), collapse = ", "),
      ". Restore the Worldclim folder or enable Download missing WorldClim layers.",
      call. = FALSE
    )
  }

  log_message(log_fun, "Loading ", length(files), " WorldClim layer(s) from ", worldclim_dir)
  terra::terraOptions(memfrac = 0.75, progress = 0)
  env_global <- terra::rast(unname(files))
  names(env_global) <- paste0("bio", selected_biovars)

  extra_files <- character(0)
  if (identical(source, "chelsa") && !is.null(selected_chelsa_extras) && length(selected_chelsa_extras) > 0) {
    chelsa_files <- find_chelsa_extra_files(worldclim_dir, selected_chelsa_extras)
    missing_extras <- names(chelsa_files)[is.na(chelsa_files)]
    if (length(missing_extras) > 0 && allow_download) {
      downloaded <- download_chelsa_extras(worldclim_dir, missing_extras, log_fun, n_cores)
      chelsa_files <- find_chelsa_extra_files(worldclim_dir, selected_chelsa_extras)
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
