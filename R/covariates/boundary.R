# ============================================================
# EXTENSIBLE BOUNDARY SYSTEM
# Supports: multiple formats (shp, kml, geojson, tif) & countries
# ============================================================

#' Boundary registry - add new countries here
#' Format: list(country_code = list(name = "...", url = "...", format = "shp|kml|geojson|tif"))
boundary_registry <- list(
  AUS = list(
    name = "Australia",
    url = "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/digital-boundary-files/AUS_2021_AUST_SHP_GDA2020.zip",
    format = "shp",
    default_extent = c(113, 154, -44, -10)
  ),
  GBR = list(
    name = "United Kingdom",
    url = "https://geodata.ucdavis.edu/gadm/gadm4.1/shp/gadm410_GBR_shp.zip",
    format = "shp",
    default_extent = c(-8, 2, 49, 61)
  ),
  USA = list(
    name = "United States",
    url = "https://geodata.ucdavis.edu/gadm/gadm4.1/shp/gadm410_USA_shp.zip",
    format = "shp",
    default_extent = c(-125, -66, 24, 50)
  ),
  WORLD = list(
    name = "World countries",
    url = "https://geodata.ucdavis.edu/gadm/gadm4.1/shp/gadm410_countries_shp.zip",
    format = "shp",
    default_extent = c(-180, 180, -90, 90)
  )
)

#' Get boundary extent for a country
#' @param country_code Country code (AUS, GBR, USA, WORLD) or "custom"
#' @param custom_extent Optional custom extent c(xmin, xmax, ymin, ymax)
#' @return numeric vector of extent or NULL if unavailable
get_boundary_extent <- function(country_code = "AUS", custom_extent = NULL) {
  if (!is.null(custom_extent) && length(custom_extent) == 4) {
    return(custom_extent)
  }
  if (identical(tolower(country_code), "custom") || is.null(country_code)) {
    return(NULL)
  }
  country_code <- toupper(country_code)
  if (!is.null(boundary_registry[[country_code]])) {
    return(boundary_registry[[country_code]]$default_extent)
  }
  NULL
}

#' Check if boundary file exists or can be downloaded
#' @param country_code Country code
#' @return TRUE if boundary available
has_boundary_file <- function(country_code = "AUS") {
  country_code <- toupper(country_code)
  if (is.null(boundary_registry[[country_code]])) {
    return(FALSE)
  }
  TRUE
}

#' Get boundary file path, downloading if necessary
#' @param country_code Country code (AUS, GBR, USA, etc)
#' @param cache_dir Directory to store boundary files
#' @return Path to boundary file or NULL
get_boundary_file <- function(country_code = "AUS", cache_dir = "boundaries") {
  country_code <- toupper(country_code)
  config <- boundary_registry[[country_code]]
  if (is.null(config)) {
    return(NULL)
  }
  dir.create(cache_dir, showWarnings = FALSE, recursive = TRUE)
  base_name <- paste0(country_code, "_boundary.")
  ext <- switch(config$format,
    shp = ".shp",
    kml = ".kml",
    geojson = ".geojson",
    tif = ".tif",
    ".shp"
  )
  file_path <- file.path(cache_dir, paste0(country_code, "_boundary.shp"))
  if (file.exists(file_path)) {
    return(file_path)
  }

  # Check for any downloaded boundary file
  existing <- list.files(cache_dir, pattern = paste0("^", country_code, "_boundary"), full.names = TRUE)
  if (length(existing) > 0) {
    return(existing[1])
  }

  # Return path - will trigger download in UI
  file.path(cache_dir, paste0(country_code, "_boundary.shp"))
}

#' Supported boundary country codes
#' @return character vector of country codes
get_boundary_countries <- function() {
  names(boundary_registry)
}

#' Extent preset choices for UI
#' @return named character vector
get_extent_choices <- function() {
  choices <- c(
    "Occurrence extent" = "occurrence",
    "Full world" = "world",
    "Australia - full" = "aus_full",
    "Australia - north" = "aus_north",
    "Australia - east" = "aus_east",
    "Custom extent" = "custom"
  )
  # Add registry countries
  for (code in names(boundary_registry)) {
    if (!identical(code, "WORLD")) {
      name <- boundary_registry[[code]]$name
      choices[[name]] <- tolower(code)
    }
  }
  choices["Custom extent"] <- "custom"
  choices
}

#' Compute bounding box extent from a boundary file.
#' @param file_path Path to shapefile directory, GeoJSON, or any file sf can read
#' @return numeric vector c(xmin, xmax, ymin, ymax) or NULL on failure
compute_extent_from_file <- function(file_path) {
  if (is.null(file_path) || !nzchar(file_path) || !file.exists(file_path)) {
    return(NULL)
  }
  tryCatch(
    {
      sf_obj <- sf::st_read(file_path, quiet = TRUE, geometry_column = sf::st_geometry_column_names(file_path)[1])
      bb <- sf::st_bbox(sf_obj)
      ext <- c(as.numeric(bb["xmin"]), as.numeric(bb["xmax"]), as.numeric(bb["ymin"]), as.numeric(bb["ymax"]))
      if (!validate_boundary_extent(ext)) return(NULL)
      ext
    },
    error = function(e) NULL
  )
}

#' Validate boundary extent coordinates
#' @param extent numeric vector c(xmin, xmax, ymin, ymax)
#' @return TRUE if valid
validate_boundary_extent <- function(extent) {
  if (is.null(extent) || length(extent) != 4) {
    return(FALSE)
  }
  xmin <- extent[1]
  xmax <- extent[2]
  ymin <- extent[3]
  ymax <- extent[4]
  xmin < xmax && ymin < ymax && xmin >= -180 && xmax <= 180 && ymin >= -90 && ymax <= 90
}

apply_boundary_mask <- function(suit, mask_type = "none",
                                mask_file = NULL, buffer_deg = NA,
                                log_fun = NULL, output_tif = NULL) {
  if (mask_type == "none" || is.null(mask_file) || !file.exists(mask_file))
    return(suit)

  poly <- terra::vect(mask_file)

  if (!terra::same.crs(poly, suit))
    poly <- terra::project(poly, suit)

  if (is.na(buffer_deg))
    buffer_deg <- max(terra::res(suit)) / 2

  if (buffer_deg > 0)
    poly <- terra::buffer(poly, width = buffer_deg)

  poly <- terra::aggregate(poly, dissolve = TRUE)

  log_message(log_fun, sprintf(
    "  Masking suitability raster (%s mode, buffer=%.4f\u00b0)", mask_type, buffer_deg
  ))

  out_path <- output_tif %||% tempfile(fileext = ".tif")
  terra::mask(suit, poly, inverse = (mask_type == "ocean"),
              filename = out_path, overwrite = TRUE)
}
