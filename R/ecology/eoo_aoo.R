# Extent of Occurrence (EOO) and Area of Occupancy (AOO) calculations.
# IUCN Red List Guidelines (Version 15.1, 2022).
# EOO: minimum convex polygon (MCP) or alpha hull around all presence points
# AOO: number of 2x2 km cells occupied by the species

#' Compute EOO and AOO from occurrence records.
#'
#' @param occ data.frame with longitude and latitude columns
#' @param aoo_cell_size_km Cell size for AOO calculation (default 2 km per IUCN)
#' @param eoo_method EOO method: "mcp" (convex hull, default) or "alpha_hull"
#' @param alpha Alpha value for alpha hull (km). If NULL, auto-computed from
#'   the distribution of Delaunay edge lengths (mean + 1.5 * SD). Ignored for MCP.
#' @param log_fun Optional log function
#' @return list with EOO (km2), AOO (number of cells), polygon, and details
compute_eoo_aoo <- function(occ, aoo_cell_size_km = 2,
                            eoo_method = c("mcp", "alpha_hull"),
                            alpha = NULL, log_fun = NULL) {
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

  eoo_method <- match.arg(eoo_method)

  if (n_unique < 3) {
    log_message(log_fun, "  Too few unique points for EOO (need >= 3); EOO = NA")
    eoo_km2 <- NA_real_
    eoo_polygon <- NULL
    eoo_method_used <- "none"
  } else {
    pts <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)

    if (identical(eoo_method, "alpha_hull") && n_unique >= 4) {
      eoo_polygon <- tryCatch({
        # Project to UTM for distance calculations
        centroid <- sf::st_coordinates(sf::st_centroid(sf::st_union(pts)))
        if (is.finite(centroid[1])) {
          utm_zone <- min(max(floor((centroid[1] + 180) / 6) + 1, 1), 60)
          utm_crs <- sf::st_crs(paste0("+proj=utm +zone=", utm_zone, " +datum=WGS84 +units=m"))
        } else {
          lon <- if (is.finite(centroid[1])) centroid[1] else 0
          lat <- if (is.finite(centroid[2])) centroid[2] else 0
          utm_crs <- sf::st_crs(paste0("+proj=laea +lon_0=", lon, " +lat_0=", lat, " +datum=WGS84 +units=m"))
        }
        pts_proj <- sf::st_transform(pts, utm_crs)

        # Delaunay triangulation
        tri <- sf::st_triangulate(sf::st_union(pts_proj))
        tri_sf <- sf::st_collection_extract(tri, "POLYGON")

        # Compute edge lengths (triangle perimeters / 2 distances)
        edges_list <- sf::st_geometry(tri_sf)
        all_edges <- lapply(seq_along(edges_list), function(i) {
          coords <- sf::st_coordinates(edges_list[[i]])  # 4 rows (closed polygon)
          d1 <- sqrt(sum((coords[1, ] - coords[2, ])^2))  # m
          d2 <- sqrt(sum((coords[2, ] - coords[3, ])^2))
          d3 <- sqrt(sum((coords[3, ] - coords[1, ])^2))
          c(d1, d2, d3)
        })
        all_edges_m <- unlist(all_edges)

        # Auto-compute alpha if not provided
        alpha_m <- if (is.null(alpha) || !is.finite(alpha) || alpha <= 0) {
          mean(all_edges_m, na.rm = TRUE) + 1.5 * stats::sd(all_edges_m, na.rm = TRUE)
        } else {
          alpha * 1000
        }

        # Keep triangles with all edges <= alpha
        keep_tri <- vapply(seq_along(edges_list), function(i) {
          e <- all_edges[[i]]
          all(e <= alpha_m, na.rm = TRUE)
        }, logical(1))

        if (sum(keep_tri) == 0) {
          # Fall back to convex hull if all triangles are removed
          log_message(log_fun, "  Alpha hull removed all triangles; falling back to MCP")
          hull <- sf::st_convex_hull(sf::st_union(pts_proj))
          area_km2 <- as.numeric(sf::st_area(hull)) / 1e6
          eoo_result <- area_km2
          eoo_poly_out <- hull
          zone_label <- "MCP fallback"
        } else {
          hull <- sf::st_union(tri_sf[keep_tri])
          hull_valid <- sf::st_make_valid(hull)
          area_km2 <- as.numeric(sf::st_area(hull_valid)) / 1e6
          eoo_result <- area_km2
          eoo_poly_out <- hull_valid
          zone_label <- paste0("alpha (", sprintf("%.1f km", alpha_m / 1000), ")")
        }

        if (is.na(area_km2) || area_km2 < 1e-6) {
          log_message(log_fun, "  EOO: degenerate alpha hull")
          NA_real_
        } else {
          log_message(log_fun, "  EOO: ", sprintf("%.1f km2", area_km2), " (alpha hull, ", zone_label, ")")
          eoo_result
        }
      }, error = function(e) {
        log_message(log_fun, "  Alpha hull computation failed: ", conditionMessage(e))
        log_message(log_fun, "  Falling back to MCP")
        NULL
      })

      if (is.null(eoo_polygon)) {
        # Fall through to MCP below
        eoo_polygon <- NULL
      }
    }

    if (is.null(eoo_polygon)) {
      # Minimum convex polygon (convex hull) — default or fallback
      eoo_polygon <- tryCatch({
        hull <- sf::st_convex_hull(sf::st_union(pts))

        centroid <- sf::st_coordinates(sf::st_centroid(hull))
        if (is.finite(centroid[1])) {
          utm_zone <- min(max(floor((centroid[1] + 180) / 6) + 1, 1), 60)
          utm_crs <- sf::st_crs(paste0("+proj=utm +zone=", utm_zone, " +datum=WGS84 +units=m"))
          zone_label <- paste("UTM zone", utm_zone)
        } else {
          lon <- if (is.finite(centroid[1])) centroid[1] else 0
          lat <- if (is.finite(centroid[2])) centroid[2] else 0
          utm_crs <- sf::st_crs(paste0("+proj=laea +lon_0=", lon, " +lat_0=", lat, " +datum=WGS84 +units=m"))
          zone_label <- "LAEA fallback"
        }

        hull_proj <- sf::st_transform(hull, utm_crs)
        area_km2 <- as.numeric(sf::st_area(hull_proj)) / 1e6

        if (is.na(area_km2) || area_km2 < 1e-6) {
          log_message(log_fun, "  EOO: degenerate hull (points may be collinear)")
          NA_real_
        } else {
          log_message(log_fun, "  EOO: ", sprintf("%.1f km2", area_km2), " (MCP, ", zone_label, ")")
          area_km2
        }
      }, error = function(e) {
        log_message(log_fun, "  EOO computation failed: ", conditionMessage(e))
        NA_real_
      })

      eoo_km2 <- eoo_polygon
      eoo_polygon <- tryCatch(sf::st_convex_hull(sf::st_union(pts)), error = function(e) NULL)
      eoo_method_used <- "mcp"
    } else {
      eoo_km2 <- eoo_polygon
      eoo_polygon <- eoo_poly_out
      eoo_method_used <- "alpha_hull"
    }
  }

  # AOO: count 2x2 km cells occupied
  aoo_result <- tryCatch({
    pts_sf <- sf::st_as_sf(xy_unique, coords = c("longitude", "latitude"), crs = 4326)

    # Determine projection — use mean coordinates if centroid is NaN
    centroid <- tryCatch(
      sf::st_coordinates(sf::st_centroid(sf::st_union(pts_sf))),
      error = function(e) NULL
    )
    if (is.null(centroid) || !is.finite(centroid[1])) {
      coords <- sf::st_coordinates(pts_sf)
      centroid <- colMeans(coords, na.rm = TRUE)
    }
    utm_zone <- floor((centroid[1] + 180) / 6) + 1
    if (utm_zone >= 1 && utm_zone <= 60) {
      utm_crs <- sf::st_crs(paste0("+proj=utm +zone=", utm_zone, " +datum=WGS84 +units=m"))
    } else {
      utm_crs <- sf::st_crs(paste0("+proj=laea +lon_0=", centroid[1], " +lat_0=", centroid[2], " +datum=WGS84 +units=m"))
    }
    pts_proj <- sf::st_transform(pts_sf, utm_crs)

    bbox <- sf::st_bbox(pts_proj)
    cell_size <- aoo_cell_size_km * 1000  # km to m

    # Grid origin aligned to round numbers
    x0 <- floor(bbox["xmin"] / cell_size) * cell_size
    y0 <- floor(bbox["ymin"] / cell_size) * cell_size
    nx <- ceiling((bbox["xmax"] - x0) / cell_size)
    ny <- ceiling((bbox["ymax"] - y0) / cell_size)

    # For large extents, use point-based counting to avoid creating millions of cells
    if (nx * ny > 10000) {
      log_message(log_fun, "  Large AOO grid (", nx, "x", ny, " = ", nx * ny, " cells); using point-based counting")
      pts_coords <- sf::st_coordinates(pts_proj)
      cell_x <- pmax(pmin(floor((pts_coords[, "X"] - x0) / cell_size) + 1, nx), 1)
      cell_y <- pmax(pmin(floor((pts_coords[, "Y"] - y0) / cell_size) + 1, ny), 1)
      n_occupied <- length(unique(paste(cell_x, cell_y)))

      log_message(log_fun, "  AOO: ", n_occupied, " cells (", aoo_cell_size_km, "x", aoo_cell_size_km, " km) = ",
        sprintf("%.0f km2", n_occupied * aoo_cell_size_km^2))

      list(n_cells = n_occupied, area_km2 = n_occupied * aoo_cell_size_km^2,
           cell_size_km = aoo_cell_size_km, grid = NULL)
    } else {
      # Create grid polygons for smaller extents
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
      grid_sf <- sf::st_sf(geometry = sf::st_sfc(grid_polys, crs = utm_crs))

      intersects <- sf::st_intersects(pts_proj, grid_sf, sparse = FALSE)
      occupied <- which(colSums(intersects) > 0)
      n_occupied <- length(occupied)

      log_message(log_fun, "  AOO: ", n_occupied, " cells (", aoo_cell_size_km, "x", aoo_cell_size_km, " km) = ",
        sprintf("%.0f km2", n_occupied * aoo_cell_size_km^2))

      list(n_cells = n_occupied, area_km2 = n_occupied * aoo_cell_size_km^2,
           cell_size_km = aoo_cell_size_km, grid = grid_sf[occupied, ])
    }
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
    eoo_method = eoo_method_used,
    aoo_cells = aoo_result$n_cells,
    aoo_km2 = aoo_result$area_km2,
    aoo_cell_size_km = aoo_result$cell_size_km,
    eoo_polygon = eoo_polygon,
    aoo_grid = aoo_result$grid,
    iucn_eoo_status = iucn_status,
    n_unique_points = n_unique
  )
}
