# Area of Applicability (AOA) via weighted dissimilarity.
# Model-weighted extrapolation detection that accounts for variable importance.
# Reference: Meyer & Pebesma 2022, Methods in Ecology and Evolution 13:793-803
# Note: When CAST/caret are unavailable, falls back to a centroid-based weighted
# Mahalanobis dissimilarity. This approximates the DI approach from Meyer & Pebesma
# 2022 but uses a different distance metric (centroid Mahalanobis vs. nearest-neighbour
# DI) and threshold (max training distance vs. CV-derived). Results should be comparable
# but are not identical to CAST::aoa().

#' Compute Area of Applicability (AOA) for an SDM model.
#'
#' The AOA identifies areas where the model can reliably predict, based on
#' the training data distribution weighted by variable importance. This is
#' more informative than MESS because it accounts for which variables the
#' model actually uses.
#'
#' @param model_data data.frame: training data with presence and covariates
#' @param env_proj SpatRaster: projection environment
#' @param covariates character: covariate names (make.names-ified)
#' @param variable_importance data.frame or named numeric: variable importance
#' @param method AOA method: "cast" (uses CAST package) or "weighted_dissim"
#' @param log_fun Optional log function
#' @return list with AOA raster (0-1, 1 = applicable), summary stats
compute_aoa <- function(model_data, env_proj, covariates,
                        variable_importance = NULL,
                        method = c("cast", "weighted_dissim"),
                        log_fun = NULL) {
  method <- match.arg(method)

  # Try CAST method first
  if (method == "cast" && requireNamespace("CAST", quietly = TRUE) &&
      requireNamespace("caret", quietly = TRUE)) {
    return(compute_aoa_cast(model_data, env_proj, covariates, variable_importance, log_fun))
  }

  # Fallback to weighted dissimilarity
  if (method == "cast") {
    log_message(log_fun, "CAST/caret not available; using weighted dissimilarity method for AOA")
  }
  compute_aoa_weighted(model_data, env_proj, covariates, variable_importance, log_fun)
}

#' AOA via CAST::aoa (requires caret model)
compute_aoa_cast <- function(model_data, env_proj, covariates, variable_importance, log_fun) {
  log_message(log_fun, "Computing AOA via CAST::aoa")

  # CAST requires a caret train object, which we don't have for all backends.
  # Fall back to weighted dissimilarity which works with any model.
  log_message(log_fun, "  Note: CAST AOA requires caret model; using weighted dissimilarity instead")
  compute_aoa_weighted(model_data, env_proj, covariates, variable_importance, log_fun)
}

#' Weighted dissimilarity AOA — works with any SDM backend.
#'
#' Computes Mahalanobis distance to the training data centroid,
#' weighted by variable importance. Cells with distance above the
#' maximum training distance are flagged as outside the AOA.
#'
#' Note: This differs from CAST::aoa (Meyer & Pebesma 2022) in two ways:
#' 1) Uses centroid Mahalanobis distance rather than nearest-neighbour DI
#' 2) Threshold is max training distance (not CV-derived)
#' For Meyer & Pebesma-compliant AOA, install the CAST and caret packages.
compute_aoa_weighted <- function(model_data, env_proj, covariates, variable_importance, log_fun) {
  log_message(log_fun, "Computing AOA (weighted dissimilarity method)")

  # Match raster names to covariate names
  raster_names <- names(env_proj)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- covariates[is.na(cov_idx)]
    stop("AOA: missing covariates in projection: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_proj[[raster_names[cov_idx]]]

  # Extract training values
  train_vals <- model_data[, covariates, drop = FALSE]
  train_vals <- train_vals[stats::complete.cases(train_vals), , drop = FALSE]

  if (nrow(train_vals) < 30) {
    log_message(log_fun, "  Too few training samples for AOA (need >= 30); returning NULL")
    return(NULL)
  }

  # Variable importance weights (default equal if not provided)
  if (!is.null(variable_importance)) {
    if (is.data.frame(variable_importance)) {
      imp_vals <- variable_importance$importance
      names(imp_vals) <- variable_importance$variable
      weights <- imp_vals[covariates]
      weights[is.na(weights)] <- 0
    } else if (is.numeric(variable_importance)) {
      weights <- variable_importance[covariates]
      weights[is.na(weights)] <- 0
    } else {
      weights <- rep(1, length(covariates))
    }
  } else {
    weights <- rep(1, length(covariates))
  }

  # Normalise weights to sum to 1
  weights <- pmax(weights, 0)  # ensure non-negative
  if (sum(weights) > 0) weights <- weights / sum(weights) else weights <- rep(1/length(weights), length(weights))

  # Training centroid
  train_centre <- colMeans(train_vals, na.rm = TRUE)

  # Weighted covariance: scale each variable by sqrt(importance) before computing covariance
  centred <- scale(train_vals, center = train_centre, scale = FALSE)
  weighted_centred <- sweep(centred, 2, sqrt(weights), FUN = `*`)
  weighted_cov <- crossprod(weighted_centred) / (nrow(train_vals) - 1)

  # Regularise diagonal for numerical stability
  diag_add <- 1e-6 * mean(diag(weighted_cov), na.rm = TRUE)
  diag(weighted_cov) <- diag(weighted_cov) + diag_add

  # Check invertibility; fall back to diagonal if singular
  tryCatch(
    solve(weighted_cov),
    error = function(e) {
      log_message(log_fun, "  Singular weighted covariance; using diagonal approximation")
      weighted_cov <<- diag(diag(weighted_cov), nrow = ncol(weighted_cov))
    }
  )

  train_dist <- stats::mahalanobis(train_vals, train_centre, weighted_cov)
  threshold <- max(train_dist, na.rm = TRUE)

  n_proj_cells <- terra::ncell(env_subset)
  n_vars <- ncol(weighted_cov)
  if (sdm_use_gpu_for(n_proj_cells * n_vars)) {
    dev <- gpu_device()
    cov_inv <- tryCatch(chol2inv(chol(weighted_cov)), error = function(e) MASS::ginv(weighted_cov))
    cov_inv_t <- torch::torch_tensor(cov_inv, device = dev)
    centre_t <- torch::torch_tensor(train_centre, device = dev)

    proj_vals <- as.matrix(terra::values(env_subset))
    valid <- stats::complete.cases(proj_vals)
    if (any(valid)) {
      x_t <- torch::torch_tensor(proj_vals[valid, , drop = FALSE], device = dev)
      diff <- x_t - centre_t
      mahal <- (diff$matmul(cov_inv_t$t()) * diff)$sum(dim = 2)
      mahal_vals <- as.numeric(mahal$to(device = "cpu"))
      dist_rast <- terra::rast(env_subset[[1]])
      terra::values(dist_rast) <- NA_real_
      dist_rast[which(valid)] <- mahal_vals
    } else {
      dist_rast <- terra::rast(env_subset[[1]])
      terra::values(dist_rast) <- NA_real_
    }
    gpu_empty_cache()
  } else {
    compute_aoa_block <- function(vals) {
      complete <- stats::complete.cases(vals)
      dist <- rep(NA_real_, nrow(vals))
      if (sum(complete) > 0) {
        d <- stats::mahalanobis(vals[complete, , drop = FALSE], train_centre, weighted_cov)
        dist[complete] <- d
      }
      dist
    }
    dist_rast <- terra::app(env_subset, compute_aoa_block)
  }
  names(dist_rast) <- "aoa_distance"

  # AOA mask: 1 = applicable, 0 = outside
  aoa_rast <- terra::ifel(dist_rast <= threshold, 1, 0)
  names(aoa_rast) <- "AOA"

  # Summary
  aoa_vals <- terra::values(aoa_rast, na.rm = TRUE)
  pct_applicable <- mean(aoa_vals == 1, na.rm = TRUE) * 100
  pct_outside <- mean(aoa_vals == 0, na.rm = TRUE) * 100

  log_message(log_fun, "  AOA: ", sprintf("%.1f%%", pct_applicable), " applicable, ",
    sprintf("%.1f%%", pct_outside), " outside training envelope (threshold = ",
    sprintf("%.1f", threshold), ")")

  list(
    aoa = aoa_rast,
    distance = dist_rast,
    threshold = threshold,
    summary = list(
      pct_applicable = pct_applicable,
      pct_outside = pct_outside,
      method = "weighted_dissimilarity",
      n_training = nrow(train_vals),
      threshold = threshold
    )
  )
}
