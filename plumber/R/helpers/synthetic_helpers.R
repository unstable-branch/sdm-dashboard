# Synthetic multi-species occurrence data generator.
# Creates Gaussian-niche occurrence data at architecture-appropriate scales:
#   small  -> DNN_Small:   3 species x  2,000 occ
#   medium -> DNN_Medium:  6 species x 10,000 occ
#   large  -> DNN_Large:  20 species x 50,000 occ
#   custom -> user-defined species x occ
#
# Species have variable niche breadth (sigma 0.1-0.5) for realistic
# community structure. Coordinate errors are injected to stress-test
# the CoordinateCleaner pipeline (sea points, zero coords, centroids).

`%||%` <- function(a, b) if (!is.null(a)) a else b

handle_synthetic_occurrences <- function(req, res, app_dir) {
  body <- tryCatch(jsonlite::fromJSON(req$postBody), error = function(e) NULL)
  if (is.null(body)) {
    res$status <- 400L; return(list(error = "Invalid JSON body"))
  }

  level <- body$level %||% "medium"
  n_species <- as.integer(body$n_species %||% NA_integer_)
  n_occ <- as.integer(body$n_occ %||% NA_integer_)
  seed <- as.integer(body$seed %||% 42L)
  error_rate <- as.numeric(body$error_rate %||% 0.05)  # 5% of points get injected errors

  # Resolve preset levels
  presets <- list(
    small  = list(species = 3L,  occ = 2000L,  raster = 50L,  label = "DNN_Small"),
    medium = list(species = 6L,  occ = 10000L, raster = 100L, label = "DNN_Medium"),
    large  = list(species = 20L, occ = 50000L, raster = 150L, label = "DNN_Large")
  )

  if (identical(level, "custom")) {
    if (is.na(n_species) || is.na(n_occ)) {
      res$status <- 400L; return(list(error = "n_species and n_occ required for custom level"))
    }
    if (n_species < 2L || n_species > 50L) {
      res$status <- 400L; return(list(error = "n_species must be between 2 and 50"))
    }
    if (n_occ < 100L || n_occ > 100000L) {
      res$status <- 400L; return(list(error = "n_occ must be between 100 and 100000"))
    }
    raster_size <- min(200L, max(30L, as.integer(sqrt(n_species * n_occ / 10))))
    label <- "Custom"
  } else if (level %in% names(presets)) {
    p <- presets[[level]]
    n_species <- p$species
    n_occ <- p$occ
    raster_size <- p$raster
    label <- p$label
    seed <- seed + 1L
  } else {
    res$status <- 400L; return(list(error = paste0("Unknown level: ", level,
      ". Use: small, medium, large, or custom")))
  }

  set.seed(seed)

  # ---- 1. Environmental raster (6 uniform random layers) ----
  layer_names <- c("bio1", "bio2", "bio3", "bio4", "bio12", "bio15")
  rasters <- lapply(seq_along(layer_names), function(i) {
    r <- terra::rast(nrows = raster_size, ncols = raster_size,
                     xmin = 140, xmax = 142, ymin = -24, ymax = -22)
    terra::values(r) <- runif(terra::ncell(r), 0, 1)
    r
  })
  env_raster <- do.call(c, rasters)
  names(env_raster) <- layer_names
  env_vals <- terra::values(env_raster)
  complete_cells <- which(stats::complete.cases(env_vals))

  # ---- 2. Species niches with variable breadth ----
  centers <- matrix(0, nrow = n_species, ncol = 6L)
  min_dist <- 1.0 / sqrt(n_species)
  for (s in seq_len(n_species)) {
    for (attempt in 1:100) {
      candidate <- runif(6, 0.1, 0.9)
      if (s == 1) break
      dists <- apply(centers[seq_len(s - 1), , drop = FALSE], 1,
                     function(c) sqrt(sum((candidate - c)^2)))
      if (all(dists >= min_dist)) break
    }
    centers[s, ] <- candidate
  }
  # Variable niche breadth: specialists (sigma=0.1) to generalists (sigma=0.5)
  sigmas <- runif(n_species, 0.1, 0.5)

  # ---- 3. Clean occurrence sampling (Gaussian niche) ----
  species_names <- character(n_species)
  all_occ <- vector("list", n_species)
  for (s in seq_len(n_species)) {
    vals <- env_vals[complete_cells, , drop = FALSE]
    diffs <- sweep(vals, 2, centers[s, ], "-")
    dists <- sqrt(rowSums(diffs^2))
    probs <- exp(-dists^2 / (2 * sigmas[s]^2))
    probs <- probs / sum(probs)
    sample_idx <- sample(length(complete_cells), n_occ, replace = TRUE, prob = probs)
    cell_ids <- complete_cells[sample_idx]
    xy <- terra::xyFromCell(env_raster, cell_ids)
    sp_name <- paste0("Species_", LETTERS[s])
    species_names[s] <- sp_name
    all_occ[[s]] <- data.frame(
      species = rep(sp_name, n_occ),
      longitude = xy[, "x"],
      latitude = xy[, "y"],
      stringsAsFactors = FALSE
    )
  }
  occ_df <- do.call(rbind, all_occ)

  # ---- 4. Inject coordinate errors to stress-test CoordinateCleaner pipeline ----
  if (error_rate > 0) {
    n_total <- nrow(occ_df)
    n_errors <- as.integer(n_total * error_rate)
    if (n_errors > 0) {
      err_idx <- sample(n_total, n_errors)
      # Split errors into types
      n_noise  <- as.integer(n_errors * 0.4)  # 40% GPS noise
      n_sea    <- as.integer(n_errors * 0.25) # 25% sea points
      n_zero   <- as.integer(n_errors * 0.2)  # 20% zero coordinates
      n_centroid <- n_errors - n_noise - n_sea - n_zero  # remainder: centroid-like

      idx <- 1L
      # GPS noise: shift by small random offset (±0.25° ~25km)
      if (n_noise > 0) {
        rows <- err_idx[idx:(idx + n_noise - 1)]
        occ_df$longitude[rows] <- occ_df$longitude[rows] + runif(n_noise, -0.25, 0.25)
        occ_df$latitude[rows]  <- occ_df$latitude[rows]  + runif(n_noise, -0.25, 0.25)
        idx <- idx + n_noise
      }

      # Sea points: push longitude out of land range
      if (n_sea > 0) {
        rows <- err_idx[idx:(idx + n_sea - 1)]
        # Alternate between Atlantic (-50 to -10) and Pacific (155 to 180)
        sea_lons <- ifelse(runif(n_sea) > 0.5, runif(n_sea, -50, -10), runif(n_sea, 155, 180))
        occ_df$longitude[rows] <- sea_lons
        occ_df$latitude[rows]  <- runif(n_sea, -60, 60)
        idx <- idx + n_sea
      }

      # Zero coordinates
      if (n_zero > 0) {
        rows <- err_idx[idx:(idx + n_zero - 1)]
        occ_df$longitude[rows] <- 0
        occ_df$latitude[rows]  <- 0
        idx <- idx + n_zero
      }

      # Centroid-like: assign country centroid coordinates
      if (n_centroid > 0) {
        rows <- err_idx[idx:(idx + n_centroid - 1)]
        # Country centroids within or near the study region
        centroids <- matrix(c(
          133.7751, -25.2744,  # Australia
          147.4849, -32.9783,  # Canberra (capital)
          151.2093, -33.8688,  # Sydney
          174.7633, -41.2865,  # Wellington
         -117.1611, 32.7157,   # San Diego
          121.4737, 31.2304,   # Shanghai
          139.6917, 35.6895,   # Tokyo
          126.9780, 37.5665    # Seoul
        ), ncol = 2, byrow = TRUE)
        ci <- sample(nrow(centroids), n_centroid, replace = TRUE)
        occ_df$longitude[rows] <- centroids[ci, 1]
        occ_df$latitude[rows]  <- centroids[ci, 2]
      }
    }
  }

  # ---- 5. Write CSV with a unique filename ----
  uploads_dir <- file.path(app_dir, "data", "uploads")
  dir.create(uploads_dir, recursive = TRUE, showWarnings = FALSE)
  timestamp <- format(Sys.time(), "%Y%m%d_%H%M%S")
  random_suffix <- paste0(sample(c(0:9, letters[1:6]), 6, replace = TRUE), collapse = "")
  file_name <- paste0("synthetic_", level, "_", n_species, "sp_", timestamp, "_", random_suffix, ".csv")
  file_path <- file.path(uploads_dir, file_name)
  utils::write.csv(occ_df, file_path, row.names = FALSE)

  # Unique file_id using the actual filename so sdm_safe_path can resolve it
  file_id <- file_name

  list(
    file_id = file_id,
    file_path = file_path,
    file_name = file_name,
    n_species = n_species,
    n_records = nrow(occ_df),
    n_errors = if (error_rate > 0) as.integer(nrow(occ_df) * error_rate) else 0L,
    error_rate = error_rate,
    species_names = species_names,
    sigmas = round(sigmas, 3),
    level = level,
    target_architecture = label,
    raster_cells = raster_size * raster_size,
    message = paste0("Generated ", n_species, " species with ", n_occ,
      " occurrences each (", label, " level", 
      if (error_rate > 0) paste0(", ", sprintf("%.1f", error_rate * 100), "% error rate"), ")")
  )
}
