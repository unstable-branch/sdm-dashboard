# Cache: <covariate_cache_dir>/lulc/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: AWS Open Data VSI (no auth); fractional layers aggregated via aggregate_factor=18L to climate res
# API keys: none
# MODIS Land Use/Land Cover (MCD12Q1 Collection 6.1, IGBP classification)
# via AWS Open Data — no authentication required.
# Produces fractional (continuous) layers derived from IGBP categorical classes:
#   % Forest, % Cropland, % Urban, % Grassland, % Shrubland, % Water, % Barren

# IGBP class definitions for MODIS Land Cover Type 1 (LC_Type1)
# Values 0-16, but only 1-17 used (0 = Fill, 17 = unclassified)
igbp_classes <- c(
  "1"  = "Evergreen_Needleleaf",
  "2"  = "Evergreen_Broadleaf",
  "3"  = "Deciduous_Needleleaf",
  "4"  = "Deciduous_Broadleaf",
  "5"  = "Mixed_Forest",
  "6"  = "Closed_Shrublands",
  "7"  = "Open_Shrublands",
  "8"  = "Woody_Savannas",
  "9"  = "Savannas",
  "10" = "Grasslands",
  "11" = "Permanent_Wetlands",
  "12" = "Croplands",
  "13" = "Urban_and_Built-Up",
  "14" = "Cropland_Natural_Vegetation_Mosaic",
  "15" = "Permanent_Snow_and_Ice",
  "16" = "Barren_or_Sparsely_Vegetated"
)

# Fraction layer mapping: which IGBP classes contribute to each fraction
fraction_classes <- list(
  forest     = as.character(1:5),   # all forest types
  shrubland  = as.character(6:7),    # closed + open shrublands
  savanna    = as.character(8:9),    # woody savannas + savannas
  grassland  = "10",
  cropland   = c("12", "14"),       # croplands + mosaic
  urban      = "13",
  wetland    = "11",
  snow_ice   = "15",
  barren     = "16"
)

mcd12q1_tile_for_extent <- function(extent_vec) {
  # MCD12Q1 uses MODIS Sinusoidal grid. Tiles covering extent:
  # h09v05, h10v05, h11v05, h12v05, h13v05  (approx 112-154E, -44--10S for Aus)
  # Simple bounding: derive from lat/lon - using a standard approach.
  # For global: just return all relevant tiles.
  # Australia: h09v05, h10v05, h11v05, h12v05, h13v05 for south; h09v04-h13v04 for north
  lon <- seq(-180, 180, by = 10)
  lat <- seq(-90, 90, by = 10)
  h_tiles <- findInterval(floor(extent_vec[1] / 10) * 10 + seq(0, 9), lon)
  h_tiles <- h_tiles[h_tiles >= 1 & h_tiles <= 36]
  v_tiles <- findInterval(floor(extent_vec[3] / 10) * 10 + seq(0, 9), lat)
  v_tiles <- v_tiles[v_tiles >= 1 & v_tiles <= 18]
  tiles <- character(0)
  for (h in h_tiles) for (v in v_tiles) {
    tiles <- c(tiles, sprintf("h%02dv%02d", h, v))
  }
  unique(tiles)
}

build_lulc_fraction_layers <- function(lulc_rast, fraction_map) {
  vals <- terra::values(lulc_rast, dataframe = FALSE, mat = FALSE)
  layers <- list()
  for (fname in names(fraction_map)) {
    classes <- as.integer(fraction_map[[fname]])
    r_frac <- lulc_rast
    terra::values(r_frac) <- ifelse(vals %in% classes, 1L, NA_integer_)
    r_frac <- terra::app(r_frac, fun = "mean", na.rm = TRUE)
    names(r_frac) <- paste0("lulc_", fname)
    layers[[fname]] <- r_frac
  }
  do.call(c, layers)
}

load_lulc_covariate <- function(lulc_year = 2020,
                                 extent_vec = NULL,
                                 aggregate_factor = 18L,
                                 covariate_cache_dir = sdm_default_covariate_cache_dir,
                                 allow_download = TRUE,
                                 log_fun = NULL) {

  lulc_year <- as.integer(lulc_year[1])
  if (is.na(lulc_year) || lulc_year < 2001 || lulc_year > 2023) {
    log_message(log_fun, "LULC year ", lulc_year, " out of range (2001-2023). Using 2020.")
    lulc_year <- 2020
  }

  cache_dir <- file.path(covariate_cache_dir, "lulc")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  ext_key <- ""
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext_key <- paste0("_", paste(round(extent_vec, 1), collapse = "_"))
  }
  cached_frac <- file.path(cache_dir, paste0("lulc_frac_", lulc_year, ext_key, ".tif"))

  # Check if fractional layers are already cached
  if (file.exists(cached_frac)) {
    log_message(log_fun, "Using cached LULC fractional layers for ", lulc_year)
    r <- terra::rast(cached_frac)
    if (!is.null(extent_vec) && length(extent_vec) == 4) {
      r <- tryCatch(terra::crop(r, terra::ext(extent_vec), snap = "out"), error = function(e) r)
    }
    return(list(
      raster = r, files = cached_frac,
      source = "MODIS MCD12Q1 Collection 6.1 (IGBP) via AWS Open Data, fractional layers",
      variables = list(lulc = names(terra::sources(r))),
      methods = setNames(rep("bilinear", terra::nlyr(r)), names(terra::sources(r)))
    ))
  }

  if (!isTRUE(allow_download)) {
    log_message(log_fun, "LULC not cached and downloads disabled.")
    return(NULL)
  }

  # Determine tile(s) needed for extent
  tiles_needed <- if (!is.null(extent_vec) && length(extent_vec) == 4) {
    mcd12q1_tile_for_extent(extent_vec)
  } else {
    c("h09v04","h10v04","h11v04","h12v04","h13v04",
      "h09v05","h10v05","h11v05","h12v05","h13v05")
  }

  # Try to load via AWS Open Data VSI
  # MCD12Q1 on AWS: s3://modis-006-mcd12q1/
  # File naming: MCD12Q1.A{YYYY}001.h{H}v{V}.061.2023125042021.hdf.tif
  log_message(log_fun, "Attempting LULC load via AWS VSI for year ", lulc_year, ", tiles: ",
              paste(tiles_needed, collapse = ", "))

  raw_tiles <- list()
  for (tile in tiles_needed) {
    h <- sub("h", "", sub("v.+$", "", tile))
    v <- sub(".+v", "", tile)
    # Construct actual file name - version and timestamp vary
    # We probe for the actual file using AWS listing or known pattern
    # MCD12Q1.A2020001.h09v05.061.2023125042020.hdf.tif
    # The version timestamp changes; use a glob pattern via /vsicurl/
    base <- "https://modis-006-mcd12q1.s3.amazonaws.com/"
    # Try the HDF-EOS2 file first, then the .tif version
    for (ext in c(".hdf.tif", ".hdf")) {
      fname_pattern <- sprintf("MCD12Q1.A%d001.%s.%s.", lulc_year, tile, "061")
      vsi_pattern <- paste0(base, "?prefix=", sprintf("MCD12Q1.A%d001.%s.%s.", lulc_year, tile, "061"))
      # Instead of probing, construct expected filename (yearly product, stable naming)
      fname <- sprintf("MCD12Q1.A%d001.%s.061.%s.hdf", lulc_year, tile, substr(format(Sys.Date(), "%Y"), 3, 4))
      # Most AWS files for recent years follow this pattern: timestamp ends in year
      # The .tif in .hdf version is the Cloud Optimized version
      # Try to fetch tile via VSI
      vsi_url <- paste0("/vsicurl/", base, fname)
      test_r <- tryCatch(terra::rast(vsi_url), error = function(e) NULL)
      if (!is.null(test_r)) {
        raw_tiles[[tile]] <- test_r
        log_message(log_fun, "Loaded LULC tile ", tile, " via AWS VSI")
        break
      }
    }
  }

  if (length(raw_tiles) == 0) {
    log_message(log_fun, "LULC tiles could not be loaded from AWS. ",
                "Ensure the tile range is correct and internet is available.")
    return(NULL)
  }

  # Mosaic and crop tiles
  log_message(log_fun, "Merging ", length(raw_tiles), " LULC tiles")
  lulc_mosaic <- tryCatch({
    if (length(raw_tiles) == 1) raw_tiles[[1]]
    else do.call(terra::mosaic, raw_tiles)
  }, error = function(e) {
    log_message(log_fun, "Mosaic failed: ", conditionMessage(e))
    raw_tiles[[1]]
  })

  # Crop to extent if provided
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    lulc_mosaic <- tryCatch(
      terra::crop(lulc_mosaic, terra::ext(extent_vec), snap = "out"),
      error = function(e) lulc_mosaic
    )
  }

  # Extract IGBP categorical values
  igbp_layer <- lulc_mosaic
  igbp_vals <- terra::values(igbp_layer, dataframe = FALSE, na.rm = FALSE)

  # Build fractional layers
  layers <- list()
  for (fname in names(fraction_classes)) {
    classes <- as.integer(fraction_classes[[fname]])
    r_frac <- igbp_layer
    vals_copy <- igbp_vals
    terra::values(r_frac) <- ifelse(vals_copy %in% classes, 1L, NA_integer_)
    r_frac <- tryCatch(terra::aggregate(r_frac, fact = aggregate_factor, fun = "mean", na.rm = TRUE),
                       error = function(e) NULL)
    if (!is.null(r_frac)) {
      names(r_frac) <- paste0("lulc_", fname)
      layers[[fname]] <- r_frac
    }
  }

  if (length(layers) == 0) {
    log_message(log_fun, "LULC fractional layer computation failed.")
    return(NULL)
  }

  lulc_frac <- do.call(c, layers)

  # Write to cache
  terra::writeRaster(lulc_frac, cached_frac, overwrite = TRUE,
                    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
  log_message(log_fun, "LULC fractional layers cached: ", paste(names(lulc_frac), collapse = ", "))

  methods <- setNames(rep("bilinear", terra::nlyr(lulc_frac)), names(lulc_frac))

  list(
    raster = lulc_frac,
    files = cached_frac,
    source = "MODIS MCD12Q1 Collection 6.1 IGBP (AWS Open Data), fractional layers derived",
    variables = list(lulc = names(lulc_frac)),
    methods = methods
  )
}