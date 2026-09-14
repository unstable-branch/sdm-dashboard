# Per-fold preprocessing helpers.
#
# Group-S fixes (S1 + S2):
# Any statistic computed on the training covariates (means / SDs for scaling,
# VIF-based variable selection) must be refit on each CV fold's TRAINING rows
# and applied to the held-out validation rows. Computing these statistics on
# the full dataset before CV silently leaks information across the train/eval
# boundary and produces optimistic performance estimates.
#
# The helpers below are the single source of truth — they are called from
# `cross_validate_*` backends. For backends that don't use cross_validate_model
# (DNN, ESM, BIOCLIM presence-only), the strict per-fold pattern is applied
# in their respective `fit_*_sdm` functions.

#' Fit scaling statistics on a per-fold training subset of a covariate stack.
#'
#' Computes layer-wise means and SDs restricted to the rows in
#' `train_rows` of the cell index of `env_train_scaled`. The returned scaler
#' should be used to transform held-out rows via `apply_fold_scaler`.
#'
#' @param env_train_scaled SpatRaster of the covariates as loaded by
#'   load_environment (already scaled with global stats — we refit per fold).
#' @param train_rows Integer vector of row indices to use for fitting.
#' @param log_fun Optional logger.
#' @return list with `means` (named numeric), `sds` (named numeric).
fit_fold_scaler <- function(env_train_scaled, train_rows, log_fun = NULL) {
  if (!inherits(env_train_scaled, "SpatRaster")) {
    stop("env_train_scaled must be a SpatRaster", call. = FALSE)
  }
  if (length(train_rows) < 2L) {
    stop("train_rows must contain at least 2 cells to fit a scaler", call. = FALSE)
  }
  vals <- tryCatch(
    terra::values(env_train_scaled, mat = TRUE, dataframe = FALSE),
    error = function(e) {
      stop("Failed to extract covariate values: ", conditionMessage(e), call. = FALSE)
    }
  )
  if (is.null(vals) || nrow(vals) == 0L) {
    stop("No covariate values available to fit a scaler", call. = FALSE)
  }
  # Avoid out-of-bounds on subset
  train_rows <- train_rows[train_rows >= 1L & train_rows <= nrow(vals)]
  if (length(train_rows) < 2L) {
    stop("train_rows out of bounds for raster values", call. = FALSE)
  }
  sub <- vals[train_rows, , drop = FALSE]
  ok <- stats::complete.cases(sub)
  if (sum(ok) < 2L) {
    stop("Not enough complete cases to fit a per-fold scaler", call. = FALSE)
  }
  sub <- sub[ok, , drop = FALSE]
  means <- colMeans(sub, na.rm = TRUE)
  sds <- apply(sub, 2, stats::sd, na.rm = TRUE)
  sds[!is.finite(sds) | sds <= 0] <- 1
  names(means) <- names(env_train_scaled)
  names(sds) <- names(env_train_scaled)
  list(means = means, sds = sds, n_fit = sum(ok))
}

#' Apply a fold-fitted scaler to a vector or matrix of covariate values.
#'
#' @param values numeric matrix or data.frame with one column per covariate.
#' @param scaler list from `fit_fold_scaler`.
#' @return numeric matrix with same shape as input.
apply_fold_scaler <- function(values, scaler) {
  if (!is.list(scaler) || is.null(scaler$means) || is.null(scaler$sds)) {
    stop("scaler must be the list returned by fit_fold_scaler", call. = FALSE)
  }
  means <- scaler$means
  sds <- scaler$sds
  if (is.data.frame(values)) {
    out <- as.matrix(values)
  } else if (is.matrix(values)) {
    out <- values
  } else if (is.numeric(values) && length(values) == length(means)) {
    out <- matrix(values, nrow = 1L)
  } else {
    stop("values must be a matrix, data.frame, or numeric vector matching scaler length", call. = FALSE)
  }
  if (ncol(out) != length(means)) {
    stop("values column count (", ncol(out), ") does not match scaler covariate count (", length(means), ")", call. = FALSE)
  }
  sweep(sweep(out, 2, means, "-"), 2, sds, "/")
}

#' Refit VIF-based variable selection on a fold's training covariate sample.
#'
#' @param sample_cells Integer vector of cell indices (within
#'   `env_train_scaled`) sampled for VIF computation.
#' @param env_train_scaled SpatRaster of the covariates.
#' @param threshold VIF threshold (default 10).
#' @param seed Seed forwarded to apply_vif_selection.
#' @param log_fun Optional logger.
#' @return list with the same shape as `apply_vif_selection`.
fold_vif_selection <- function(sample_cells, env_train_scaled, threshold = 10,
                                seed = 42, log_fun = NULL) {
  if (!inherits(env_train_scaled, "SpatRaster")) {
    stop("env_train_scaled must be a SpatRaster", call. = FALSE)
  }
  vals <- tryCatch(
    terra::values(env_train_scaled, mat = TRUE, dataframe = FALSE),
    error = function(e) {
      stop("Failed to extract covariate values: ", conditionMessage(e), call. = FALSE)
    }
  )
  if (is.null(vals) || nrow(vals) == 0L) {
    return(list(
      selected = names(env_train_scaled), dropped = character(0),
      vif_result = NULL, covars_selected = NULL
    ))
  }
  sample_cells <- sample_cells[sample_cells >= 1L & sample_cells <= nrow(vals)]
  if (length(sample_cells) == 0L) {
    return(list(
      selected = names(env_train_scaled), dropped = character(0),
      vif_result = NULL, covars_selected = NULL
    ))
  }
  covar_samples <- as.data.frame(vals[sample_cells, , drop = FALSE])
  colnames(covar_samples) <- names(env_train_scaled)
  covar_samples <- covar_samples[stats::complete.cases(covar_samples), , drop = FALSE]
  if (nrow(covar_samples) < 100) {
    return(list(
      selected = names(env_train_scaled), dropped = character(0),
      vif_result = NULL, covars_selected = NULL
    ))
  }
  apply_vif_selection(covar_samples, threshold = threshold, log_fun = log_fun)
}
