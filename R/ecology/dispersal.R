# Dispersal simulation — kernel-based spread model for invasive species.
# Simulates range expansion from introduction points using a dispersal kernel.
# Reference: Hastings et al. 2005, Ecology Letters 8:91-101

#' Simulate dispersal-driven range expansion.
#'
#' Uses a 2D Gaussian dispersal kernel applied iteratively to the suitability
#' map to simulate range expansion over N time steps. Each step, the species
#' can colonise cells adjacent to already-occupied cells, weighted by
#' suitability and dispersal probability.
#'
#' @param suitability SpatRaster: habitat suitability (0-1)
#' @param introduction_points data.frame with x/y columns for initial colonisation
#' @param n_steps integer: number of time steps to simulate
#' @param dispersal_km numeric: mean dispersal distance in km
#' @param establishment_threshold numeric: minimum suitability for establishment
#' @param raster_res_km numeric: raster resolution in km (for kernel sizing)
#' @param log_fun optional log function
#' @return list with occupancy rasters per step, final extent, summary stats
simulate_dispersal <- function(suitability, introduction_points,
                               n_steps = 10, dispersal_km = 5,
                               establishment_threshold = 0.3,
                               raster_res_km = NULL, log_fun = NULL) {
  log_message(log_fun, "Simulating dispersal: ", n_steps, " steps, ", dispersal_km, " km mean distance")

  # Determine raster resolution
  if (is.null(raster_res_km)) {
    res_deg <- terra::res(suitability)[1]
    # Rough conversion at equator: 1 degree ≈ 111 km
    raster_res_km <- res_deg * 111
  }

  # Create initial occupancy (0 = unoccupied, 1 = occupied)
  occupancy <- terra::ifel(!is.na(suitability), 0, NA)
  if (!is.null(introduction_points) && nrow(introduction_points) > 0) {
    pts <- introduction_points[, c("x", "y")]
    if (!"x" %in% names(introduction_points) && all(c("longitude", "latitude") %in% names(introduction_points))) {
      pts <- introduction_points[, c("longitude", "latitude")]
      names(pts) <- c("x", "y")
    }
    # Mark introduction cells as occupied
    cells <- terra::cellFromXY(suitability, pts)
    cells <- cells[!is.na(cells)]
    occupancy[cells] <- 1
  } else {
    # If no introduction points, use high-suitability cells
    high_suit <- suitability >= 0.7
    occupancy <- terra::ifel(high_suit, 1, occupancy)
  }

  # Create dispersal kernel (2D Gaussian)
  kernel_radius_cells <- ceiling(dispersal_km / raster_res_km) * 3  # 3 SD
  kernel_size <- kernel_radius_cells * 2 + 1

  kx <- seq(-kernel_radius_cells, kernel_radius_cells)
  ky <- seq(-kernel_radius_cells, kernel_radius_cells)
  kgrid <- expand.grid(x = kx, y = ky)
  kdist <- sqrt(kgrid$x^2 + kgrid$y^2) * raster_res_km
  kernel <- exp(-kdist^2 / (2 * dispersal_km^2))
  kernel <- matrix(kernel, nrow = kernel_size, ncol = kernel_size)
  kernel <- kernel / sum(kernel)

  # Iterative dispersal simulation
  step_rasters <- list()
  step_rasters[[1]] <- occupancy

  for (step in seq_len(n_steps - 1) + 1) {
    # Convolve current occupancy with dispersal kernel
    n_cells <- terra::ncell(step_rasters[[step - 1]])
    if (sdm_use_gpu_for(n_cells, min_n = 100000L)) {
      dev <- gpu_device()
      occ_mat <- terra::values(step_rasters[[step - 1]], mat = TRUE)
      occ_tensor <- torch::torch_tensor(occ_mat, device = dev)$reshape(c(1, 1, nrow(occ_mat), ncol(occ_mat)))
      na_mask <- torch::torch_isnan(occ_tensor)
      occ_tensor <- torch::torch_where(na_mask, torch::torch_tensor(0, device = dev), occ_tensor)
      kernel_tensor <- torch::torch_tensor(kernel, device = dev)$reshape(c(1, 1, kernel_size, kernel_size))
      dispersed_tensor <- torch::nnf_conv2d(occ_tensor, kernel_tensor, padding = kernel_radius_cells)
      dispersed_vals <- as.numeric(dispersed_tensor$to(device = "cpu"))
      dispersed <- terra::rast(step_rasters[[step - 1]])
      terra::values(dispersed) <- dispersed_vals
      gpu_empty_cache()
    } else {
      dispersed <- terra::focal(step_rasters[[step - 1]], w = kernel, fun = sum, na.policy = "omit")
    }

    # Establishment: cell must be suitable enough AND receive propagules
    can_establish <- suitability >= establishment_threshold
    received_propagules <- dispersed > 0.01  # minimum propagule pressure

    # New occupancy: already occupied OR newly established
    new_occupancy <- terra::ifel(
      step_rasters[[step - 1]] == 1, 1,  # keep existing
      terra::ifel(can_establish & received_propagules, 1, 0)  # new colonisations
    )
    new_occupancy <- terra::mask(new_occupancy, suitability)

    step_rasters[[step]] <- new_occupancy

    # Count newly occupied cells
    n_new <- sum(terra::values(new_occupancy == 1, na.rm = TRUE)) -
      sum(terra::values(step_rasters[[step - 1]] == 1, na.rm = TRUE))
    log_message(log_fun, "  Step ", step, ": ", n_new, " newly occupied cells")
  }

  # Final statistics
  final_occ <- step_rasters[[n_steps]]
  initial_n <- sum(terra::values(step_rasters[[1]] == 1, na.rm = TRUE))
  final_n <- sum(terra::values(final_occ == 1, na.rm = TRUE))
  expansion_ratio <- if (initial_n > 0) final_n / initial_n else NA_real_

  log_message(log_fun, "Dispersal complete: ", initial_n, " → ", final_n, " cells (",
    sprintf("%.1fx", expansion_ratio), " expansion)")

  list(
    steps = step_rasters,
    final_occupancy = final_occ,
    summary = list(
      n_steps = n_steps,
      dispersal_km = dispersal_km,
      establishment_threshold = establishment_threshold,
      initial_cells = initial_n,
      final_cells = final_n,
      expansion_ratio = expansion_ratio
    )
  )
}
