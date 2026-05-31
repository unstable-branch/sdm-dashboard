# Extent of Occurrence (EOO) and Area of Occupancy (AOO) calculations.
# IUCN Red List Guidelines (Version 15.1, 2022).
# EOO: minimum convex polygon (MCP) or alpha hull around all presence points
# AOO: number of 2x2 km cells occupied by the species

#' Compute EOO and AOO from occurrence records.
#'
#' @param occ data.frame with longitude and latitude columns
#' @param aoo_cell_size_km Cell size for AOO calculation (default 2 km per IUCN)
#' @param analysis_crs Projection for AOO grid. One of "auto" (UTM), "eqearth", "laea",
#'   "aeqd", "moll", "eqc", or any EPSG/PROJ string. Default "auto".
#' @param output_dir Optional directory path for GeoJSON output files
#' @param log_fun Optional log function
#' @return list with EOO (km2), AOO (number of cells), polygon, and details
compute_eoo_aoo <- function(occ, aoo_cell_size_km = 2, analysis_crs = "auto", output_dir = NULL, log_fun = NULL) {
  if (!requireNamespace("sf", quietly = TRUE)) {
    stop("sf package required for EOO/AOO calculation", call. = FALSE)
  }

  if (is.null(occ) || nrow(occ) == 0) {
    return(list(eoo_km2 = NA_real_, aoo_cells = NA_integer_, aoo_km2 = NA_real_, eoo_polygon = NULL, aoo_grid = NULL, eoo_polygon_geojson = NULL, aoo_grid_geojson = NULL, iucn_category = "Not evaluated", n_unique_points = 0L))
  }

  xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  xy <- xy[stats::complete.cases(xy), , drop = FALSE]
  xy_unique <- unique(xy)
  n_unique <- nrow(xy_unique)

  log_message(log_fun, "Computing EOO/AOO from ", nrow(occ), " records (", n_unique, " unique locations)")

  # --- EOO: Minimum Convex Polygon with geodesic area ---
  eoo_km2 <- NA_real_
  eoo_polygon <- NULL
  eoo_polygon_geojson <- NULL

  if (n_unique >= 3) {
    pts <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)
    eoo_polygon <- NULL
    eoo_poly_out <- NULL

    eoo_result <- tryCatch({
      hull <- sf::st_convex_hull(sf::st_union(pts))

      area_km2 <- as.numeric(sf::st_area(hull)) / 1e6

      log_message(log_fun, "  EOO: ", sprintf("%.1f km2", area_km2), " (MCP, WGS84 geodesic area)")

      list(area = area_km2, polygon = hull)
    }, error = function(e) {
      log_message(log_fun, "  EOO computation failed: ", conditionMessage(e))
      NULL
    })

    if (!is.null(eoo_result)) {
      eoo_km2 <- eoo_result$area
      eoo_polygon <- eoo_result$polygon

      if (!is.null(output_dir)) {
        eoo_polygon_geojson <- file.path(output_dir, "eoo_polygon.geojson")
        tryCatch({
          sf::st_write(eoo_polygon, eoo_polygon_geojson, delete_dsn = TRUE, quiet = TRUE)
          log_message(log_fun, "  Wrote EOO polygon to ", eoo_polygon_geojson)
        }, error = function(e) {
          log_message(log_fun, "  Failed to write EOO GeoJSON: ", conditionMessage(e))
          eoo_polygon_geojson <<- NULL
        })
      }
    }
  } else {
    log_message(log_fun, "  Too few unique points for EOO (need >= 3); EOO = NA")
  }

  # --- AOO: Grid-based count of occupied cells ---
  aoo_result <- tryCatch({
    pts_sf <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)

    aoo_crs <- sdm_resolve_crs(analysis_crs, xy_unique$longitude, xy_unique$latitude)
    pts_proj <- sf::st_transform(pts_sf, aoo_crs)

    bbox <- sf::st_bbox(pts_proj)
    cell_size <- aoo_cell_size_km * 1000

    x0 <- floor(bbox["xmin"] / cell_size) * cell_size
    y0 <- floor(bbox["ymin"] / cell_size) * cell_size
    nx <- ceiling((bbox["xmax"] - x0) / cell_size)
    ny <- ceiling((bbox["ymax"] - y0) / cell_size)

    nx <- ceiling((x1 - x0) / cell_size)
    ny <- ceiling((y1 - y0) / cell_size)

    n_cells_total <- nx * ny
    if (n_cells_total > 1e6) {
      stop("AOO grid too large (", n_cells_total, " cells) at ", aoo_cell_size_km,
           "km resolution for this extent; try a larger cell size or smaller extent")
    }

    grid_cells <- expand.grid(ix = seq_len(nx), iy = seq_len(ny))
    grid_polys <- lapply(seq_len(nrow(grid_cells)), function(i) {
      x_min <- x0 + (grid_cells$ix[i] - 1) * cell_size
      y_min <- y0 + (grid_cells$iy[i] - 1) * cell_size
      sf::st_polygon(list(matrix(c(
        x_min, y_min,
        x_min + cell_size, y_min,
        x_min + cell_size, y_min + cell_size,
        x_min, y_min + cell_size,
        x_min, y_min
      ), ncol = 2, byrow = TRUE)))
    })

    grid_sf <- sf::st_sf(geometry = sf::st_sfc(grid_polys, crs = aoo_crs))

    intersects <- sf::st_intersects(pts_proj, grid_sf, sparse = FALSE)
    occupied <- which(colSums(intersects) > 0)
    n_occupied <- length(occupied)

    aoo_grid_proj <- if (n_occupied > 0) grid_sf[occupied, ] else NULL

    aoo_grid_wgs84 <- NULL
    if (!is.null(aoo_grid_proj)) {
      aoo_grid_wgs84 <- sf::st_transform(aoo_grid_proj, 4326)
    }

    log_message(log_fun, "  AOO: ", n_occupied, " cells (", aoo_cell_size_km, "x", aoo_cell_size_km, " km) = ",
      sprintf("%.0f km2", n_occupied * aoo_cell_size_km^2))

    list(n_cells = n_occupied, area_km2 = n_occupied * aoo_cell_size_km^2,
         cell_size_km = aoo_cell_size_km, grid = aoo_grid_wgs84, grid_proj = aoo_grid_proj, aoo_crs = aoo_crs)
  }, error = function(e) {
    log_message(log_fun, "  AOO computation failed: ", conditionMessage(e))
    list(n_cells = NA_integer_, area_km2 = NA_real_, cell_size_km = aoo_cell_size_km, grid = NULL, grid_proj = NULL, aoo_crs = NULL)
  })

  aoo_grid_geojson <- NULL
  if (!is.null(output_dir) && !is.null(aoo_result$grid) && nrow(aoo_result$grid) > 0) {
    aoo_grid_geojson <- file.path(output_dir, "aoo_grid.geojson")
    tryCatch({
      sf::st_write(aoo_result$grid, aoo_grid_geojson, delete_dsn = TRUE, quiet = TRUE)
      log_message(log_fun, "  Wrote AOO grid to ", aoo_grid_geojson)
    }, error = function(e) {
      log_message(log_fun, "  Failed to write AOO GeoJSON: ", conditionMessage(e))
      aoo_grid_geojson <<- NULL
    })
  }

  # --- IUCN threat category using strictest of EOO and AOO ---
  eoo_cat <- "LC"
  if (is.finite(eoo_km2)) {
    if (eoo_km2 < 100) eoo_cat <- "CR"
    else if (eoo_km2 < 5000) eoo_cat <- "EN"
    else if (eoo_km2 < 20000) eoo_cat <- "VU"
  }

  aoo_cat <- "LC"
  if (is.finite(aoo_result$area_km2)) {
    if (aoo_result$area_km2 < 10) aoo_cat <- "CR"
    else if (aoo_result$area_km2 < 500) aoo_cat <- "EN"
    else if (aoo_result$area_km2 < 2000) aoo_cat <- "VU"
  }

  iucn_category <- if (eoo_cat == "CR" || aoo_cat == "CR") "CR"
    else if (eoo_cat == "EN" || aoo_cat == "EN") "EN"
    else if (eoo_cat == "VU" || aoo_cat == "VU") "VU"
    else "LC"

  log_message(log_fun, "  IUCN category: ", iucn_category, " (EOO: ", eoo_cat, ", AOO: ", aoo_cat, ")")

  aoo_crs <- if (!is.null(aoo_result$aoo_crs)) aoo_result$aoo_crs else sf::st_crs(4326L)

  list(
    eoo_km2 = eoo_km2,
    eoo_method = eoo_method_used,
    aoo_cells = aoo_result$n_cells,
    aoo_km2 = aoo_result$area_km2,
    aoo_cell_size_km = aoo_result$cell_size_km,
    eoo_polygon = eoo_polygon,
    aoo_grid = aoo_result$grid,
    eoo_polygon_geojson = eoo_polygon_geojson,
    aoo_grid_geojson = aoo_grid_geojson,
    iucn_category = iucn_category,
    n_unique_points = n_unique,
    analysis_crs = analysis_crs,
    aoo_crs = aoo_crs$wkt %||% as.character(aoo_crs$input)
  )
}
