# Area of Applicability (AOA) via CAST package.
# Model-weighted extrapolation detection that accounts for variable importance.
# Reference: Meyer & Pebesma 2022, Methods in Ecology and Evolution 13:793-803

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
#' Computes Mahalanobis-type distance to the training data centroid,
#' weighted by variable importance. Cells with distance above the
#' maximum training distance are flagged as outside the AOA.
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

  # Weighted covariance
  weighted_cov <- stats::cov(train_vals) * (weights %*% t(weights))

  # Regularise
  diag_add <- 1e-6
  diag(weighted_cov) <- diag(weighted_cov) + diag_add

  # Training centroid
  train_centre <- colMeans(train_vals)

  # Compute Mahalanobis distance for training points (to find threshold)
  tryCatch(
    solve(weighted_cov),
    error = function(e) {
      log_message(log_fun, "  Singular weighted covariance; using diagonal approximation")
      weighted_cov <<- diag(diag(stats::cov(train_vals)) + diag_add)
    }
  )

  train_dist <- stats::mahalanobis(train_vals, train_centre, weighted_cov)
  threshold <- max(train_dist, na.rm = TRUE)

  # Distance for projection cells
  compute_aoa_block <- function(rast_block) {
    df <- as.data.frame(rast_block)
    names(df) <- covariates
    complete <- stats::complete.cases(df)
    dist <- rep(NA_real_, nrow(df))
    if (sum(complete) > 0) {
      d <- stats::mahalanobis(df[complete, , drop = FALSE], train_centre, weighted_cov)
      dist[complete] <- d
    }
    dist
  }

  dist_rast <- terra::app(env_subset, compute_aoa_block, nodes = TRUE)
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
