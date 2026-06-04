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
compute_eoo_aoo <- function(occ, aoo_cell_size_km = 2, analysis_crs = "auto",
                             output_dir = NULL, log_fun = NULL,
                             mask_type = "none", mask_file = NULL) {
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
  eoo_method_used <- NULL

  if (n_unique >= 3) {
    pts <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)
    eoo_polygon <- NULL
    eoo_poly_out <- NULL

    eoo_result <- tryCatch({
      hull <- sf::st_convex_hull(sf::st_union(pts))

      # Validate hull is a polygon with sufficient geometry
      hull_type <- sf::st_geometry_type(hull, by_geometry = FALSE)
      if (hull_type != "POLYGON" && hull_type != "MULTIPOLYGON") {
        stop("Convex hull produced a ", hull_type, " — need at least 3 non-collinear points")
      }
      hull_coords <- sf::st_coordinates(hull)
      n_ring_pts <- nrow(hull_coords)
      if (n_ring_pts < 4) {
        log_message(log_fun, "  EOO skipped: degenerate convex hull (", n_ring_pts, " ring points)")
        list(area = NA_real_, polygon = NULL)
      } else {
        area_km2 <- as.numeric(sf::st_area(hull)) / 1e6
        log_message(log_fun, "  EOO: ", sprintf("%.1f km2", area_km2), " (MCP, WGS84 geodesic area)")
        list(area = area_km2, polygon = hull)
      }
    }, error = function(e) {
      log_message(log_fun, "  EOO computation failed: ", conditionMessage(e))
      NULL
    })

    if (!is.null(eoo_result)) {
      eoo_km2 <- eoo_result$area
      eoo_polygon <- eoo_result$polygon
      eoo_method_used <- "mcp"

      # Clip EOO polygon to boundary mask for map display (preserve raw area)
      if (!is.null(eoo_polygon) && mask_type != "none" && !is.null(mask_file) && file.exists(mask_file)) {
        tryCatch({
          boundary <- terra::vect(mask_file)
          boundary_sf <- sf::st_as_sf(boundary)
          boundary_union <- sf::st_union(boundary_sf)
          clipped <- sf::st_intersection(eoo_polygon, boundary_union)
          if (inherits(clipped, c("sf", "sfc")) && length(clipped) > 0) {
            eoo_polygon <- sf::st_collection_extract(clipped, "POLYGON")
          }
        }, error = function(e) {
          log_message(log_fun, "  Failed to clip EOO to boundary: ", conditionMessage(e))
        })
      }

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
    max_cells <- 1e7
    attempt_sizes <- unique(sort(c(max(aoo_cell_size_km, 2), 5, 10, 25, 50)))
    chosen_size <- NA_real_
    for (try_size in attempt_sizes) {
      cs <- try_size * 1000
      x0_t <- floor(bbox["xmin"] / cs) * cs
      y0_t <- floor(bbox["ymin"] / cs) * cs
      if (ceiling((bbox["xmax"] - x0_t) / cs) * ceiling((bbox["ymax"] - y0_t) / cs) <= max_cells) {
        chosen_size <- try_size
        break
      }
    }
    if (is.na(chosen_size)) {
      stop("AOO grid too large at all attempted resolutions (", max(attempt_sizes), "km)")
    }
    if (chosen_size != aoo_cell_size_km) {
      log_message(log_fun, "  AOO cell size increased to ", chosen_size,
                  "km (", aoo_cell_size_km, "km would exceed ", max_cells, " cells)")
    }
    aoo_cell_size_km <- chosen_size
    cell_size <- aoo_cell_size_km * 1000
    x0 <- floor(bbox["xmin"] / cell_size) * cell_size
    y0 <- floor(bbox["ymin"] / cell_size) * cell_size
    nx <- ceiling((bbox["xmax"] - x0) / cell_size)
    ny <- ceiling((bbox["ymax"] - y0) / cell_size)

    # Compute cell indices for each point, only create polygons for occupied cells
    coords <- sf::st_coordinates(pts_proj)
    ix <- floor((coords[, 1] - x0) / cell_size) + 1
    iy <- floor((coords[, 2] - y0) / cell_size) + 1
    cell_keys <- paste(ix, iy, sep = ",")
    unique_keys <- unique(cell_keys)
    n_occupied <- length(unique_keys)

    occupied_polys <- lapply(seq_len(n_occupied), function(i) {
      parts <- as.integer(strsplit(unique_keys[i], ",")[[1]])
      cx <- x0 + (parts[1] - 1) * cell_size
      cy <- y0 + (parts[2] - 1) * cell_size
      sf::st_polygon(list(matrix(c(
        cx, cy,
        cx + cell_size, cy,
        cx + cell_size, cy + cell_size,
        cx, cy + cell_size,
        cx, cy
      ), ncol = 2, byrow = TRUE)))
    })

    aoo_grid_proj <- if (n_occupied > 0) sf::st_sf(geometry = sf::st_sfc(occupied_polys, crs = aoo_crs)) else NULL

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
