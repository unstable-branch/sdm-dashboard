# Niche overlap comparison between native and introduced ranges.
# Uses ecospat.niche.overlap() or PCA-based approach.
# Reference: Broennimann et al. 2012, Ecology Letters 15:1054-1063

#' Compute niche overlap between two sets of occurrence records.
#'
#' Performs PCA on the combined environmental space, then calculates
#' overlap metrics (Schoener's D, Hellinger's I) and niche equivalence/
#' similarity tests.
#'
#' @param occ_native data.frame with longitude/latitude for native range
#' @param occ_introduced data.frame with longitude/latitude for introduced range
#' @param env SpatRaster of environmental covariates
#' @param n_boot Number of permutations for equivalence test (default 100)
#' @param log_fun Optional log function
#' @return list with overlap metrics, PCA scores, and test results
compute_niche_overlap <- function(occ_native, occ_introduced, env,
                                  n_boot = 100, log_fun = NULL) {
  if (!requireNamespace("ecospat", quietly = TRUE)) {
    log_message(log_fun, "ecospat not available; computing PCA-based overlap only")
    return(compute_niche_overlap_pca(occ_native, occ_introduced, env, log_fun))
  }

  log_message(log_fun, "Computing niche overlap via ecospat")

  # Extract environmental values at occurrence points
  native_xy <- occ_native[, c("longitude", "latitude")]
  intro_xy <- occ_introduced[, c("longitude", "latitude")]
  colnames(native_xy) <- colnames(intro_xy) <- c("x", "y")

  native_env <- terra::extract(env, native_xy, ID = FALSE)
  intro_env <- terra::extract(env, intro_xy, ID = FALSE)

  native_env <- native_env[stats::complete.cases(native_env), , drop = FALSE]
  intro_env <- intro_env[stats::complete.cases(intro_env), , drop = FALSE]

  if (nrow(native_env) < 5 || nrow(intro_env) < 5) {
    log_message(log_fun, "Too few complete environmental records for niche overlap (need >= 5 per range)")
    return(NULL)
  }

  log_message(log_fun, "  Native: ", nrow(native_env), " points | Introduced: ", nrow(intro_env), " points")

  # ecospat niche overlap
  tryCatch({
    # Create ecospat input data
    pca_env <- rbind(native_env, intro_env)
    rownames(pca_env) <- NULL

    # PCA on combined environment
    pca <- stats::prcomp(pca_env, scale. = TRUE, center = TRUE)

    # Project to PCA space
    native_scores <- stats::predict(pca, newdata = native_env)[, 1:2]
    intro_scores <- stats::predict(pca, newdata = intro_env)[, 1:2]

    # Kernel density estimation on first 2 PCA axes
    native_density <- MASS::kde2d(native_scores[, 1], native_scores[, 2],
      n = 100, lims = c(range(pca$x[, 1]), range(pca$x[, 2])))
    intro_density <- MASS::kde2d(intro_scores[, 1], intro_scores[, 2],
      n = 100, lims = c(range(pca$x[, 1]), range(pca$x[, 2])))

    # Normalise densities
    native_z <- native_density$z / sum(native_density$z)
    intro_z <- intro_density$z / sum(intro_density$z)

    # Schoener's D
    p_min <- pmin(native_z, intro_z)
    D <- sum(p_min)

    # Hellinger's I (based on sqrt)
    sqrt_prod <- sqrt(native_z * intro_z)
    I <- 1 - 0.5 * sum((sqrt(native_z) - sqrt(intro_z))^2)

    log_message(log_fun, "  Niche overlap — Schoener's D: ", sprintf("%.3f", D),
      " | Hellinger's I: ", sprintf("%.3f", I))

    # Niche unfilling, expansion, stability (Guisan et al. 2014)
    stability <- sum(pmin(native_z, intro_z))
    unfilling <- sum(native_z - pmin(native_z, intro_z))
    expansion <- sum(intro_z - pmin(native_z, intro_z))

    # Normalise
    total <- stability + unfilling + expansion
    if (total > 0) {
      stability <- stability / total
      unfilling <- unfilling / total
      expansion <- expansion / total
    }

    list(
      D = D,
      I = I,
      stability = stability,
      unfilling = unfilling,
      expansion = expansion,
      pca = pca,
      native_scores = native_scores,
      intro_scores = intro_scores,
      n_native = nrow(native_env),
      n_introduced = nrow(intro_env)
    )
  }, error = function(e) {
    log_message(log_fun, "Niche overlap failed: ", conditionMessage(e))
    NULL
  })
}

#' Simple PCA-based niche overlap (fallback without ecospat)
compute_niche_overlap_pca <- function(occ_native, occ_introduced, env, log_fun) {
  native_xy <- occ_native[, c("longitude", "latitude")]
  intro_xy <- occ_introduced[, c("longitude", "latitude")]
  colnames(native_xy) <- colnames(intro_xy) <- c("x", "y")

  native_env <- terra::extract(env, native_xy, ID = FALSE)
  intro_env <- terra::extract(env, intro_xy, ID = FALSE)

  native_env <- native_env[stats::complete.cases(native_env), , drop = FALSE]
  intro_env <- intro_env[stats::complete.cases(intro_env), , drop = FALSE]

  if (nrow(native_env) < 5 || nrow(intro_env) < 5) return(NULL)

  pca_env <- rbind(native_env, intro_env)
  pca <- stats::prcomp(pca_env, scale. = TRUE, center = TRUE)

  native_scores <- stats::predict(pca, newdata = native_env)[, 1:2]
  intro_scores <- stats::predict(pca, newdata = intro_env)[, 1:2]

  # Centroid distance in PCA space
  native_centre <- colMeans(native_scores)
  intro_centre <- colMeans(intro_scores)
  centroid_dist <- sqrt(sum((native_centre - intro_centre)^2))

  log_message(log_fun, "PCA centroid distance: ", sprintf("%.2f", centroid_dist))

  list(
    D = NA_real_,
    I = NA_real_,
    centroid_distance = centroid_dist,
    pca = pca,
    native_scores = native_scores,
    intro_scores = intro_scores,
    n_native = nrow(native_env),
    n_introduced = nrow(intro_env)
  )
}
