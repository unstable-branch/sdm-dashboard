# CMIP6 Climate Data Automation.
# Structured picker and fetcher for future climate projections.

fetch_cmip6_worldclim <- function(gcm = "UKESM1-0-LL", ssp = "SSP5-8.5", period = "2061-2080",
                                   var = "bioc", res = 10, out_dir = "Worldclim_future",
                                   quiet = FALSE, ...) {
  if (!requireNamespace("geodata", quietly = TRUE)) {
    stop("geodata package required for CMIP6 download. Install with: install.packages('geodata')")
  }

  ssp_map <- c("SSP1-2.6" = "126", "SSP2-4.5" = "245", "SSP3-7.0" = "370", "SSP5-8.5" = "585")
  ssp_code <- if (nzchar(ssp) && !is.na(ssp_map[ssp])) ssp_map[ssp] else ssp

  if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE)

  cache_subdir <- file.path(out_dir, paste(gcm, ssp, period, sep = "_"))
  if (dir.exists(cache_subdir)) {
    if (!quiet) message("Using cached CMIP6 data: ", cache_subdir)
    return(list(dir = cache_subdir, cached = TRUE))
  }

  if (!quiet) message("Downloading CMIP6 ", gcm, " ", ssp, " ", period, "...")

  tryCatch({
    out <- geodata::cmip6_world(
      var = var,
      bio.num = 1:19,
      model = gcm,
      ssp = ssp_code,
      time = period,
      res = res,
      version = "2.1",
      path = out_dir
    )

    actual_path <- attr(out, "path") %||% file.path(out_dir, "climate", "wc2.1_10m")

    if (dir.exists(cache_subdir) || !dir.exists(actual_path)) {
      list(dir = cache_subdir, cached = dir.exists(cache_subdir), raster = out)
    } else {
      if (!dir.exists(cache_subdir)) dir.create(cache_subdir, recursive = TRUE)
      tifs <- list.files(actual_path, pattern = "\\.tif$", full.names = TRUE, recursive = FALSE)
      for (tf in tifs) {
        bn <- basename(tf)
        new_bn <- gsub("^wc2[.]1_10m_bioc_", "", bn, fixed = FALSE)
        new_bn <- gsub("_ssp", "_SSP", new_bn)
        new_path <- file.path(cache_subdir, new_bn)
        if (file.exists(new_path)) file.remove(new_path)
        file.rename(tf, new_path)
      }
      empty_after_move <- length(list.files(actual_path, pattern = "\\.tif$")) == 0L
      if (empty_after_move && actual_path != cache_subdir) {
        unlink(actual_path, recursive = TRUE, force = TRUE)
        parent <- dirname(actual_path)
        if (dirname(parent) != out_dir && dir.exists(parent) && length(list.files(parent)) == 0L) {
          unlink(parent, recursive = TRUE, force = TRUE)
        }
      }
      list(dir = cache_subdir, cached = FALSE, raster = out)
    }
  }, error = function(e) {
    message("CMIP6 download failed for ", gcm, " ", ssp, " ", period, ": ", conditionMessage(e))
    message("Troubleshooting: Check internet connection, try a different GCM/SSP/period")
    stop("CMIP6 download failed for ", gcm, " ", ssp, " ", period, ": ", conditionMessage(e))
  })
}

cmip6_load_future_covariates <- function(cmip6_dir, selected_biovars, training_extent,
                                          projection_extent, aggregation_factor = 1,
                                          log_fun = NULL) {
  files <- find_cmip6_files(cmip6_dir, selected_biovars)

  missing <- selected_biovars[is.na(files)]
  if (length(missing) > 0) {
    stop("Missing CMIP6 layers for BIO", paste(missing, collapse = ", "),
         ". Ensure all selected variables are available in ", cmip6_dir)
  }

  log_message(log_fun, "Loading ", length(files), " CMIP6 future climate layers from ", cmip6_dir)

  layers <- list()
  for (bio_var in names(files)) {
    if (!is.na(files[bio_var]) && file.exists(files[bio_var])) {
      r <- terra::rast(files[bio_var])
      r <- terra::crop(r, projection_extent)
      if (aggregation_factor > 1) {
        r <- terra::aggregate(r, fact = aggregation_factor)
      }
      layers[[bio_var]] <- r
    }
  }

  env_future <- terra::rast(layers)
  terra::names(env_future) <- names(layers)

  list(env_future = env_future, files = files)
}

find_cmip6_files <- function(cmip6_dir, selected_biovars) {
  all_files <- list.files(cmip6_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  all_files <- normalizePath(all_files)

  bio_patterns <- paste0("bio", c(1:19, "01", "02", "03", "04", "05", "06", "07", "08", "09",
                                    10:19, "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"))
  names(bio_patterns) <- paste0("bio", c(1:19, 1:19))

  files <- character()
  for (bio in selected_biovars) {
    bio_name <- paste0("bio", bio)
    bio_name_2digit <- if (bio < 10) paste0("bio0", bio) else paste0("bio", bio)

    pattern1 <- paste0("_(", bio_name, ")[^0-9]")
    pattern2 <- paste0("_(", bio_name_2digit, ")[^0-9]")

    matched <- c(
      all_files[grepl(pattern1, all_files, ignore.case = TRUE)],
      all_files[grepl(pattern2, all_files, ignore.case = TRUE)]
    )

    if (length(matched) == 0) {
      files[as.character(bio)] <- NA_character_
    } else {
      files[as.character(bio)] <- matched[1]
    }
  }

  setNames(files, paste0("bio", selected_biovars))
}

cmip6_gcm_choices <- c(
  "UKESM1-0-LL (UK Earth System Model)" = "UKESM1-0-LL",
  "MPI-ESM1-2-HR (Max Planck Institute)" = "MPI-ESM1-2-HR",
  "IPSL-CM6A-LR (Institut Pierre-Simon Laplace)" = "IPSL-CM6A-LR",
  "MRI-ESM2-0 (Meteorological Research Institute)" = "MRI-ESM2-0",
  "GFDL-ESM4 (Geophysical Fluid Dynamics Laboratory)" = "GFDL-ESM4"
)

cmip6_ssp_choices <- c(
  "SSP1-2.6 (Low emissions)" = "SSP1-2.6",
  "SSP2-4.5 (Intermediate)" = "SSP2-4.5",
  "SSP3-7.0 (High emissions)" = "SSP3-7.0",
  "SSP5-8.5 (Very high emissions)" = "SSP5-8.5"
)

cmip6_period_choices <- c(
  "2021-2040 (Near future)" = "2021-2040",
  "2041-2060 (Mid century)" = "2041-2060",
  "2061-2080 (End of century)" = "2061-2080",
  "2081-2100 (Long term)" = "2081-2100"
)

average_cmip6_gcms <- function(gcm_list, ssp, period, var = "bioc", res = 10,
                               out_dir = "Worldclim_future", quiet = FALSE, ...) {
  if (length(gcm_list) < 2) {
    stop("average_cmip6_gcms requires at least 2 GCMs")
  }

  ssp_map <- c("SSP1-2.6" = "126", "SSP2-4.5" = "245", "SSP3-7.0" = "370", "SSP5-8.5" = "585")
  ssp_code <- ssp_map[ssp] %||% gsub("[^0-9]", "", ssp)

  cached_dirs <- list()
  for (gcm in gcm_list) {
    result <- fetch_cmip6_worldclim(gcm = gcm, ssp = ssp, period = period,
                                     var = var, res = res, out_dir = out_dir, quiet = quiet, ...)
    cached_dirs[[gcm]] <- result$dir
  }

  out_path <- file.path(out_dir, paste("averaged", paste(gcm_list, collapse = "_"), ssp_code, period, sep = "_"))
  if (!dir.exists(out_path)) dir.create(out_path, recursive = TRUE)

  all_bio_vars <- paste0("bio", 1:19)
  first_dir <- cached_dirs[[1]]

  for (bio in all_bio_vars) {
    bio_pattern <- paste0("_(", bio, ")[^0-9]|[_]", bio, "\\.tif$")
    bio_files <- character()

    for (gcm in gcm_list) {
      gcm_dir <- cached_dirs[[gcm]]
      gcm_files <- list.files(gcm_dir, pattern = "\\.tif$", full.names = TRUE)
      matched <- gcm_files[grepl(bio_pattern, gcm_files, ignore.case = TRUE)]
      if (length(matched) > 0) bio_files <- c(bio_files, matched[1])
    }

    if (length(bio_files) == length(gcm_list)) {
      stacked <- terra::rast(bio_files)

      avg <- terra::app(stacked, fun = "mean", na.rm = TRUE)
      out_mean <- file.path(out_path, paste0("bioc_", paste(gcm_list, collapse = "_"), "_SSP", ssp_code, "_", period, "_", bio, ".tif"))
      terra::writeRaster(avg, out_mean, overwrite = TRUE,
                         wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))

      sd_layer <- terra::app(stacked, fun = "sd", na.rm = TRUE)
      out_sd <- file.path(out_path, paste0("bioc_", paste(gcm_list, collapse = "_"), "_SSP", ssp_code, "_", period, "_", bio, "_sd.tif"))
      terra::writeRaster(sd_layer, out_sd, overwrite = TRUE,
                         wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    }
  }

  baseline_dir <- "Worldclim"
  if (dir.exists(baseline_dir)) {
    for (bio in all_bio_vars) {
      mean_file <- file.path(out_path, paste0("bioc_", paste(gcm_list, collapse = "_"), "_SSP", ssp_code, "_", period, "_", bio, ".tif"))
      if (!file.exists(mean_file)) next

      baseline_file <- file.path(baseline_dir, paste0(bio, ".tif"))
      if (!file.exists(baseline_file)) next

      future_layer <- terra::rast(mean_file)
      baseline_layer <- terra::rast(baseline_file)

      if (!terra::compareGeom(future_layer, baseline_layer, stopOnError = FALSE)) {
        baseline_layer <- terra::crop(baseline_layer, terra::ext(future_layer))
      }

      delta <- future_layer - baseline_layer
      out_delta <- file.path(out_path, paste0("bioc_", paste(gcm_list, collapse = "_"), "_SSP", ssp_code, "_", period, "_", bio, "_delta.tif"))
      terra::writeRaster(delta, out_delta, overwrite = TRUE,
                         wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    }
  }

  mean_files <- list.files(out_path, pattern = paste0("_SSP", ssp_code, ".*_bio[0-9]+\\.tif$"), full.names = TRUE)
  first_raster <- if (length(mean_files) > 0) terra::rast(mean_files[1]) else terra::rast()

  list(dir = out_path, cached = FALSE, raster = first_raster, averaged = TRUE)
}

discover_gcm_dirs <- function(future_worldclim_dir) {
  if (!dir.exists(future_worldclim_dir)) {
    return(character(0))
  }

  all_entries <- list.dirs(future_worldclim_dir, recursive = FALSE, full.names = FALSE)
  gcm_pattern <- "^[^_]+"  # GCM name is before first underscore

  gcm_dirs <- character()
  for (entry in all_entries) {
    if (dir.exists(file.path(future_worldclim_dir, entry))) {
      gcm_dirs <- c(gcm_dirs, entry)
    }
  }

  gcm_dirs
}

average_gcm_layers <- function(gcm_names, future_worldclim_dir, bio_variables,
                                output_dir, include_sd = FALSE, log_fun = NULL) {
  available_dirs <- discover_gcm_dirs(future_worldclim_dir)

  if (length(available_dirs) == 0) {
    log_message(log_fun, "No GCM directories found in ", future_worldclim_dir)
    return(list(
      averaged_raster = NULL,
      sd_raster = NULL,
      gcms_found = character(0),
      n_gcms_averaged = 0
    ))
  }

  gcm_pattern <- "^[^_]+"
  gcms_found <- character()

  for (gcm in gcm_names) {
    matched <- available_dirs[grepl(paste0("^", gcm, "_"), available_dirs)]
    if (length(matched) > 0) {
      gcms_found <- c(gcms_found, matched[1])
    }
  }

  if (length(gcms_found) == 0) {
    log_message(log_fun, "No matching GCM directories found for: ",
                paste(gcm_names, collapse = ", "))
    return(list(
      averaged_raster = NULL,
      sd_raster = NULL,
      gcms_found = character(0),
      n_gcms_averaged = 0
    ))
  }

  log_message(log_fun, "Averaging ", length(gcms_found), " GCMs: ",
              paste(gcms_found, collapse = ", "))

  all_bio_vars <- if (missing(bio_variables)) paste0("bio", 1:19) else paste0("bio", bio_variables)

  averaged_stack <- NULL
  sd_stack <- NULL

  for (bio in all_bio_vars) {
    bio_pattern <- paste0("_(", bio, ")[^0-9]|[_]", bio, "\\.tif$")
    bio_files <- character()
    gcm_dirs_used <- character()

    for (gcm_dir in gcms_found) {
      gcm_path <- file.path(future_worldclim_dir, gcm_dir)
      gcm_files <- list.files(gcm_path, pattern = "\\.tif$", full.names = TRUE)
      matched <- gcm_files[grepl(bio_pattern, gcm_files, ignore.case = TRUE)]
      if (length(matched) > 0) {
        bio_files <- c(bio_files, matched[1])
        gcm_dirs_used <- c(gcm_dirs_used, gcm_dir)
      }
    }

    if (length(bio_files) >= 2) {
      stacked <- terra::rast(bio_files)
      avg <- terra::app(stacked, fun = "mean", na.rm = TRUE)
      if (is.null(averaged_stack)) {
        averaged_stack <- avg
      } else {
        averaged_stack <- terra::add(averaged_stack, avg)
      }

      if (include_sd) {
        sd_val <- terra::app(stacked, fun = "sd", na.rm = TRUE)
        if (is.null(sd_stack)) {
          sd_stack <- sd_val
        } else {
          sd_stack <- terra::add(sd_stack, sd_val)
        }
      }
    }
  }

  if (!is.null(averaged_stack) && terra::nlyr(averaged_stack) > 0) {
    out_name <- paste0("bioc_avg_", paste(gcms_found, collapse = "_"), ".tif")
    out_tif <- file.path(output_dir, out_name)
    if (!dir.exists(output_dir)) dir.create(output_dir, recursive = TRUE)
    terra::writeRaster(averaged_stack, out_tif, overwrite = TRUE,
                       wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    log_message(log_fun, "Averaged raster written to: ", out_tif)
  }

  list(
    averaged_raster = averaged_stack,
    sd_raster = if (include_sd) sd_stack else NULL,
    gcms_found = gcms_found,
    n_gcms_averaged = length(gcms_found)
  )
}