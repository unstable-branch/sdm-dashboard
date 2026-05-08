# WorldClim discovery, download, cropping, and scaling helpers.

find_worldclim_files <- function(worldclim_dir, selected_biovars, source = c("worldclim", "chelsa")) {
  source <- match.arg(source)
  files <- if (dir.exists(worldclim_dir)) list.files(worldclim_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE) else character()
  selected_biovars <- as.integer(selected_biovars)
  if (length(files) == 0) return(setNames(rep(NA_character_, length(selected_biovars)), selected_biovars))

  matched <- vapply(selected_biovars, function(bv) {
    if (source == "worldclim") {
      pattern <- sprintf("bio_?%d\\.tif$", bv)
      hit <- files[grepl(pattern, basename(files), ignore.case = TRUE, perl = TRUE)]
    } else {
      if (bv < 10) {
        pattern1 <- sprintf("CHELSA_bio0%d_.*\\.tif$", bv)
      } else {
        pattern1 <- sprintf("CHELSA_bio%d_.*\\.tif$", bv)
      }
      hit <- files[grepl(pattern1, basename(files), ignore.case = TRUE)]
    }
    if (length(hit) == 0) NA_character_ else hit[1]
  }, character(1))
  names(matched) <- as.character(selected_biovars)
  matched
}

download_worldclim_layers <- function(worldclim_dir, selected_biovars, res = 10, log_fun = NULL, n_cores = NULL) {
  ensure_sdm_packages(c("terra", "geodata"), n_cores = n_cores)
  dir.create(worldclim_dir, recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Downloading WorldClim BIO layers to ", worldclim_dir, " (resolution ", res, " arc-min)")
  wc <- geodata::worldclim_global(var = "bio", res = res, path = worldclim_dir)
  for (bv in as.integer(selected_biovars)) {
    idx <- grep(sprintf("bio_?%d$", bv), names(wc), ignore.case = TRUE)
    if (length(idx) == 0 && bv <= terra::nlyr(wc)) idx <- bv
    if (length(idx) > 0) {
      out <- file.path(worldclim_dir, sprintf("wc2.1_%sm_bio_%d.tif", res, bv))
      if (!file.exists(out)) try(terra::writeRaster(wc[[idx[1]]], out, overwrite = TRUE), silent = TRUE)
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
  out <- r
  for (i in seq_len(terra::nlyr(r))) out[[i]] <- (r[[i]] - means[i]) / sds[i]
  names(out) <- names(r)
  out
}

load_climate_covariates <- function(worldclim_dir, selected_biovars, training_extent, projection_extent,
                                    aggregation_factor = 1, allow_download = TRUE, worldclim_res = 10,
                                    log_fun = NULL, n_cores = NULL,
                                    source = c("worldclim", "chelsa")) {
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
         ". Restore the Worldclim folder or enable Download missing WorldClim layers.", call. = FALSE)
  }

  log_message(log_fun, "Loading ", length(files), " WorldClim layer(s) from ", worldclim_dir)
  terra::terraOptions(memfrac = 0.75, progress = 1)
  env_global <- terra::rast(unname(files))
  names(env_global) <- paste0("bio", selected_biovars)

  list(
    env_train = crop_and_optionally_aggregate(env_global, training_extent, aggregation_factor),
    env_project = crop_and_optionally_aggregate(env_global, projection_extent, aggregation_factor),
    selected_biovars = selected_biovars,
    files = files
  )
}
