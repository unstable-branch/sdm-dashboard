# Cache: <covariate_cache_dir>/human_footprint/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: Google Cloud Storage (no auth); aggregate_factor=18L alignment to climate resolution
# API keys: none
# WCS Human Footprint via Google Cloud Storage — no auth required.
# Resolution: ~300m, global, annual 2001-2020.

hii_base_url <- "https://storage.googleapis.com/hii-export"

hii_url <- function(year) {
  paste0(hii_base_url, "/", year, "-01-01/hii_", year, "-01-01.tif")
}

load_human_footprint_covariate <- function(hfp_year = 2020,
                                           extent_vec = NULL,
                                           aggregate_factor = 18L,
                                           covariate_cache_dir = sdm_default_covariate_cache_dir,
                                           allow_download = TRUE,
                                           log_fun = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for Human Footprint downloads. Install with: install.packages('curl')", call. = FALSE)
  }

  hfp_year <- as.integer(hfp_year[1])
  if (is.na(hfp_year) || hfp_year < 2001 || hfp_year > 2020) {
    log_message(log_fun, "Human Footprint year ", hfp_year, " out of range (2001-2020). Using 2020.")
    hfp_year <- 2020
  }

  cache_dir <- file.path(covariate_cache_dir, "human_footprint")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  ext_key <- ""
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext_key <- paste0("_", paste(round(extent_vec, 1), collapse = "_"))
  }
  cached_file <- file.path(cache_dir, paste0("hfp_", hfp_year, ext_key, ".tif"))

  if (file.exists(cached_file)) {
    log_message(log_fun, "Using cached Human Footprint for ", hfp_year)
    r <- terra::rast(cached_file)
    if (!is.null(extent_vec) && length(extent_vec) == 4) {
      r <- tryCatch(terra::crop(r, terra::ext(extent_vec), snap = "out"), error = function(e) r)
    }
    return(list(
      raster = r, files = cached_file,
      source = "WCS Human Footprint (Vizzuality/WCS) via Google Cloud",
      variables = list(hfp = paste0("hfp_", hfp_year)),
      methods = c(hfp = "bilinear")
    ))
  }

  if (!isTRUE(allow_download)) {
    log_message(log_fun, "Human Footprint not cached and downloads disabled.")
    return(NULL)
  }

  url <- hii_url(hfp_year)
  log_message(log_fun, "Downloading Human Footprint ", hfp_year, " from Google Cloud Storage...")

  tmp <- tempfile(fileext = ".tif")
  ok <- tryCatch(
    {
      handle <- curl::new_handle(timeout = 300)
      curl::curl_fetch_disk(url, tmp, handle = handle)
      fi <- file.info(tmp)
      !is.na(fi$size) && fi$size > 1024
    },
    error = function(e) FALSE
  )

  if (!ok || !file.exists(tmp) || file.info(tmp)$size < 1024) {
    log_message(log_fun, "Human Footprint download failed for year ", hfp_year, ". URL: ", url)
    if (file.exists(tmp)) unlink(tmp, force = TRUE)
    return(NULL)
  }

  log_message(log_fun, "Human Footprint downloaded (", round(file.info(tmp)$size / 1e6, 1), " MB). Processing...")

  r <- tryCatch(terra::rast(tmp), error = function(e) NULL)
  unlink(tmp)

  if (is.null(r)) {
    log_message(log_fun, "Failed to read Human Footprint raster.")
    return(NULL)
  }

  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    r <- tryCatch(terra::crop(r, terra::ext(extent_vec), snap = "out"), error = function(e) r)
  }

  if (!is.null(aggregate_factor) && aggregate_factor > 1L) {
    af <- as.integer(aggregate_factor)
    if (af > 1L) {
      r <- tryCatch(terra::aggregate(r, fact = af, fun = "mean", na.rm = TRUE),
        error = function(e) r
      )
    }
  }

  names(r) <- paste0("hfp_", hfp_year)

  terra::writeRaster(r, cached_file,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
  )
  log_message(log_fun, "Human Footprint cached: ", names(r))

  list(
    raster = r, files = cached_file,
    source = "WCS Human Footprint (Vizzuality/WCS) via Google Cloud",
    variables = list(hfp = paste0("hfp_", hfp_year)),
    methods = c(hfp = "bilinear")
  )
}
