# Standalone XYZ tile generator for web map raster overlays.
#
# This file has zero dependencies on SDM-internal code. It can be copied
# to any R project with `terra` and `grDevices` installed.
#
# Usage:
#   source("R/output/tile_generator.R")
#   generate_xyz_tiles("suitability.tif", "tiles/",
#     palette = c("#0A1624", "#123247", "#15545D"),
#     value_range = c(0, 1))

#' Generate XYZ web map tiles from a GeoTIFF
#'
#' Reprojects a raster to Web Mercator (EPSG:3857), applies a color ramp,
#' and writes 256x256 PNG tiles in `{output_dir}/{band}/{z}/{x}/{y}.png` layout.
#'
#' @param input       Path to input GeoTIFF, or a SpatRaster object.
#' @param output_dir  Directory for output tiles.
#' @param palette     Character vector of hex colors for the color ramp.
#'                    Default: `grDevices::terrain.colors(255)`.
#' @param value_range Numeric range `c(min, max)` to map palette across.
#'                    NULL = auto-detect from raster (2% trimmed).
#' @param na_values   Values treated as transparent. NULL = only NA/NaN.
#' @param bands       Integer vector of bands to render (default: 1).
#' @param band_names  Character vector naming each band (default: "band1").
#' @param target_crs  Target projection (default: "EPSG:3857").
#' @param zoom_min    Minimum zoom. NULL = auto from raster resolution.
#' @param zoom_max    Maximum zoom. NULL = auto from raster resolution.
#' @param zoom_limit  Absolute bounds `c(min, max)` for auto zoom (default c(2, 14)).
#' @param tile_size   Tile pixel dimensions (default: 256).
#' @param resampling  Resampling method for terra::resample (default: "bilinear").
#' @param gdal_opts   GDAL PNG creation options (default: "ZLEVEL=6").
#' @param verbose     Print progress messages (default: TRUE).
#' @param log         Callback function(msg) for logging. Default: message().
#' @param cancel      Callback function() returning TRUE to abort. Default: NULL.
#' @param progress    Callback function(completed, total, msg). Default: NULL.
#'
#' @return Invisibly returns a list with:
#'   \item{output_dir}{Path to generated tiles}
#'   \item{bands}{List of per-band results, each with zoom_min, zoom_max,
#'                tile_count}
#'   \item{generation_time}{Elapsed seconds}
#'   \item{tilejson}{TileJSON 2.2.0 metadata}
#'   \item{warnings}{Character vector of non-fatal warnings}
generate_xyz_tiles <- function(
  input,
  output_dir,
  palette        = NULL,
  value_range    = NULL,
  na_values      = NULL,
  bands          = 1L,
  band_names     = NULL,
  target_crs     = "EPSG:3857",
  zoom_min       = NULL,
  zoom_max       = NULL,
  zoom_limit     = c(2L, 14L),
  tile_size      = 256L,
  resampling     = "bilinear",
  gdal_opts      = c("ZLEVEL=6"),
  verbose        = TRUE,
  log            = NULL,
  cancel         = NULL,
  progress       = NULL
) {
  log_msg <- function(...) {
    msg <- paste(...)
    if (is.function(log)) log(msg) else if (verbose) message(msg)
  }

  warn_list <- character()
  add_warning <- function(w) warn_list <<- c(warn_list, w)

  t_start <- Sys.time()

  if (is.null(palette)) {
    palette <- grDevices::terrain.colors(255)
  }
  pal_rgb <- grDevices::col2rgb(palette, alpha = TRUE)

  n_bands <- length(bands)
  if (is.null(band_names)) band_names <- paste0("band", bands)

  world_size <- 40075016.685578488
  half_world <- world_size / 2

  # Read input
  log_msg("Reading input...")
  src <- if (inherits(input, "SpatRaster")) input else terra::rast(input)

  result_bands <- list()

  for (bi in seq_len(n_bands)) {
    b_idx <- bands[bi]
    b_name <- band_names[bi]
    log_msg("Band ", b_idx, " (", b_name, ")")

    # Select band
    src_band <- src[[b_idx]]
    crs_in <- terra::crs(src_band, proj = TRUE)
    log_msg("  Input CRS: ", crs_in)

    # Auto value range
    vr <- value_range
    if (is.null(vr)) {
      v <- terra::values(src_band)
      v <- v[is.finite(v)]
      if (length(v) > 0) {
        vr <- quantile(v, probs = c(0.02, 0.98), na.rm = TRUE)
      } else {
        vr <- c(0, 1)
      }
      log_msg("  Auto value range: ", round(vr[1], 4), " - ", round(vr[2], 4))
    }

    # Determine NA values
    nv <- na_values
    if (is.null(nv)) nv <- numeric()

    # Reproject to target CRS
    log_msg("  Reprojecting to ", target_crs, "...")
    if (terra::same.crs(crs_in, target_crs)) {
      r_proj <- src_band
    } else {
      r_proj <- terra::project(src_band, target_crs, method = resampling)
    }

    # Auto zoom range
    z_min <- zoom_min
    z_max <- zoom_max
    if (is.null(z_min) || is.null(z_max)) {
      native_res <- mean(terra::res(r_proj))
      target_z <- round(log2(world_size / (tile_size * native_res)))
      z_limit_min <- max(0L, zoom_limit[1])
      z_limit_max <- min(20L, zoom_limit[2])
      target_z <- max(z_limit_min + 1L, min(z_limit_max - 1L, target_z))
      if (is.null(z_min)) z_min <- max(z_limit_min, target_z - 2L)
      if (is.null(z_max)) z_max <- min(z_limit_max, target_z + 2L)
    }
    log_msg("  Zoom range: ", z_min, " - ", z_max)

    # Compute tile grid bounds in target CRS
    ext_proj <- terra::ext(r_proj)

    total_tiles <- 0L
    band_dir <- file.path(output_dir, b_name)

    for (z in z_min:z_max) {
      n <- 2L^z
      tile_res <- world_size / n

      # Tile columns covering the extent
      x0 <- max(0L, floor((ext_proj[1] + half_world) / tile_res))
      x1 <- min(n - 1L, floor((ext_proj[2] + half_world) / tile_res))
      # Tile rows covering the extent (y=0 is top/north)
      y0 <- max(0L, floor((half_world - ext_proj[4]) / tile_res))
      y1 <- min(n - 1L, floor((half_world - ext_proj[3]) / tile_res))

      if (x1 < x0 || y1 < y0) next
      n_tiles <- (x1 - x0 + 1L) * (y1 - y0 + 1L)
      if (n_tiles == 0L) next

      base_msg <- sprintf("  Zoom %d (%d tiles)", z, n_tiles)
      log_msg(base_msg)
      tile_i <- 0L

      for (x in x0:x1) {
        xmin <- -half_world + x * tile_res
        xmax <- -half_world + (x + 1L) * tile_res

        for (y in y0:y1) {
          tile_i <- tile_i + 1L

          # Check cancellation
          if (is.function(cancel) && isTRUE(cancel())) {
            log_msg("  Cancelled at tile ", b_name, "/", z, "/", x, "/", y, ".png")
            result <- assemble_result(output_dir, result_bands, t_start, warn_list, world_size, b_name, z_min, z_max)
            return(invisible(result))
          }

          # Report progress
          if (is.function(progress)) {
            progress(tile_i, n_tiles, paste0(b_name, "/", z, "/", x, "/", y))
          } else if (n_tiles > 20 && (tile_i %% 20L == 0L || tile_i == n_tiles)) {
            log_msg("    ... ", tile_i, "/", n_tiles)
          }

          ymax <- half_world - y * tile_res
          ymin <- half_world - (y + 1L) * tile_res

          # Crop to tile extent
          tile_ext <- terra::ext(xmin, xmax, ymin, ymax)
          tile_crop <- tryCatch(terra::crop(r_proj, tile_ext), error = function(e) NULL)
          if (is.null(tile_crop) || terra::ncell(tile_crop) == 0L) next

          # Skip if all NA
          v <- terra::values(tile_crop)
          if (all(is.na(v))) next

          # Create 256x256 template
          template <- terra::rast(
            ncols = tile_size, nrows = tile_size,
            xmin = xmin, xmax = xmax,
            ymin = ymin, ymax = ymax,
            crs = target_crs
          )

          # Resample
          tile_256 <- terra::resample(tile_crop, template, method = resampling)

          # Colorize
          vals <- terra::values(tile_256)
          n_col <- length(palette)
          idx <- round((vals - vr[1]) / (vr[2] - vr[1]) * (n_col - 1L)) + 1L
          idx <- pmax(1L, pmin(n_col, idx))

          is_na <- is.na(vals) | !is.finite(vals)
          if (length(nv) > 0) {
            for (nv_i in nv) is_na <- is_na | (vals == nv_i)
          }

          n_cells <- tile_size * tile_size
          rgba <- matrix(0L, nrow = n_cells, ncol = 4L)
          rgba[!is_na, 1L] <- pal_rgb[1L, idx[!is_na]]
          rgba[!is_na, 2L] <- pal_rgb[2L, idx[!is_na]]
          rgba[!is_na, 3L] <- pal_rgb[3L, idx[!is_na]]
          rgba[!is_na, 4L] <- 255L

          # Write PNG
          tile_dir <- file.path(band_dir, as.character(z), as.character(x))
          dir.create(tile_dir, recursive = TRUE, showWarnings = FALSE)
          tile_path <- file.path(tile_dir, paste0(y, ".png"))

          write_png_tile(rgba, template, tile_path, gdal_opts)
          total_tiles <- total_tiles + 1L
        }
      }
    }

    result_bands[[b_name]] <- list(
      zoom_min = z_min,
      zoom_max = z_max,
      tile_count = total_tiles
    )
    log_msg("  Band ", b_name, " complete: ", total_tiles, " tiles")
  }

  result <- assemble_result(output_dir, result_bands, t_start, warn_list, world_size, band_names[1], zoom_min, zoom_max)
  invisible(result)
}


#' Write a 4-band RGBA raster as PNG via GDAL
write_png_tile <- function(rgba_matrix, template_rast, path, gdal_opts) {
  tile <- terra::rast(
    ncols = terra::ncol(template_rast),
    nrows = terra::nrow(template_rast),
    xmin = terra::xmin(template_rast),
    xmax = terra::xmax(template_rast),
    ymin = terra::ymin(template_rast),
    ymax = terra::ymax(template_rast),
    crs = terra::crs(template_rast),
    nlyrs = 4L
  )
  terra::values(tile) <- rgba_matrix
  terra::writeRaster(tile, path, datatype = "INT1U", gdal = gdal_opts, overwrite = TRUE)
}


#' Assemble the return value
assemble_result <- function(output_dir, bands, t_start, warnings, world_size,
                             band_name, z_min, z_max) {
  elapsed <- as.numeric(difftime(Sys.time(), t_start, units = "secs"))

  tilejson <- list(
    tilejson = "2.2.0",
    name = "XYZ tiles",
    scheme = "xyz",
    tiles = character(),
    minzoom = z_min,
    maxzoom = z_max,
    bounds = c(-180, -90, 180, 90)
  )

  invisible(list(
    output_dir = output_dir,
    bands = bands,
    generation_time = elapsed,
    tilejson = tilejson,
    warnings = warnings
  ))
}
