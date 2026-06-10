# Community matrix builder for multi-species SDM.

#' Build a community matrix from multiple species data
#' @param species_data list of data.frames with longitude, latitude columns
#'   OR a single data.frame with a `species` column
#' @param env_train_scaled SpatRaster of environmental covariates
#' @param background_n number of shared background points
#' @param seed random seed
#' @param log_fun optional logging
#' @return list with community_mat, site_xy, covariates, model_data, presence_summary
build_community_matrix <- function(species_data, env_train_scaled, background_n = 10000,
                                    seed = 42, log_fun = NULL) {
  if (is.data.frame(species_data) && "species" %in% names(species_data)) {
    species_names <- unique(species_data$species)
    species_list <- lapply(species_names, function(sp) {
      species_data[species_data$species == sp, , drop = FALSE]
    })
    names(species_list) <- species_names
  } else if (is.list(species_data) && !is.data.frame(species_data)) {
    species_list <- species_data
    species_names <- names(species_list) %||% paste0("sp", seq_along(species_list))
    names(species_list) <- species_names
  } else {
    stop("species_data must be a list of data.frames or a single data.frame with a 'species' column", call. = FALSE)
  }

  n_species <- length(species_list)
  if (n_species < 2) stop("Need at least 2 species for multi-species modeling", call. = FALSE)
  complete_counts <- vapply(species_list, function(sp_data) {
    if (!all(c("longitude", "latitude") %in% names(sp_data))) return(0L)
    sum(stats::complete.cases(sp_data[, c("longitude", "latitude"), drop = FALSE]))
  }, integer(1))
  if (sum(complete_counts >= 2L) < 2L) {
    stop("Need at least 2 species with at least 2 occurrence records for multi-species modeling", call. = FALSE)
  }

  log_message(log_fun, "Building community matrix for ", n_species, " species")

  covariates <- names(env_train_scaled)
  if (length(covariates) < 2) stop("At least two covariates are required.", call. = FALSE)

  # Use the first species' occurrence + background to define training grid
  set.seed(seed)
  template_rast <- env_train_scaled[[1]]

  all_pres_xy <- do.call(rbind, lapply(seq_len(n_species), function(i) {
    sp_data <- species_list[[i]]
    xy <- sp_data[, c("longitude", "latitude"), drop = FALSE]
    names(xy) <- c("x", "y")
    xy$species <- species_names[i]
    xy
  }))
  all_pres_xy <- all_pres_xy[stats::complete.cases(all_pres_xy[, c("x", "y")]), , drop = FALSE]

  # Sample shared background points
  n_pres <- nrow(all_pres_xy)
  valid_cells <- which(is.finite(terra::values(template_rast)))
  bg_idx <- sample(valid_cells, min(background_n, length(valid_cells)), replace = FALSE)
  bg_xy <- terra::xyFromCell(template_rast, bg_idx)
  colnames(bg_xy) <- c("x", "y")
  bg_xy <- as.data.frame(bg_xy)

  # Combine all site coordinates (presence + background)
  all_sites <- rbind(
    data.frame(x = all_pres_xy$x, y = all_pres_xy$y, is_presence = 1L),
    data.frame(x = bg_xy$x, y = bg_xy$y, is_presence = 0L)
  )
  all_sites <- all_sites[!duplicated(all_sites[, c("x", "y")]), , drop = FALSE]
  rownames(all_sites) <- NULL

  site_xy <- all_sites[, c("x", "y"), drop = FALSE]

  # Extract environmental values at all sites
  env_vals <- terra::extract(env_train_scaled, site_xy)
  # terra::extract adds an "ID" column — strip it before passing to model
  if ("ID" %in% names(env_vals)) {
    env_vals <- env_vals[, setdiff(names(env_vals), "ID"), drop = FALSE]
  }
  complete <- stats::complete.cases(env_vals)
  site_xy <- site_xy[complete, , drop = FALSE]
  env_vals <- env_vals[complete, , drop = FALSE]
  all_sites <- all_sites[complete, , drop = FALSE]

  names(env_vals) <- make.names(names(env_vals))
  covariates_clean <- names(env_vals)

  # Build community matrix: rows = sites, columns = species
  n_sites <- nrow(site_xy)
  community_mat <- matrix(0L, nrow = n_sites, ncol = n_species)
  colnames(community_mat) <- species_names

  for (i in seq_len(n_species)) {
    sp_xy <- species_list[[i]]
    sp_xy <- sp_xy[, c("longitude", "latitude"), drop = FALSE]
    names(sp_xy) <- c("x", "y")
    sp_xy <- sp_xy[stats::complete.cases(sp_xy), , drop = FALSE]

    # Match to nearest site
    for (j in seq_len(nrow(sp_xy))) {
      dists <- (site_xy$x - sp_xy$x[j])^2 + (site_xy$y - sp_xy$y[j])^2
      nearest <- which.min(dists)
      community_mat[nearest, i] <- 1L
    }
  }

  # Summary
  n_present_per_species <- colSums(community_mat)
  presence_summary <- data.frame(
    species = species_names,
    n_presences = n_present_per_species,
    stringsAsFactors = FALSE
  )

  model_data <- cbind(as.data.frame(env_vals), site_xy)

  log_message(log_fun, "  Community matrix: ", n_sites, " sites x ", n_species,
    " species (", sum(community_mat), " total presences)")

  list(
    community_mat = community_mat,
    species_names = species_names,
    site_xy = site_xy,
    covariates = covariates_clean,
    model_data = model_data,
    presence_summary = presence_summary,
    n_sites = n_sites,
    n_species = n_species
  )
}
