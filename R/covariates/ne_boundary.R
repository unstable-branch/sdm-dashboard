# ============================================================
# NATURAL EARTH BOUNDARY SYSTEM
# Downloads NE Admin 0 / Land datasets at 10m/50m/110m scales
# Provides boundary file resolution and country filtering
# ============================================================

#' Infer NE boundary scale from covariate raster resolution
#' @param raster_res Numeric: raster resolution(s) in degrees
#' @return "10m", "50m", or "110m"
ne_boundary_infer_scale <- function(raster_res) {
  if (is.null(raster_res) || !is.numeric(raster_res) || length(raster_res) == 0 || !all(is.finite(raster_res)))
    return("110m")
  res_val <- min(raster_res, na.rm = TRUE)
  if (res_val <= 1/60) return("10m")
  if (res_val <= 5/60) return("50m")
  "110m"
}

#' Get path to a Natural Earth boundary file (without downloading)
#' @param scale "10m", "50m", or "110m"
#' @param type "admin0" or "land"
#' @return Full file path
get_ne_boundary_path <- function(scale = "110m", type = "admin0") {
  scale <- match.arg(scale, c("10m", "50m", "110m"))
  type <- match.arg(type, c("admin0", "land"))
  root <- tryCatch(sdm_project_root(), error = function(e) getwd())
  boundary_dir <- file.path(root, "data", "boundaries", "ne", scale)
  if (type == "admin0") {
    file.path(boundary_dir, "ne_10m_admin_0_countries.geojson")
  } else {
    file.path(boundary_dir, "ne_10m_land.geojson")
  }
}

#' Download Natural Earth boundary dataset
#' @param scale "10m", "50m", or "110m"
#' @param type "admin0" or "land"
#' @param force Re-download if TRUE
#' @return Path to GeoJSON file, or NULL on failure
download_ne_boundary <- function(scale = "110m", type = "admin0", force = FALSE) {
  scale <- match.arg(scale, c("10m", "50m", "110m"))
  type <- match.arg(type, c("admin0", "land"))
  boundary_path <- get_ne_boundary_path(scale, type)
  if (!force && file.exists(boundary_path))
    return(boundary_path)
  dir.create(dirname(boundary_path), recursive = TRUE, showWarnings = FALSE)
  if (type == "admin0") {
    url <- sprintf("https://naturalearth.s3.amazonaws.com/%s_cultural/ne_%s_admin_0_countries.zip", scale, scale)
  } else {
    url <- sprintf("https://naturalearth.s3.amazonaws.com/%s_physical/ne_%s_land.zip", scale, scale)
  }
  zip_path <- tempfile(fileext = ".zip")
  on.exit(unlink(zip_path), add = TRUE)
  tryCatch({
    utils::download.file(url, zip_path, mode = "wb", quiet = TRUE)
    utils::unzip(zip_path, exdir = dirname(boundary_path))
    extracted <- list.files(dirname(boundary_path), pattern = "\\.(geojson|json|shp)$", full.names = TRUE, recursive = TRUE)
    src <- grep("\\.geojson$", extracted, value = TRUE)
    if (length(src) > 0) {
      file.rename(src[1], boundary_path)
    } else {
      src <- grep("\\.shp$", extracted, value = TRUE)
      if (length(src) > 0) {
        tryCatch({
          sf_obj <- sf::st_read(src[1], quiet = TRUE)
          sf::st_write(sf_obj, boundary_path, delete_dsn = TRUE, quiet = TRUE)
        }, error = function(e) file.rename(src[1], boundary_path))
      }
    }
    if (file.exists(boundary_path)) return(boundary_path)
    NULL
  }, error = function(e) {
    warning("Failed to download NE boundary: ", conditionMessage(e), call. = FALSE)
    NULL
  })
}

#' Resolve mask file path from boundary parameters
#' @param boundary_type "admin0", "land", or "custom"
#' @param resolution "auto", "10m", "50m", or "110m"
#' @param country Country name, "all", or custom file path
#' @param raster_res Raster resolution for auto-inference
#' @param default_file Fallback path
#' @return Resolved file path
resolve_mask_file <- function(boundary_type = "admin0", resolution = "auto",
                               country = "all", raster_res = NULL,
                               default_file = sdm_default_mask_file) {
  if (boundary_type == "custom" && !is.null(country) && nzchar(country))
    return(country)
  scale <- if (identical(resolution, "auto")) ne_boundary_infer_scale(raster_res) else resolution
  path <- get_ne_boundary_path(scale, boundary_type)
  if (!file.exists(path))
    path <- download_ne_boundary(scale, boundary_type)
  if (is.null(path) || !file.exists(path)) {
    warning("NE boundary not available at ", scale, " — using default", call. = FALSE)
    return(default_file)
  }
  if (boundary_type == "admin0" && !is.null(country) && nzchar(country) && tolower(country) != "all")
    return(filter_admin0_to_country(path, country))
  path
}

#' Filter Admin 0 GeoJSON to a single country
#' @param geojson_path Path to full Admin 0 file
#' @param country_name Country name (case-insensitive)
#' @return Path to filtered GeoJSON
filter_admin0_to_country <- function(geojson_path, country_name) {
  tmp <- paste0(tempfile(), "_", gsub("[^a-zA-Z0-9]", "_", tolower(country_name)), ".geojson")
  tryCatch({
    all <- jsonlite::fromJSON(geojson_path, simplifyVector = FALSE)
    feats <- all$features
    if (is.null(feats)) return(geojson_path)
    matched <- list()
    for (f in feats) {
      props <- f$properties %||% list()
      nm <- props$ADMIN %||% props$NAME %||% props$name %||% ""
      if (tolower(nm) == tolower(country_name))
        matched <- c(matched, list(f))
    }
    if (length(matched) > 0) {
      all$features <- matched
      jsonlite::write_json(all, tmp, auto_unbox = TRUE)
      return(tmp)
    }
    geojson_path
  }, error = function(e) geojson_path)
}

#' Mask a raster to a boundary polygon
#' @param raster A SpatRaster
#' @param mask_file Path to a vector file readable by terra::vect
#' @return Masked SpatRaster (cells outside boundary set to NA)
restrict_raster_to_boundary <- function(raster, mask_file) {
  if (is.null(mask_file) || !file.exists(mask_file)) {
    warning("Boundary mask file not found — background restriction skipped", call. = FALSE)
    return(raster)
  }
  tryCatch({
    poly <- terra::vect(mask_file)
    if (!terra::same.crs(poly, raster))
      poly <- terra::project(poly, raster)
    poly <- terra::aggregate(poly, dissolve = TRUE)
    tmp <- tempfile(fileext = ".tif")
    terra::mask(raster, poly, filename = tmp, overwrite = TRUE)
    terra::rast(tmp)
  }, error = function(e) {
    warning("Failed to restrict raster to boundary: ", conditionMessage(e), call. = FALSE)
    raster
  })
}

#' Get list of country names from Admin 0 boundary
#' @param scale "10m", "50m", or "110m"
#' @return Character vector of country names
get_admin0_countries <- function(scale = "110m") {
  path <- get_ne_boundary_path(scale, "admin0")
  if (!file.exists(path)) path <- download_ne_boundary(scale, "admin0")
  if (is.null(path) || !file.exists(path)) return(character(0))
  tryCatch({
    gj <- jsonlite::fromJSON(path, simplifyVector = FALSE)
    feats <- gj$features %||% list()
    countries <- unique(vapply(feats, function(f) {
      props <- f$properties %||% list()
      props$ADMIN %||% props$NAME %||% props$name %||% "Unknown"
    }, character(1)))
    sort(countries[!is.na(countries) & countries != ""])
  }, error = function(e) character(0))
}