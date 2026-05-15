# Cache: <covariate_cache_dir>/vegetation/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: GIMMS NDVI/EVI (250m MODIS/8km AVHRR) aggregated via aggregate_factor=18L to climate res; GEE LAI/GPP similarly aggregated
# API keys: GEE credentials optional (rgee); no auth required for GIMMS
# Vegetation productivity indices loader.
# Combines:
#   - NDVI / EVI from GIMMS (direct download, no auth required)
#   - LAI and GPP from Google Earth Engine via rgee (requires GEE authentication)
# All layers are aggregated to the climate covariate resolution (~2.5 arc-min).

# ---------------------------------------------------------------------------
# GIMMS NDVI/EVI (from covariates_ndvi.R — kept in-line for cohesion)
# ---------------------------------------------------------------------------

gimms_ndvi_doy <- gimms_doy_map()
month_period_doys <- sapply(1:12, function(m) doy_for_month(m))
names(month_period_doys) <- month.abb

gimms_cog_base <- "https://gimms.gsfc.nasa.gov/MODIS/std/GMOD09Q1/cog/NDVI"
gimms_avhrr_base <- "https://gimms.gsfc.nasa.gov/AVHRR/gimms006nc"

ndvi_url <- function(year, doy) {
  paste0(gimms_cog_base, "/", year, "/", doy, "/",
         "GMOD09Q1.A", year, doy, ".08d.latlon.global.061.NDVI.tif")
}

ndvi_mean_url <- function(doy) {
  paste0(gimms_cog_base, "_mean_S2001-2024/", doy, "/",
         "GMOD09Q1.A2001-2024", doy, ".08d.latlon.global.061.NDVI_mean.tif")
}

# ---------------------------------------------------------------------------
# GEE helpers
# ---------------------------------------------------------------------------

gee_is_initialized <- function() {
  if (!requireNamespace("rgee", quietly = TRUE)) return(FALSE)
  tryCatch({
    rgee::ee_check()
    TRUE
  }, error = function(e) FALSE)
}

gee_ensure_initialized <- function(log_fun = NULL) {
  if (!requireNamespace("rgee", quietly = TRUE)) {
    log_message(log_fun, "rgee is not installed. Install with: install.packages('rgee')")
    return(FALSE)
  }
  tryCatch({
    rgee::ee_check()
    TRUE
  }, error = function(e) {
    log_message(log_fun, "GEE not initialized: ", conditionMessage(e),
                ". Run rgee::ee_initialize() or set up credentials.")
    FALSE
  })
}

gee_lai_collection <- function() "MODIS/061/MCD15A2H"
gee_gpp_collection <- function() "MODIS/061/MOD17A2HGF"

gee_extract_vegetation <- function(extent_vec, year, products,
                                   aggregate_factor = 18L,
                                   cache_dir, log_fun = NULL) {
  if (!gee_ensure_initialized(log_fun)) return(list())

  tryCatch({
    geom <- rgee::ee$Geometry$Rectangle(
      c(extent_vec[1], extent_vec[3], extent_vec[2], extent_vec[4])
    )
    start_date <- paste0(year, "-01-01")
    end_date <- paste0(year, "-12-31")

    layers <- list()

    if ("lai" %in% products) {
      log_message(log_fun, "Fetching GEE LAI (MCD15A2H) for ", year)
      col <- rgee::ee$ImageCollection(gee_lai_collection())$
        filterDate(start_date, end_date)$
        filterBounds(geom)$
        select("Lai")
      img <- col$median()
      scale <- img$projection()$nominalScale()$getInfo()
      downloaded <- tryCatch({
        out_file <- file.path(cache_dir, paste0("gee_lai_", year, "_tmp.tif"))
        rgee::ee_as_image(img, filename = out_file, scale = max(scale, 500),
                          region = geom, via = "drive", quiet = TRUE)
        file.exists(out_file) && file.info(out_file)$size > 1000
      }, error = function(e) {
        log_message(log_fun, "LAI download failed: ", conditionMessage(e))
        FALSE
      })
      if (downloaded) {
        r <- terra::rast(file.path(cache_dir, paste0("gee_lai_", year, "_tmp.tif")))
        r_agg <- terra::aggregate(r, fact = aggregate_factor, fun = "mean", na.rm = TRUE)
        names(r_agg) <- paste0("lai_", year)
        layers[[paste0("lai_", year)]] <- r_agg
        unlink(file.path(cache_dir, paste0("gee_lai_", year, "_tmp.tif")), force = TRUE)
      }
    }

    if ("gpp" %in% products) {
      log_message(log_fun, "Fetching GEE GPP (MOD17A2HGF) for ", year)
      col <- rgee::ee$ImageCollection(gee_gpp_collection())$
        filterDate(start_date, end_date)$
        filterBounds(geom)$
        select("Gpp")
      img <- col$median()
      scale <- img$projection()$nominalScale()$getInfo()
      downloaded <- tryCatch({
        out_file <- file.path(cache_dir, paste0("gee_gpp_", year, "_tmp.tif"))
        rgee::ee_as_image(img, filename = out_file, scale = max(scale, 500),
                          region = geom, via = "drive", quiet = TRUE)
        file.exists(out_file) && file.info(out_file)$size > 1000
      }, error = function(e) {
        log_message(log_fun, "GPP download failed: ", conditionMessage(e))
        FALSE
      })
      if (downloaded) {
        r <- terra::rast(file.path(cache_dir, paste0("gee_gpp_", year, "_tmp.tif")))
        r_agg <- terra::aggregate(r, fact = aggregate_factor, fun = "mean", na.rm = TRUE)
        names(r_agg) <- paste0("gpp_", year)
        layers[[paste0("gpp_", year)]] <- r_agg
        unlink(file.path(cache_dir, paste0("gee_gpp_", year, "_tmp.tif")), force = TRUE)
      }
    }

    layers
  }, error = function(e) {
    log_message(log_fun, "GEE extraction error: ", conditionMessage(e))
    list()
  })
}

# ---------------------------------------------------------------------------
# GIMMS NDVI/EVI (inline from original covariates_ndvi.R)
# ---------------------------------------------------------------------------

load_gimms_ndvi_period <- function(period, ndvi_year, extent_vec,
                                   aggregate_factor, cache_dir,
                                   allow_download, log_fun) {
  doy_name <- month_period_doys[[period]]
  layer_name <- paste0("ndvi_month_", period, "_", ndvi_year)
  cached <- file.path(cache_dir, paste0("gimms_ndvi_", period, "_", ndvi_year, ".tif"))

  if (file.exists(cached)) {
    log_message(log_fun, "Using cached GIMMS NDVI ", period, " for ", ndvi_year)
    r <- terra::rast(cached)
  } else if (isTRUE(allow_download)) {
    url <- ndvi_url(ndvi_year, doy_name)
    log_message(log_fun, "Downloading GIMMS NDVI month ", period, " (DOY ", doy_name, ") for ", ndvi_year)
    tmp <- tempfile(fileext = ".tif")
    downloaded <- tryCatch({
      curl::curl_fetch_disk(url, tmp)
      file.info(tmp)$size > 1024
    }, error = function(e) FALSE)
    if (!downloaded || !file.exists(tmp)) {
      log_message(log_fun, "Failed to download NDVI month ", period, ": ", url)
      unlink(tmp, force = TRUE)
      return(NULL)
    }
    r <- tryCatch(terra::rast(tmp), error = function(e) NULL)
    unlink(tmp)
    if (is.null(r)) return(NULL)
    if (!is.null(extent_vec) && length(extent_vec) == 4) {
      r <- tryCatch(terra::crop(r, terra::ext(extent_vec), snap = "out"), error = function(e) r)
    }
    r <- tryCatch(terra::aggregate(r, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
                   error = function(e) NULL)
    if (!is.null(r)) {
      terra::writeRaster(r, cached, overwrite = TRUE,
                        wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
      log_message(log_fun, "GIMMS NDVI month ", period, " cached.")
    }
  } else {
    log_message(log_fun, "GIMMS NDVI month not cached and downloads disabled.")
    return(NULL)
  }
  if (!is.null(r) && inherits(r, "SpatRaster")) {
    names(r) <- layer_name
  }
  r
}

load_gimms_evi <- function(extent_vec, cache_dir, allow_download, log_fun) {
  evi_layer_name <- "evi_coarse"
  evi_cached <- file.path(cache_dir, "gimms_evi_coarse.tif")

  if (file.exists(evi_cached)) {
    log_message(log_fun, "Using cached GIMMS AVHRR EVI")
    evi_r <- terra::rast(evi_cached)
  } else if (isTRUE(allow_download)) {
    evi_remote <- paste0(gimms_avhrr_base, "/gimms_evi3g_v1_1981_2020_0.05deg.nc")
    tmp <- tempfile(fileext = ".nc")
    log_message(log_fun, "Downloading GIMMS AVHRR EVI (~8km, may be large)...")
    downloaded <- tryCatch({
      curl::curl_fetch_disk(evi_remote, tmp)
      file.info(tmp)$size > 10240
    }, error = function(e) {
      log_message(log_fun, "AVHRR EVI download failed: ", conditionMessage(e))
      FALSE
    })
    if (downloaded && file.exists(tmp) && file.info(tmp)$size > 10240) {
      evi_nc <- tryCatch(terra::rast(tmp), error = function(e) NULL)
      unlink(tmp)
      if (!is.null(evi_nc)) {
        if (!is.null(extent_vec) && length(extent_vec) == 4) {
          evi_nc <- tryCatch(terra::crop(evi_nc, terra::ext(extent_vec), snap = "out"),
                             error = function(e) evi_nc)
        }
        names(evi_nc) <- evi_layer_name
        terra::writeRaster(evi_nc, evi_cached, overwrite = TRUE,
                          wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
        log_message(log_fun, "GIMMS AVHRR EVI cached.")
        evi_r <- evi_nc
      }
    } else {
      evi_r <- NULL
    }
  } else {
    log_message(log_fun, "GIMMS AVHRR EVI not cached and downloads disabled.")
    evi_r <- NULL
  }
  if (!is.null(evi_r) && inherits(evi_r, "SpatRaster")) {
    names(evi_r) <- evi_layer_name
  }
  evi_r
}

# ---------------------------------------------------------------------------
# Main unified loader
# ---------------------------------------------------------------------------

load_vegetation_covariate <- function(
    veg_year = NULL,
    selected_products = NULL,
    extent_vec = NULL,
    aggregate_factor = 18L,
    covariate_cache_dir = sdm_default_covariate_cache_dir,
    allow_download = TRUE,
    log_fun = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for vegetation downloads. Install with: install.packages('curl')")
  }

  current_year <- as.integer(format(Sys.Date(), "%Y"))
  veg_year <- suppressWarnings(as.integer(veg_year[1]))
  if (is.na(veg_year) || veg_year < 2000 || veg_year > current_year) {
    veg_year <- current_year - 1L
  }

  selected_products <- unique(as.character(selected_products))
  selected_products <- selected_products[nzchar(selected_products)]
  if (length(selected_products) == 0) {
    log_message(log_fun, "Vegetation selected but no products were chosen.")
    return(NULL)
  }

  cache_dir <- file.path(covariate_cache_dir, "vegetation")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  layers <- list()
  files_used <- character(0)

  # --- NDVI periods ---
  ndvi_periods <- c("annual_mean", "annual_max", "gimms_clim",
                    "jan","feb","mar","apr","may","jun",
                    "jul","aug","sep","oct","nov","dec")
  ndvi_selected <- intersect(selected_products, ndvi_periods)
  has_ndvi <- length(ndvi_selected) > 0

  # --- EVI ---
  has_evi <- "evi" %in% selected_products

  # --- LAI and GPP ---
  has_lai <- "lai" %in% selected_products
  has_gpp <- "gpp" %in% selected_products
  has_gee <- has_lai || has_gpp

  # ---- NDVI ----
  if (has_ndvi) {
    log_message(log_fun, "Loading NDVI for year ", veg_year, " (", length(ndvi_selected), " period(s))")

    for (period in ndvi_selected) {
      if (identical(period, "gimms_clim")) {
        clim_cached <- file.path(cache_dir, "gimms_ndvi_clim.tif")
        if (file.exists(clim_cached)) {
          log_message(log_fun, "Using cached GIMMS climatology NDVI")
          r <- terra::rast(clim_cached)
        } else if (isTRUE(allow_download)) {
          log_message(log_fun, "Downloading GIMMS NDVI climatology (46 tiles)")
          tiles <- list()
          for (doy_nm in names(gimms_ndvi_doy)) {
            doy_url <- ndvi_mean_url(doy_nm)
            tmp <- tempfile(fileext = ".tif")
            downloaded <- tryCatch({
              curl::curl_fetch_disk(doy_url, tmp)
              file.info(tmp)$size > 1024
            }, error = function(e) FALSE)
            if (!downloaded) {
              log_message(log_fun, "  Failed DOY ", doy_nm)
              next
            }
            t <- tryCatch(terra::rast(tmp), error = function(e) NULL)
            unlink(tmp)
            if (is.null(t)) next
            if (!is.null(extent_vec) && length(extent_vec) == 4) {
              t <- tryCatch(terra::crop(t, terra::ext(extent_vec), snap = "out"),
                           error = function(e) t)
            }
            t_agg <- tryCatch(terra::aggregate(t, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
                              error = function(e) NULL)
            if (!is.null(t_agg)) tiles[[doy_nm]] <- t_agg
          }
          if (length(tiles) == 0) {
            log_message(log_fun, "No climatology tiles loaded.")
          } else {
            r <- terra::app(do.call(c, tiles), fun = "mean", na.rm = TRUE)
            terra::writeRaster(r, clim_cached, overwrite = TRUE,
                              wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
            log_message(log_fun, "GIMMS NDVI climatology cached (", length(tiles), " tiles).")
          }
        } else {
          log_message(log_fun, "GIMMS climatology not cached, downloads disabled.")
          r <- NULL
        }
        if (!is.null(r) && inherits(r, "SpatRaster")) {
          names(r) <- "ndvi_gimms_clim"
          layers[["ndvi_gimms_clim"]] <- r
        }

      } else if (identical(period, "annual_mean") || identical(period, "annual_max")) {
        cached_ann <- file.path(cache_dir, paste0("gimms_ndvi_", period, "_", veg_year, ".tif"))
        if (file.exists(cached_ann)) {
          log_message(log_fun, "Using cached GIMMS NDVI ", period, " for ", veg_year)
          r <- terra::rast(cached_ann)
        } else if (isTRUE(allow_download)) {
          log_message(log_fun, "Downloading GIMMS NDVI ", period, " for ", veg_year, " (46 periods)...")
          tiles <- list()
          for (doy_nm in names(gimms_ndvi_doy)) {
            url <- ndvi_url(veg_year, doy_nm)
            tmp <- tempfile(fileext = ".tif")
            downloaded <- tryCatch({
              curl::curl_fetch_disk(url, tmp)
              file.info(tmp)$size > 1024
            }, error = function(e) FALSE)
            if (!downloaded) { unlink(tmp, force = TRUE); next }
            t <- tryCatch(terra::rast(tmp), error = function(e) NULL)
            unlink(tmp)
            if (is.null(t)) next
            if (!is.null(extent_vec) && length(extent_vec) == 4) {
              t <- tryCatch(terra::crop(t, terra::ext(extent_vec), snap = "out"),
                           error = function(e) t)
            }
            t_agg <- tryCatch(terra::aggregate(t, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
                              error = function(e) NULL)
            if (!is.null(t_agg)) tiles[[doy_nm]] <- t_agg
          }
          if (length(tiles) == 0) {
            log_message(log_fun, "No NDVI tiles loaded for year ", veg_year, ".")
          } else {
            stack <- do.call(c, tiles)
            r <- if (identical(period, "annual_mean")) {
              terra::app(stack, fun = "mean", na.rm = TRUE)
            } else {
              terra::app(stack, fun = "max", na.rm = TRUE)
            }
            terra::writeRaster(r, cached_ann, overwrite = TRUE,
                              wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
            log_message(log_fun, "GIMMS NDVI ", period, " cached (", length(tiles), " tiles).")
          }
        } else {
          log_message(log_fun, "NDVI not cached and downloads disabled.")
          r <- NULL
        }
        if (!is.null(r) && inherits(r, "SpatRaster")) {
          nm <- paste0("ndvi_", if (identical(period, "annual_mean")) "annual_" else "max_", veg_year)
          names(r) <- nm
          layers[[nm]] <- r
        }

      } else {
        r <- load_gimms_ndvi_period(period, veg_year, extent_vec,
                                     aggregate_factor, cache_dir, allow_download, log_fun)
        if (!is.null(r)) layers[[names(r)[1]]] <- r
      }
    }
  }

  # ---- EVI ----
  if (has_evi) {
    evi_r <- load_gimms_evi(extent_vec, cache_dir, allow_download, log_fun)
    if (!is.null(evi_r)) layers[["evi_coarse"]] <- evi_r
  }

  # ---- LAI / GPP via GEE ----
  if (has_gee) {
    gee_products <- character(0)
    if (has_lai) gee_products <- c(gee_products, "lai")
    if (has_gpp) gee_products <- c(gee_products, "gpp")
    gee_layers <- gee_extract_vegetation(extent_vec, veg_year, gee_products,
                                         aggregate_factor, cache_dir, log_fun)
    for (nm in names(gee_layers)) layers[[nm]] <- gee_layers[[nm]]
  }

  if (length(layers) == 0) {
    log_message(log_fun, "No vegetation layers could be loaded.")
    return(NULL)
  }

  combined <- do.call(c, layers)
  methods_vec <- rep("bilinear", terra::nlyr(combined))
  names(methods_vec) <- names(combined)

  veg_products <- c(
    if (has_ndvi) "ndvi" else character(),
    if (has_evi) "evi" else character(),
    if (has_lai) "lai" else character(),
    if (has_gpp) "gpp" else character()
  )

  list(
    raster = combined,
    files = files_used,
    source = paste0("NDVI/EVI: GIMMS NASA (MODIS 250m/AVHRR 8km); LAI/GPP: GEE MODIS (500m/1km)"),
    variables = list(products = veg_products),
    methods = methods_vec
  )
}