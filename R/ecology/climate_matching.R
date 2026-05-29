# Climate matching via multivariate environmental distance.
# Implements Climatch-style similarity analysis using:
# 1. Mahalanobis distance (accounts for covariance between variables)
# 2. Euclidean distance (simple, uncorrelated)
# 3. Standardised Euclidean distance (per-variable z-score, no covariance)
# Reference: Climatch v2 (Downey & Boon 2022); Broennimann et al. 2012

#' Compute climate matching distance between training and projection environments.
#'
#' For each cell in the projection area, computes the multivariate distance
#' to the centroid of the training environment (presence sites). Lower values
#' indicate more similar climate conditions.
#'
#' @param env_train SpatRaster or data.frame: training environment (reference climate)
#' @param env_proj SpatRaster: projection environment (target climate)
#' @param method Distance method: "mahalanobis", "euclidean", or "standardised"
#' @param presence_points Optional: data.frame with x/y columns for presence sites.
#'   If NULL, uses the full training raster extent.
#' @param log_fun Optional log function
#' @return list with distance raster, summary stats, and method info
compute_climate_match <- function(env_train, env_proj,
                                  method = c("mahalanobis", "euclidean", "standardised"),
                                  presence_points = NULL,
                                  log_fun = NULL) {
  method <- match.arg(method)
  log_message(log_fun, "Computing climate matching (", method, " distance)")

  # Extract training environment values
  if (inherits(env_train, "SpatRaster")) {
    if (!is.null(presence_points) && all(c("x", "y") %in% names(presence_points))) {
      train_vals <- terra::extract(env_train, presence_points[, c("x", "y")], ID = FALSE)
    } else {
      n_cells <- terra::ncell(env_train)
      sample_size <- min(5000, max(1000, ceiling(n_cells * 0.01)))
      if (n_cells > sample_size) {
        set.seed(42)
        sample_cells <- sample(n_cells, size = sample_size)
        sample_xy <- terra::xyFromCell(env_train[[1]], sample_cells)
        train_vals <- as.data.frame(terra::extract(env_train, sample_xy))
        train_vals <- train_vals[complete.cases(train_vals), ]
      } else {
        train_vals <- as.data.frame(env_train, na.rm = FALSE, xy = FALSE)
      }
    }
  } else {
    train_vals <- as.data.frame(env_train)
  }

  # Common variables
  train_vars <- names(train_vals)
  proj_vars <- names(env_proj)
  common_vars <- intersect(train_vars, proj_vars)

  # Handle make.names mismatch
  if (length(common_vars) == 0) {
    common_vars_clean <- intersect(make.names(train_vars), make.names(proj_vars))
    if (length(common_vars_clean) > 0) {
      # Remap
      train_map <- setNames(train_vars, make.names(train_vars))
      proj_map <- setNames(proj_vars, make.names(proj_vars))
      train_cols <- train_map[common_vars_clean]
      proj_cols <- proj_map[common_vars_clean]
      train_vals <- train_vals[, train_cols, drop = FALSE]
      env_proj_subset <- env_proj[[proj_cols]]
      names(env_proj_subset) <- common_vars_clean
      common_vars <- common_vars_clean
    } else {
      stop("No common variables between training and projection environments", call. = FALSE)
    }
  } else {
    train_vals <- train_vals[, common_vars, drop = FALSE]
    env_proj_subset <- env_proj[[common_vars]]
  }

  train_vals <- train_vals[stats::complete.cases(train_vals), , drop = FALSE]
  if (nrow(train_vals) < 10) {
    stop("Too few complete training samples for climate matching (need >= 10)", call. = FALSE)
  }

  log_message(log_fun, "  Using ", length(common_vars), " variables: ", paste(common_vars, collapse = ", "))

  # Compute training statistics
  train_centre <- colMeans(train_vals)
  train_cov <- stats::cov(train_vals)

  # For Mahalanobis, need invertible covariance matrix
  if (method == "mahalanobis") {
    # Regularise covariance if nearly singular
    eigen_vals <- eigen(train_cov, symmetric = TRUE, only.values = TRUE)$values
    if (min(eigen_vals) < 1e-10) {
      log_message(log_fun, "  Regularising singular covariance matrix (ridge = 1e-6)")
      train_cov <- train_cov + diag(1e-6, ncol(train_cov))
    }
    tryCatch(
      solve(train_cov),
      error = function(e) {
        log_message(log_fun, "  Mahalanobis failed (singular matrix); falling back to standardised Euclidean")
        method <<- "standardised"
      }
    )
  }

  # Compute distance for each projection cell
  compute_dist_block <- function(rast_block) {
    df <- as.data.frame(rast_block)
    if (is.null(dim(df)) || ncol(df) == 1 && length(common_vars) > 1) {
      df <- as.data.frame(matrix(unlist(rast_block), ncol = length(common_vars), byrow = TRUE))
    }
    names(df) <- common_vars
    df_complete <- stats::complete.cases(df)

    dist <- rep(NA_real_, nrow(df))
    if (sum(df_complete) == 0) return(dist)

    df_valid <- df[df_complete, , drop = FALSE]

    if (method == "mahalanobis") {
      d <- stats::mahalanobis(df_valid, train_centre, train_cov)
    } else if (method == "standardised") {
      train_sd <- apply(train_vals, 2, stats::sd, na.rm = TRUE)
      train_sd[train_sd < 1e-10] <- 1
      scaled <- sweep(df_valid, 2, train_centre, "-")
      scaled <- sweep(scaled, 2, train_sd, "/")
      d <- rowSums(scaled^2)
    } else {
      # Euclidean
      scaled <- sweep(df_valid, 2, train_centre, "-")
      d <- rowSums(scaled^2)
    }

    dist[df_complete] <- d
    dist
  }

  dist_rast <- terra::app(env_proj_subset, compute_dist_block)
  names(dist_rast) <- paste0("climatch_", method)

  # Normalise to 0-1 similarity (1 = identical climate, 0 = very different)
  d_max <- terra::global(dist_rast, "max", na.rm = TRUE)[1, 1]
  d_min <- terra::global(dist_rast, "min", na.rm = TRUE)[1, 1]
  d_range <- d_max - d_min

  if (is.finite(d_range) && d_range > 0) {
    similarity <- (d_max - dist_rast) / d_range
    names(similarity) <- paste0("climatch_", method, "_similarity")
  } else {
    similarity <- dist_rast
    similarity[] <- 1
    names(similarity) <- paste0("climatch_", method, "_similarity")
  }

  # Summary statistics
  sim_vals <- terra::values(similarity, na.rm = TRUE)
  summary <- list(
    method = method,
    n_variables = length(common_vars),
    variables = common_vars,
    distance_mean = mean(terra::values(dist_rast, na.rm = TRUE), na.rm = TRUE),
    distance_sd = stats::sd(terra::values(dist_rast, na.rm = TRUE), na.rm = TRUE),
    similarity_mean = mean(sim_vals, na.rm = TRUE),
    similarity_sd = stats::sd(sim_vals, na.rm = TRUE),
    pct_similar = mean(sim_vals > 0.5, na.rm = TRUE) * 100,
    pct_dissimilar = mean(sim_vals < 0.2, na.rm = TRUE) * 100
  )

  log_message(log_fun, "  Climate match: ", sprintf("%.1f%% similar (>0.5), ", summary$pct_similar),
    sprintf("%.1f%% dissimilar (<0.2)", summary$pct_dissimilar))

  rm(sim_vals)
  gc(verbose = FALSE)

  list(
    distance = dist_rast,
    similarity = similarity,
    summary = summary
  )
}
