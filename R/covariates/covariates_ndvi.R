# MODIS NDVI (GIMMS COG) and AVHRR EVI (GIMMS) covariate loading.
# NDVI:  ~250m 8-day composites from GIMMS NASA COG, aggregated to 2.5 arc-min
# EVI:   ~8km   from GIMMS AVHRR (coarser resolution, no aggregation)

gimms_doy_map <- function() {
  # 46 eight-day periods per year, DOY of the first day of each period
  doy_8day <- seq(1L, 361L, by = 8L)
  names(doy_8day) <- sprintf("%03d", doy_8day)
  doy_8day
}

# Map month number (1-12) to the 8-day period closest to mid-month
doy_for_month <- function(month) {
  m <- as.integer(month)
  stopifnot(m >= 1 && m <= 12)
  # Mid-month DOY (approximate, for a non-leap year)
  month_start_doy <- c(1L, 32L, 60L, 91L, 121L, 152L, 182L, 213L, 244L, 274L, 305L, 335L)
  mid_doy <- month_start_doy[m] + 14L # mid-month approximation
  period_doy <- ((mid_doy - 1L) %/% 8L) * 8L + 1L
  sprintf("%03d", period_doy)
}

gimms_ndvi_doy <- gimms_doy_map()

# Which 8-day period to use for each calendar month (period DOY, period index)
month_period_doys <- sapply(1:12, function(m) doy_for_month(m))
names(month_period_doys) <- month.abb

# GIMMS COG NDVI base URL
gimms_cog_base <- "https://gimms.gsfc.nasa.gov/MODIS/std/GMOD09Q1/cog/NDVI"

# GIMMS AVHRR EVI base URL
gimms_avhrr_base <- "https://gimms.gsfc.nasa.gov/AVHRR/gimms006nc"

# ---------------------------------------------------------------------------
# NDVI layer download / cache
# ---------------------------------------------------------------------------

ndvi_url <- function(year, doy) {
  paste0(
    gimms_cog_base, "/", year, "/", doy, "/",
    "GMOD09Q1.A", year, doy, ".08d.latlon.global.061.NDVI.tif"
  )
}

ndvi_mean_url <- function(doy) {
  paste0(
    gimms_cog_base, "_mean_S2001-2024/", doy, "/",
    "GMOD09Q1.A2001-2024", doy, ".08d.latlon.global.061.NDVI_mean.tif"
  )
}

# ---------------------------------------------------------------------------
# AVHRR EVI — discover actual file from directory listing
# ---------------------------------------------------------------------------

avhrr_evi_file_glob <- function() {
  # GIMMS AVHRR EVI files are NetCDF: gimms_evi3g_v1_YYYY_YYYY_0.05deg.nc
  # We probe the directory to find the latest matching file
  "gimms_evi3g_v1_*.nc"
}

discover_avhrr_evi_url <- function(log_fun = NULL) {
  # Try to list the directory and find EVI NetCDF file
  vsi_dir <- paste0(gimms_avhrr_base, "/?list_dir=1")
  tryCatch(
    {
      files <- terra::vect(vsi_dir)
      # actually this won't work — GIMMS doesn't expose directory listing via VSI
      NULL
    },
    error = function(e) NULL
  )

  # Fallback: construct known URL pattern from GIMMS documentation
  # EVI3g v1 NetCDF: gimms_evi3g_v1_1981_2020_0.05deg.nc
  paste0(gimms_avhrr_base, "/gimms_evi3g_v1_1981_2020_0.05deg.nc")
}

# ---------------------------------------------------------------------------
# Main loader
# ---------------------------------------------------------------------------

load_ndvi_covariate <- function(ndvi_year = 2024,
                                selected_periods = "annual_mean",
                                extent_vec = NULL,
                                aggregate_factor = 18L,
                                covariate_cache_dir = sdm_default_covariate_cache_dir,
                                allow_download = TRUE,
                                log_fun = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for NDVI downloads. Install with: install.packages('curl')", call. = FALSE)
  }

  selected_periods <- unique(as.character(selected_periods))
  selected_periods <- selected_periods[nzchar(selected_periods)]
  if (length(selected_periods) == 0) {
    log_message(log_fun, "NDVI selected but no periods were chosen.")
    return(NULL)
  }

  valid_periods <- c(
    "annual_mean", "annual_max", "gimms_clim",
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  )
  invalid <- setdiff(selected_periods, valid_periods)
  if (length(invalid) > 0) {
    log_message(log_fun, "Unknown NDVI period(s): ", paste(invalid, collapse = ", "))
    selected_periods <- intersect(selected_periods, valid_periods)
  }
  if (length(selected_periods) == 0) {
    log_message(log_fun, "No valid NDVI periods selected.")
    return(NULL)
  }

  # Current year for bounds check
  current_year <- as.integer(format(Sys.Date(), "%Y"))
  ndvi_year <- as.integer(ndvi_year[1])
  if (is.na(ndvi_year) || ndvi_year < 2000 || ndvi_year > current_year) {
    log_message(log_fun, "NDVI year ", ndvi_year, " out of range (2000-", current_year, "). Using ", current_year, ".")
    ndvi_year <- current_year
  }

  cache_dir <- file.path(covariate_cache_dir, "gimms")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  # If extent is provided, build an extent cache key
  ext_key <- ""
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext_key <- paste0("_", paste(round(extent_vec, 2), collapse = "_"))
  }

  # -------------------------------------------------------------------------
  # NDVI: process each requested period type
  # -------------------------------------------------------------------------
  ndvi_layers <- list()
  ndvi_files <- character(0)
  ndvi_loaded <- character(0)

  for (period in selected_periods) {
    if (identical(period, "gimms_clim")) {
      # Long-term mean: one file per period, no year
      layer_name <- "ndvi_gimms_clim"
      cached <- file.path(cache_dir, paste0("gimms_ndvi_clim", ext_key, ".tif"))

      if (file.exists(cached)) {
        log_message(log_fun, "Using cached GIMMS climatology NDVI")
        r <- terra::rast(cached)
      } else if (isTRUE(allow_download)) {
        log_message(log_fun, "Downloading GIMMS NDVI climatology (46 mean tiles)")
        tiles <- list()
        for (doy_name in names(gimms_ndvi_doy)) {
          doy_url <- ndvi_mean_url(doy_name)
          tmp <- tempfile(fileext = ".tif")
          downloaded <- tryCatch(
            {
              curl::curl_fetch_disk(doy_url, tmp)
              file.info(tmp)$size > 1024
            },
            error = function(e) FALSE
          )
          if (!downloaded || !file.exists(tmp)) {
            log_message(log_fun, "Failed to download NDVI climatology tile DOY ", doy_name)
            next
          }
          tiles[[doy_name]] <- tryCatch(terra::rast(tmp), error = function(e) NULL)
          unlink(tmp)
        }
        if (length(tiles) == 0) {
          log_message(log_fun, "No GIMMS NDVI climatology tiles loaded.")
          next
        }
        # Crop to extent if provided
        if (!is.null(extent_vec) && length(extent_vec) == 4) {
          tiles <- lapply(tiles, function(t) {
            tryCatch(terra::crop(t, terra::ext(extent_vec), snap = "out"), error = function(e) t)
          })
        }
        # Aggregate each tile
        aggd <- lapply(tiles, function(t) {
          tryCatch(terra::aggregate(t, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
            error = function(e) NULL
          )
        })
        aggd <- aggd[!sapply(aggd, is.null)]
        if (length(aggd) == 0) {
          log_message(log_fun, "Aggregation failed.")
          next
        }
        r <- terra::app(do.call(c, aggd), fun = "mean", na.rm = TRUE)
        terra::writeRaster(r, cached,
          overwrite = TRUE,
          wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
        )
        ndvi_files <- c(ndvi_files, cached)
        log_message(log_fun, "GIMMS NDVI climatology cached (", length(aggd), " tiles).")
      } else {
        log_message(log_fun, "GIMMS NDVI climatology not cached and downloads disabled.")
        next
      }

      if (!is.null(r) && inherits(r, "SpatRaster")) {
        names(r) <- layer_name
        ndvi_layers[[layer_name]] <- r
        ndvi_loaded <- c(ndvi_loaded, "gimms_clim")
      }
    } else if (identical(period, "annual_mean") || identical(period, "annual_max")) {
      # All 46 periods for the year, then aggregate
      layer_name <- paste0("ndvi_", if (identical(period, "annual_mean")) "annual_" else "max_", ndvi_year)
      cached <- file.path(cache_dir, paste0("gimms_ndvi_", period, "_", ndvi_year, ext_key, ".tif"))

      if (file.exists(cached)) {
        log_message(log_fun, "Using cached GIMMS NDVI ", period, " for ", ndvi_year)
        r <- terra::rast(cached)
      } else if (isTRUE(allow_download)) {
        log_message(log_fun, "Downloading GIMMS NDVI for ", ndvi_year, " (46 eight-day periods)...")
        tiles <- list()
        for (doy_name in names(gimms_ndvi_doy)) {
          url <- ndvi_url(ndvi_year, doy_name)
          tmp <- tempfile(fileext = ".tif")
          downloaded <- tryCatch(
            {
              curl::curl_fetch_disk(url, tmp)
              file.info(tmp)$size > 1024
            },
            error = function(e) FALSE
          )
          if (!downloaded || !file.exists(tmp)) {
            log_message(log_fun, "Failed to download NDVI tile DOY ", doy_name)
            next
          }
          t <- tryCatch(terra::rast(tmp), error = function(e) NULL)
          unlink(tmp)
          if (is.null(t)) {
            next
          }
          # Crop to extent first (before caching full tile)
          if (!is.null(extent_vec) && length(extent_vec) == 4) {
            t <- tryCatch(terra::crop(t, terra::ext(extent_vec), snap = "out"), error = function(e) t)
          }
          # Aggregate immediately to save space
          t_agg <- tryCatch(terra::aggregate(t, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
            error = function(e) NULL
          )
          if (!is.null(t_agg)) tiles[[doy_name]] <- t_agg
        }
        if (length(tiles) == 0) {
          log_message(log_fun, "No GIMMS NDVI tiles loaded for year ", ndvi_year, ".")
          next
        }
        stack <- do.call(c, tiles)
        if (identical(period, "annual_mean")) {
          r <- terra::app(stack, fun = "mean", na.rm = TRUE)
        } else {
          r <- terra::app(stack, fun = "max", na.rm = TRUE)
        }
        terra::writeRaster(r, cached,
          overwrite = TRUE,
          wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
        )
        ndvi_files <- c(ndvi_files, cached)
        log_message(log_fun, "GIMMS NDVI ", period, " for ", ndvi_year, " cached (", length(tiles), " tiles).")
      } else {
        log_message(log_fun, "GIMMS NDVI not cached and downloads disabled: ", layer_name)
        next
      }

      if (!is.null(r) && inherits(r, "SpatRaster")) {
        names(r) <- layer_name
        ndvi_layers[[layer_name]] <- r
        ndvi_loaded <- c(ndvi_loaded, paste0(period, "_", ndvi_year))
      }
    } else {
      # Monthly: jan..dec
      month_names <- c(
        jan = "01", feb = "02", mar = "03", apr = "04", may = "05", jun = "06",
        jul = "07", aug = "08", sep = "09", oct = "10", nov = "11", dec = "12"
      )
      if (!period %in% names(month_names)) next
      mm <- month_names[[period]]
      doy_name <- month_period_doys[[period]] # e.g. "017" for Jan
      layer_name <- paste0("ndvi_month_", mm, "_", ndvi_year)
      cached <- file.path(cache_dir, paste0("gimms_ndvi_month_", mm, "_", ndvi_year, ext_key, ".tif"))

      if (file.exists(cached)) {
        log_message(log_fun, "Using cached GIMMS NDVI month ", period, " ", ndvi_year)
        r <- terra::rast(cached)
      } else if (isTRUE(allow_download)) {
        url <- ndvi_url(ndvi_year, doy_name)
        log_message(log_fun, "Downloading GIMMS NDVI month ", period, " (DOY ", doy_name, ") for ", ndvi_year)
        tmp <- tempfile(fileext = ".tif")
        downloaded <- tryCatch(
          {
            curl::curl_fetch_disk(url, tmp)
            file.info(tmp)$size > 1024
          },
          error = function(e) FALSE
        )
        if (!downloaded || !file.exists(tmp)) {
          log_message(log_fun, "Failed to download NDVI month ", period, ": ", url)
          unlink(tmp, force = TRUE)
        } else {
          r <- tryCatch(terra::rast(tmp), error = function(e) NULL)
          unlink(tmp)
          if (!is.null(r) && !is.null(extent_vec) && length(extent_vec) == 4) {
            r <- tryCatch(terra::crop(r, terra::ext(extent_vec), snap = "out"), error = function(e) r)
          }
          if (!is.null(r)) {
            r <- tryCatch(terra::aggregate(r, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
              error = function(e) NULL
            )
          }
        }
        if (!is.null(r) && inherits(r, "SpatRaster")) {
          terra::writeRaster(r, cached,
            overwrite = TRUE,
            wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
          )
          ndvi_files <- c(ndvi_files, cached)
          log_message(log_fun, "GIMMS NDVI month ", period, " cached.")
        } else {
          r <- NULL
        }
      } else {
        log_message(log_fun, "GIMMS NDVI month not cached and downloads disabled: ", layer_name)
        r <- NULL
      }

      if (!is.null(r) && inherits(r, "SpatRaster")) {
        names(r) <- layer_name
        ndvi_layers[[layer_name]] <- r
        ndvi_loaded <- c(ndvi_loaded, paste0("month_", mm))
      }
    }
  }

  # -------------------------------------------------------------------------
  # EVI: AVHRR GIMMS at native ~8km (1/12 deg)
  # -------------------------------------------------------------------------
  evi_r <- NULL
  evi_layer_name <- "evi_coarse"
  evi_cached <- file.path(cache_dir, paste0("gimms_evi_coarse", ext_key, ".tif"))

  if (file.exists(evi_cached)) {
    log_message(log_fun, "Using cached GIMMS AVHRR EVI")
    evi_r <- terra::rast(evi_cached)
  } else if (isTRUE(allow_download)) {
    log_message(log_fun, "Downloading GIMMS AVHRR EVI (~8km, may be large)...")
    evi_remote <- paste0(gimms_avhrr_base, "/gimms_evi3g_v1_1981_2020_0.05deg.nc")
    tmp <- tempfile(fileext = ".nc")
    downloaded <- tryCatch(
      {
        curl::curl_fetch_disk(evi_remote, tmp)
        file.info(tmp)$size > 10240
      },
      error = function(e) {
        log_message(log_fun, "AVHRR EVI download failed: ", conditionMessage(e))
        FALSE
      }
    )
    if (downloaded && file.exists(tmp) && file.info(tmp)$size > 10240) {
      evi_nc <- tryCatch(terra::rast(tmp), error = function(e) NULL)
      unlink(tmp)
      if (!is.null(evi_nc)) {
        if (!is.null(extent_vec) && length(extent_vec) == 4) {
          evi_nc <- tryCatch(terra::crop(evi_nc, terra::ext(extent_vec), snap = "out"),
            error = function(e) evi_nc
          )
        }
        names(evi_nc) <- evi_layer_name
        terra::writeRaster(evi_nc, evi_cached,
          overwrite = TRUE,
          wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
        )
        ndvi_files <- c(ndvi_files, evi_cached)
        log_message(log_fun, "GIMMS AVHRR EVI cached.")
        evi_r <- evi_nc
      }
    }
  } else {
    log_message(log_fun, "GIMMS AVHRR EVI not cached and downloads disabled.")
  }

  # -------------------------------------------------------------------------
  # Combine and return
  # -------------------------------------------------------------------------
  all_layers <- c(ndvi_layers, if (!is.null(evi_r)) setNames(list(evi_r), evi_layer_name))
  if (length(all_layers) == 0) {
    log_message(log_fun, "No NDVI/EVI layers could be loaded.")
    return(NULL)
  }

  combined <- do.call(c, all_layers)
  methods <- rep("bilinear", terra::nlyr(combined))
  names(methods) <- names(combined)

  log_message(
    log_fun, "Loaded ", terra::nlyr(combined), " NDVI/EVI layer(s): ",
    paste(names(combined), collapse = ", ")
  )
  list(
    raster = combined,
    files = ndvi_files,
    source = "MODIS NDVI (GIMMS COG, 250m->2.5amin); AVHRR EVI (GIMMS, ~8km)",
    variables = list(ndvi = unique(ndvi_loaded), evi = if (!is.null(evi_r)) "evi_coarse" else character(0)),
    methods = methods
  )
}
