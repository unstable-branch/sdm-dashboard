## SoilGrids loader ----------------------------------------------------------
## Retrieves continuous SoilGrids variables for the specified depth ranges,
## caches them locally, and returns a terra SpatRaster stack where each layer
## is named "<var>_<depth>" (e.g., "Sand_0-30cm").

#' Download a SoilGrids raster (cached)
#'
#' @param var Character name of the SoilGrids variable (e.g., "Sand").
#' @param depth Character depth range ("0-30cm" or "0-60cm").
#' @param cache_dir Directory where downloaded GeoTIFFs are stored.
#' @return terra SpatRaster of the requested layer.
#' @export
download_soilgrid <- function(var, depth, cache_dir = file.path('covariates','soilgrids')) {
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE)
  # Build a safe filename
  fname <- file.path(cache_dir, paste0(var, '_', depth, '.tif'))
  if (file.exists(fname)) {
    return(terra::rast(fname))
  }
  # SoilGrids API pattern (v2.0.0)
  base_url <- 'https://maps.isric.org/mapserver/soilgrids/v2.0.0/rgb'
  url <- sprintf('%s?attribute=%s&depth=%s', base_url, var, depth)
  # Download using httr (handles Windows SSL)
  resp <- httr::GET(url, httr::write_disk(fname, overwrite = TRUE))
  if (httr::status_code(resp) != 200) {
    stop('Failed to download SoilGrids layer: ', var, ' ', depth)
  }
  terra::rast(fname)
}

#' Build a stacked raster of selected soil variables and depths
#'
#' @param vars Character vector of SoilGrids variable names.
#' @param depths Character vector of depth ranges (e.g., c('0-30cm','0-60cm')).
#' @return SpatRaster stack with one layer per var‑depth combination.
#' @export
build_soilstack <- function(vars = config$soil_vars_default,
                           depths = config$soil_depths_default) {
  layers <- list()
  for (v in vars) {
    for (d in depths) {
      r <- download_soilgrid(v, d)
      terra::names(r) <- paste0(v, '_', d)
      layers[[length(layers) + 1]] <- r
    }
  }
  terra::rast(layers)
}
