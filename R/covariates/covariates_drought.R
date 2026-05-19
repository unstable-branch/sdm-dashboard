# Cache: <covariate_cache_dir>/drought/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: CRU scPDSI NetCDF (native 0.5 deg); aggregate_factor=3L alignment; bilinear
# API keys: none
# Drought index covariates from CRU scPDSI (Self-Calibrating Palmer Drought Severity Index).
# Resolution: 0.5 degree (~55km). Annual mean and seasonal values.
# No auth required. NetCDF format — terra reads natively.

# CRU scPDSI available variables in the NetCDF:
# pdsi    — raw PDSI values
# phid    — Palmer Hydrological Drought Index
# scpdsi  — self-calibrating PDSI
# The NetCDF typically contains multiple time steps (monthly or seasonal)

load_drought_covariate <- function(selected_periods = "annual_mean",
                                   extent_vec = NULL,
                                   aggregate_factor = 3L,
                                   covariate_cache_dir = sdm_default_covariate_cache_dir,
                                   allow_download = TRUE,
                                   log_fun = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for drought downloads. Install with: install.packages('curl')")
  }

  # CRU scPDSI file — direct URL
  scpdsi_remote <- "https://crudata.uea.ac.uk/cru/data/drought/scpdsi.global2024.readme.txt"
  scpdsi_file <- "scPDSI.cru_ts4.09early1.1901.2024.cal_1901_24.bams.2025.GLOBAL.IGBP.WHC.1901.2024.nc"
  scpdsi_url <- paste0("https://crudata.uea.ac.uk/cru/data/drought/", scpdsi_file)

  cache_dir <- file.path(covariate_cache_dir, "drought")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  ext_key <- ""
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext_key <- paste0("_", paste(round(extent_vec, 1), collapse = "_"))
  }

  cached_annual <- file.path(cache_dir, paste0("scpdsi_annual", ext_key, ".tif"))
  cached_wet <- file.path(cache_dir, paste0("scpdsi_wet_season", ext_key, ".tif"))
  cached_dry <- file.path(cache_dir, paste0("scpdsi_dry_season", ext_key, ".tif"))

  periods <- unique(as.character(selected_periods))
  periods <- periods[periods %in% c("annual_mean", "wet_season", "dry_season")]
  if (length(periods) == 0) periods <- "annual_mean"

  layers <- list()
  layer_files <- character(0)
  loaded_vars <- character(0)

  for (period in periods) {
    cached <- switch(period,
      "annual_mean" = cached_annual,
      "wet_season" = cached_wet,
      "dry_season" = cached_dry
    )

    if (file.exists(cached)) {
      log_message(log_fun, "Using cached scPDSI ", period)
      r <- terra::rast(cached)
      if (!is.null(extent_vec) && length(extent_vec) == 4) {
        r <- tryCatch(terra::crop(r, terra::ext(extent_vec), snap = "out"), error = function(e) r)
      }
      if (!is.null(r) && inherits(r, "SpatRaster")) {
        names(r) <- paste0("scpdsi_", period)
        layers[[paste0("scpdsi_", period)]] <- r
        layer_files <- c(layer_files, cached)
        loaded_vars <- c(loaded_vars, period)
      }
    }
  }

  if (length(layers) == length(periods)) {
    combined <- do.call(c, layers)
    methods <- setNames(rep("bilinear", terra::nlyr(combined)), names(combined))
    log_message(log_fun, "Loaded ", terra::nlyr(combined), " scPDSI layer(s): ", paste(names(combined), collapse = ", "))
    return(list(raster = combined, files = layer_files, source = "CRU scPDSI v4.09 (0.5 deg, 1901-2024) via crudata.uea.ac.uk", variables = list(scpdsi = loaded_vars), methods = methods))
  }

  if (!isTRUE(allow_download)) {
    log_message(log_fun, "scPDSI not fully cached and downloads disabled.")
    if (length(layers) == 0) return(NULL)
    combined <- do.call(c, layers)
    methods <- setNames(rep("bilinear", terra::nlyr(combined)), names(combined))
    return(list(raster = combined, files = layer_files, source = "CRU scPDSI v4.09 (0.5 deg, 1901-2024) via crudata.uea.ac.uk", variables = list(scpdsi = loaded_vars), methods = methods))
  }

  log_message(log_fun, "Downloading CRU scPDSI annual data from CRU...")
  tmp <- tempfile(fileext = ".nc")
  ok <- tryCatch(
    {
      curl::curl_fetch_disk(scpdsi_url, tmp)
      fi <- file.info(tmp)
      !is.na(fi$size) && fi$size > 10240
    },
    error = function(e) FALSE
  )

  if (!ok || !file.exists(tmp) || file.info(tmp)$size < 10240) {
    log_message(log_fun, "CRU scPDSI download failed. URL: ", scpdsi_url)
    if (file.exists(tmp)) unlink(tmp, force = TRUE)
    if (length(layers) == 0) return(NULL)
    combined <- do.call(c, layers)
    methods <- setNames(rep("bilinear", terra::nlyr(combined)), names(combined))
    return(list(raster = combined, files = layer_files, source = "CRU scPDSI v4.09 (0.5 deg, 1901-2024) via crudata.uea.ac.uk", variables = list(scpdsi = loaded_vars), methods = methods))
  }

  log_message(log_fun, "Processing CRU scPDSI NetCDF...")
  nc_rast <- tryCatch(terra::rast(tmp), error = function(e) NULL)
  unlink(tmp)

  if (is.null(nc_rast)) {
    log_message(log_fun, "Failed to read CRU scPDSI NetCDF.")
    if (length(layers) == 0) return(NULL)
    combined <- do.call(c, layers)
    methods <- setNames(rep("bilinear", terra::nlyr(combined)), names(combined))
    return(list(raster = combined, files = layer_files, source = "CRU scPDSI v4.09 (0.5 deg, 1901-2024) via crudata.uea.ac.uk", variables = list(scpdsi = loaded_vars), methods = methods))
  }

  log_message(log_fun, "scPDSI layers available: ", paste(names(nc_rast), collapse = ", "))

  use_layer <- if ("scpdsi" %in% names(nc_rast)) {
    "scpdsi"
  } else if ("pdsi" %in% names(nc_rast)) {
    "pdsi"
  } else {
    names(nc_rast)[1]
  }

  r_raw <- nc_rast[[use_layer]]
  names(r_raw) <- use_layer

  nl <- terra::nlyr(r_raw)
  if (nl > 1) {
    r_annual <- terra::app(r_raw, fun = "mean", na.rm = TRUE)
  } else {
    r_annual <- r_raw
  }
  names(r_annual) <- "scpdsi_annual"

  if (nl >= 12) {
    month_idx <- 1:12
    r_wet <- terra::app(terra::subset(r_raw, month_idx[c(12, 1, 2)]), fun = "mean", na.rm = TRUE)
    r_dry <- terra::app(terra::subset(r_raw, month_idx[6:8]), fun = "mean", na.rm = TRUE)
  } else {
    r_wet <- r_annual
    r_dry <- r_annual
  }

  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext <- terra::ext(extent_vec[1], extent_vec[2], extent_vec[3], extent_vec[4])
    r_annual <- tryCatch(terra::crop(r_annual, ext, snap = "out"), error = function(e) r_annual)
    r_wet <- tryCatch(terra::crop(r_wet, ext, snap = "out"), error = function(e) r_wet)
    r_dry <- tryCatch(terra::crop(r_dry, ext, snap = "out"), error = function(e) r_dry)
  }

  if (!is.null(aggregate_factor) && aggregate_factor > 1L) {
    af <- as.integer(aggregate_factor)
    if (af > 1L) {
      r_annual <- tryCatch(terra::aggregate(r_annual, fact = af, fun = "mean", na.rm = TRUE), error = function(e) r_annual)
      r_wet <- tryCatch(terra::aggregate(r_wet, fact = af, fun = "mean", na.rm = TRUE), error = function(e) r_wet)
      r_dry <- tryCatch(terra::aggregate(r_dry, fact = af, fun = "mean", na.rm = TRUE), error = function(e) r_dry)
    }
  }

  if ("annual_mean" %in% periods && !file.exists(cached_annual)) {
    names(r_annual) <- "scpdsi_annual"
    terra::writeRaster(r_annual, cached_annual, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    layers[["scpdsi_annual"]] <- r_annual
    layer_files <- c(layer_files, cached_annual)
    loaded_vars <- c(loaded_vars, "annual")
  }

  if ("wet_season" %in% periods && !file.exists(cached_wet)) {
    names(r_wet) <- "scpdsi_wet"
    terra::writeRaster(r_wet, cached_wet, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    layers[["scpdsi_wet"]] <- r_wet
    layer_files <- c(layer_files, cached_wet)
    loaded_vars <- c(loaded_vars, "wet_season")
  }

  if ("dry_season" %in% periods && !file.exists(cached_dry)) {
    names(r_dry) <- "scpdsi_dry"
    terra::writeRaster(r_dry, cached_dry, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    layers[["scpdsi_dry"]] <- r_dry
    layer_files <- c(layer_files, cached_dry)
    loaded_vars <- c(loaded_vars, "dry_season")
  }

  if (length(layers) == 0) {
    log_message(log_fun, "No scPDSI layers could be loaded.")
    return(NULL)
  }

  combined <- do.call(c, layers)
  methods <- setNames(rep("bilinear", terra::nlyr(combined)), names(combined))

  log_message(
    log_fun, "Loaded ", terra::nlyr(combined), " scPDSI layer(s): ",
    paste(names(combined), collapse = ", ")
  )

  list(
    raster = combined,
    files = layer_files,
    source = "CRU scPDSI v4.09 (0.5 deg, 1901-2024) via crudata.uea.ac.uk",
    variables = list(scpdsi = loaded_vars),
    methods = methods
  )
}
