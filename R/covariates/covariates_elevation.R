# Cache: <covariate_cache_dir>/opentopo/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: Uses extent_vec directly; DEM resampling via bilinear after cache load
# API keys: OPENTOPOGRAPHY_API_KEY required for live downloads
# OpenTopography elevation covariate support.

compute_terrain_metrics <- function(dem, neighbors = 8) {
  tri <- terra::terrain(dem, v = "TRI", neighbors = neighbors)
  names(tri) <- "terrain_ruggedness"
  slope <- terra::terrain(dem, v = "slope", unit = "degrees", neighbors = neighbors)
  names(slope) <- "terrain_slope"
  aspect <- terra::terrain(dem, v = "aspect", unit = "degrees", neighbors = neighbors)
  names(aspect) <- "terrain_aspect"
  aspect_sin <- sin(pi * aspect / 180)
  aspect_cos <- cos(pi * aspect / 180)
  names(aspect_sin) <- "terrain_aspect_sin"
  names(aspect_cos) <- "terrain_aspect_cos"
  curv <- terra::terrain(dem, v = "curvature", neighbors = neighbors)
  names(curv) <- "terrain_curvature"
  c(tri, slope, aspect, aspect_sin, aspect_cos, curv)
}

opentopo_dem_choices <- c(
  "Copernicus 90m" = "COP90",
  "SRTM 90m" = "SRTMGL3",
  "Copernicus 30m" = "COP30",
  "SRTM 30m" = "SRTMGL1",
  "NASADEM" = "NASADEM",
  "ALOS World 3D 30m" = "AW3D30"
)

opentopo_tile_size_degrees <- function(demtype) {
  demtype <- as.character(demtype)
  if (demtype %in% c("SRTMGL1", "SRTMGL1_E", "AW3D30", "AW3D30_E", "COP30", "NASADEM")) {
    return(4)
  }
  if (demtype %in% c("SRTMGL3", "COP90", "EU_DTM")) {
    return(10)
  }
  20
}

opentopo_api_key <- function(api_key = NULL) {
  if (!is.null(api_key) && length(api_key) > 0 && nzchar(trimws(api_key[1]))) {
    return(trimws(api_key[1]))
  }
  Sys.getenv("OPENTOPOGRAPHY_API_KEY", unset = "")
}

opentopo_globaldem_url <- function(extent_vec, demtype = sdm_default_elevation_demtype, api_key = NULL) {
  key <- opentopo_api_key(api_key)
  if (!nzchar(key)) return(NA_character_)
  params <- list(
    demtype = demtype,
    south = extent_vec[3],
    north = extent_vec[4],
    west = extent_vec[1],
    east = extent_vec[2],
    outputFormat = "GTiff",
    API_Key = key
  )
  query <- paste(
    paste0(names(params), "=", vapply(params, function(x) utils::URLencode(as.character(x), reserved = TRUE), character(1))),
    collapse = "&"
  )
  paste0("https://portal.opentopography.org/API/globaldem?", query)
}

opentopo_cache_file <- function(cache_dir, demtype, extent_vec) {
  file.path(cache_dir, "opentopo", paste0(demtype, "_", extent_cache_key(extent_vec), ".tif"))
}

opentopo_tile_extents <- function(extent_vec, demtype = sdm_default_elevation_demtype) {
  step <- opentopo_tile_size_degrees(demtype)
  x_breaks <- unique(c(seq(extent_vec[1], extent_vec[2], by = step), extent_vec[2]))
  y_breaks <- unique(c(seq(extent_vec[3], extent_vec[4], by = step), extent_vec[4]))
  if (tail(x_breaks, 1) < extent_vec[2]) x_breaks <- c(x_breaks, extent_vec[2])
  if (tail(y_breaks, 1) < extent_vec[4]) y_breaks <- c(y_breaks, extent_vec[4])
  tiles <- list()
  idx <- 1L
  for (xi in seq_len(length(x_breaks) - 1L)) {
    for (yi in seq_len(length(y_breaks) - 1L)) {
      tile <- c(x_breaks[xi], x_breaks[xi + 1L], y_breaks[yi], y_breaks[yi + 1L])
      if (tile[1] < tile[2] && tile[3] < tile[4]) {
        tiles[[idx]] <- tile
        idx <- idx + 1L
      }
    }
  }
  tiles
}

download_opentopo_tile <- function(tile_extent, demtype, api_key, destfile, max_retries = 3) {
  url <- opentopo_globaldem_url(tile_extent, demtype = demtype, api_key = api_key)
  if (is.na(url)) stop("OpenTopography API key is required to download DEM data.", call. = FALSE)
  last_error <- NULL
  for (attempt in seq_len(max_retries)) {
    result <- suppressWarnings(try(utils::download.file(url, destfile, mode = "wb", quiet = TRUE), silent = TRUE))
    ok <- !inherits(result, "try-error") && file.exists(destfile) && {
      fi <- file.info(destfile)
      is.finite(fi$size) && fi$size > 1024
    }
    if (ok) {
      return(invisible(destfile))
    }
    if (file.exists(destfile)) unlink(destfile)
    last_error <- "download failed or file too small"
    if (attempt < max_retries) Sys.sleep(2^attempt)
  }
  stop("OpenTopography download failed after ", max_retries, " attempts: ", last_error, call. = FALSE)
}

download_opentopo_dem <- function(extent_vec, demtype, cache_file, api_key = NULL, log_fun = NULL) {
  key <- opentopo_api_key(api_key)
  if (!nzchar(key)) stop("Elevation selected but no OpenTopography API key was provided.", call. = FALSE)
  dir.create(dirname(cache_file), recursive = TRUE, showWarnings = FALSE)
  tiles <- opentopo_tile_extents(extent_vec, demtype)
  tile_dir <- tempfile("opentopo_tiles_")
  dir.create(tile_dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(tile_dir, recursive = TRUE, force = TRUE), add = TRUE)

  log_message(log_fun, "Downloading elevation from OpenTopography as ", length(tiles), " tile(s); DEM = ", demtype)
  tile_files <- character(length(tiles))
  for (i in seq_along(tiles)) {
    tile_files[i] <- file.path(tile_dir, paste0("tile_", i, ".tif"))
    download_opentopo_tile(tiles[[i]], demtype, key, tile_files[i])
  }

  rasters <- lapply(tile_files, terra::rast)
  dem <- if (length(rasters) == 1L) rasters[[1L]] else do.call(terra::merge, rasters)
  dem <- terra::crop(dem, terra::ext(extent_vec[1], extent_vec[2], extent_vec[3], extent_vec[4]), snap = "out")
  names(dem) <- "elevation_m"
  terra::writeRaster(dem, cache_file, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES")))
  cache_file
}

load_elevation_covariate <- function(training_extent, projection_extent, cache_dir = sdm_default_covariate_cache_dir,
                                     demtype = sdm_default_elevation_demtype, api_key = NULL, allow_download = TRUE,
                                     log_fun = NULL) {
  extent_vec <- validate_extent(combine_extents(training_extent, projection_extent), "elevation extent")
  cache_file <- opentopo_cache_file(cache_dir, demtype, extent_vec)
  if (!file.exists(cache_file)) {
    if (!allow_download) {
      log_message(log_fun, "Elevation selected but cached DEM is missing and downloads are disabled: ", cache_file)
      return(NULL)
    }
    key <- opentopo_api_key(api_key)
    if (!nzchar(key)) {
      log_message(log_fun, "Elevation selected but no OpenTopography API key was provided. Set OPENTOPOGRAPHY_API_KEY or enter a key in the app.")
      return(NULL)
    }
    downloaded <- tryCatch(
      download_opentopo_dem(extent_vec, demtype, cache_file, key, log_fun),
      error = function(e) {
        log_message(log_fun, "Elevation download failed: ", conditionMessage(e))
        NULL
      }
    )
    if (is.null(downloaded) || !file.exists(cache_file)) {
      return(NULL)
    }
  } else {
    log_message(log_fun, "Using cached elevation raster: ", normalizePath(cache_file, winslash = "/", mustWork = FALSE))
  }
  dem <- terra::rast(cache_file)
  names(dem) <- "elevation_m"
  log_message(log_fun, "Computing terrain complexity derivatives from DEM")
  terrain <- compute_terrain_metrics(dem)
  all_rasters <- c(dem, terrain)
  methods_vec <- c(
    elevation_m = "bilinear",
    terrain_ruggedness = "bilinear",
    terrain_slope = "bilinear",
    terrain_aspect = "bilinear",
    terrain_aspect_sin = "bilinear",
    terrain_aspect_cos = "bilinear",
    terrain_curvature = "bilinear"
  )
  list(raster = all_rasters, files = cache_file, source = paste0("OpenTopography ", demtype), methods = methods_vec)
}
