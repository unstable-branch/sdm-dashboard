# Extent of Occurrence (EOO) and Area of Occupancy (AOO) calculations.
# IUCN Red List Guidelines (Version 15.1, 2022).
# EOO: minimum convex polygon around all presence points
# AOO: number of 2x2 km cells occupied by the species

#' Compute EOO and AOO from occurrence records.
#'
#' @param occ data.frame with longitude and latitude columns
#' @param aoo_cell_size_km Cell size for AOO calculation (default 2 km per IUCN)
#' @param log_fun Optional log function
#' @return list with EOO (km2), AOO (number of cells), polygon, and details
compute_eoo_aoo <- function(occ, aoo_cell_size_km = 2, log_fun = NULL) {
  if (!requireNamespace("sf", quietly = TRUE)) {
    stop("sf package required for EOO/AOO calculation", call. = FALSE)
  }

  if (is.null(occ) || nrow(occ) == 0) {
    return(list(eoo_km2 = NA_real_, aoo_cells = NA_integer_, eoo_polygon = NULL, aoo_grid = NULL))
  }

  # Need at least 3 unique points for MCP
  xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  xy <- xy[stats::complete.cases(xy), , drop = FALSE]

  # Remove duplicates for EOO/AOO
  xy_unique <- unique(xy)
  n_unique <- nrow(xy_unique)

  log_message(log_fun, "Computing EOO/AOO from ", nrow(occ), " records (", n_unique, " unique locations)")

  if (n_unique < 3) {
    log_message(log_fun, "  Too few unique points for EOO (need >= 3); EOO = NA")
    eoo_km2 <- NA_real_
    eoo_polygon <- NULL
  } else {
    # Create sf points (WGS84)
    pts <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)

    # Minimum convex polygon (convex hull)
    eoo_polygon <- tryCatch({
      hull <- sf::st_convex_hull(sf::st_union(pts))

      # Project to equal-area for area calculation
      # Use appropriate UTM zone based on centroid
      centroid <- sf::st_coordinates(sf::st_centroid(hull))
      utm_zone <- floor((centroid[1] + 180) / 6) + 1
      utm_crs <- sf::st_crs(paste0("+proj=utm +zone=", utm_zone, " +datum=WGS84 +units=km"))

      hull_proj <- sf::st_transform(hull, utm_crs)
      area_km2 <- as.numeric(sf::st_area(hull_proj)) / 1e6  # m2 to km2

      log_message(log_fun, "  EOO: ", sprintf("%.1f km2", area_km2), " (MCP, UTM zone ", utm_zone, ")")
      area_km2
    }, error = function(e) {
      log_message(log_fun, "  EOO computation failed: ", conditionMessage(e))
      NA_real_
    })

    eoo_km2 <- eoo_polygon
    eoo_polygon <- tryCatch(sf::st_convex_hull(sf::st_union(pts)), error = function(e) NULL)
  }

  # AOO: count 2x2 km cells occupied
  aoo_result <- tryCatch({
    # Create a grid of 2x2 km cells covering the extent
    pts_sf <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)

    # Project to equal-area for grid
    centroid <- sf::st_coordinates(sf::st_centroid(sf::st_union(pts_sf)))
    utm_zone <- floor((centroid[1] + 180) / 6) + 1
    utm_crs <- sf::st_crs(paste0("+proj=utm +zone=", utm_zone, " +datum=WGS84 +units=m"))
    pts_proj <- sf::st_transform(pts_sf, utm_crs)

    bbox <- sf::st_bbox(pts_proj)
    cell_size <- aoo_cell_size_km * 1000  # km to m

    # Grid origin aligned to round numbers
    x0 <- floor(bbox["xmin"] / cell_size) * cell_size
    y0 <- floor(bbox["ymin"] / cell_size) * cell_size
    x1 <- ceiling(bbox["xmax"] / cell_size) * cell_size
    y1 <- ceiling(bbox["ymax"] / cell_size) * cell_size

    # Create grid polygons
    nx <- ceiling((x1 - x0) / cell_size)
    ny <- ceiling((y1 - y0) / cell_size)

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

    grid_sf <- sf::st_sf(
      geometry = sf::st_sfc(grid_polys, crs = utm_crs)
    )

    # Which cells contain at least one point?
    intersects <- sf::st_intersects(pts_proj, grid_sf, sparse = FALSE)
    occupied <- which(colSums(intersects) > 0)
    n_occupied <- length(occupied)

    log_message(log_fun, "  AOO: ", n_occupied, " cells (", aoo_cell_size_km, "x", aoo_cell_size_km, " km) = ",
      sprintf("%.0f km2", n_occupied * aoo_cell_size_km^2))

    list(n_cells = n_occupied, area_km2 = n_occupied * aoo_cell_size_km^2,
         cell_size_km = aoo_cell_size_km, grid = grid_sf[occupied, ])
  }, error = function(e) {
    log_message(log_fun, "  AOO computation failed: ", conditionMessage(e))
    list(n_cells = NA_integer_, area_km2 = NA_real_, cell_size_km = aoo_cell_size_km, grid = NULL)
  })

  # IUCN threat category guidance
  iucn_status <- "Not evaluated"
  if (is.finite(eoo_km2)) {
    if (eoo_km2 < 100) iucn_status <- "CR (EOO < 100 km2)"
    else if (eoo_km2 < 5000) iucn_status <- "EN (EOO < 5,000 km2)"
    else if (eoo_km2 < 20000) iucn_status <- "VU (EOO < 20,000 km2)"
    else iucn_status <- "LC or NT (EOO >= 20,000 km2)"
  }

  list(
    eoo_km2 = eoo_km2,
    aoo_cells = aoo_result$n_cells,
    aoo_km2 = aoo_result$area_km2,
    aoo_cell_size_km = aoo_result$cell_size_km,
    eoo_polygon = eoo_polygon,
    aoo_grid = aoo_result$grid,
    iucn_eoo_status = iucn_status,
    n_unique_points = n_unique
  )
}
