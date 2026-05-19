# Marginal (partial) response curves for SDM models.
# Uses marginaleffects for robust model-agnostic response computation.

#' Compute marginal (partial) response curves for each covariate.
#'
#' @param fit model fit result from any fit_*_sdm() function
#' @param model_data data.frame with presence/absence and covariates (from fit$model_data)
#' @param env_train SpatRaster of training covariates (used for ranges and means)
#' @param n_points number of points along the gradient for each covariate
#'
#' @return list of data.frames, one per covariate, with columns:
#'   covariate (character), value (numeric), suitability (numeric)
compute_response_curves <- function(fit, model_data, env_train = NULL, n_points = 50) {
  model <- fit$model
  model_data <- as.data.frame(model_data, check.names = FALSE)

  exclude_cols <- c("presence", ".x", ".y", "case_weight_sdm", "cell", "x", "y")
  cov_cols <- setdiff(names(model_data), exclude_cols)
  cov_cols <- cov_cols[vapply(cov_cols, function(c) is.numeric(model_data[[c]]), logical(1))]
  if (length(cov_cols) == 0) {
    warning("compute_response_curves: no numeric covariate columns found in model_data (names: ", paste(names(model_data), collapse = ", "), ")", call. = FALSE)
    return(list())
  }

  var_ranges <- NULL
  if (!is.null(env_train) && inherits(env_train, "SpatRaster")) {
    var_ranges <- tryCatch(get_ranges_from_rast(env_train, cov_cols), error = function(e) NULL)
  }
  if (is.null(var_ranges)) {
    var_ranges <- tryCatch(get_ranges_from_data(model_data, cov_cols), error = function(e) NULL)
  }
  if (is.null(var_ranges) || nrow(var_ranges) == 0) {
    warning("compute_response_curves: could not compute variable ranges for covariates (", paste(cov_cols, collapse = ", "), ")", call. = FALSE)
    return(list())
  }

  mean_values <- get_mean_values(model_data, cov_cols)

  get_var_range <- function(var_ranges, var) {
    if ("min" %in% rownames(var_ranges)) {
      list(min = var_ranges["min", var], max = var_ranges["max", var])
    } else {
      list(min = var_ranges[var, "min"], max = var_ranges[var, "max"])
    }
  }

  curve_results <- lapply(cov_cols, function(var) {
    rng <- get_var_range(var_ranges, var)
    var_min <- rng$min
    var_max <- rng$max
    if (is.na(var_min) || is.na(var_max) || var_min >= var_max) {
      warning("compute_response_curves: invalid range for '", var, "' (min=", var_min, ", max=", var_max, ")", call. = FALSE)
      return(NULL)
    }

    seq_val <- seq(var_min, var_max, length.out = n_points)
    pred_data <- as.data.frame(matrix(rep(unlist(mean_values), length(seq_val)), nrow = length(seq_val), byrow = TRUE))
    names(pred_data) <- names(mean_values)
    pred_data[[var]] <- seq_val

    preds <- tryCatch(
      if (inherits(model, "maxnet")) {
        maxnet::predict.maxnet(model, newdata = pred_data, clamp = TRUE, type = "response")
      } else {
        predict(model, newdata = pred_data, type = "response")
      },
      error = function(e) {
        warning("compute_response_curves: predict failed for '", var, "': ", conditionMessage(e), call. = FALSE)
        NULL
      }
    )
    if (is.null(preds) || length(preds) == 0) {
      return(NULL)
    }

    data.frame(
      covariate = var,
      value = seq_val,
      suitability = as.numeric(preds),
      x = seq_val,
      fitted = as.numeric(preds),
      stringsAsFactors = FALSE,
      row.names = NULL
    )
  })

  names(curve_results) <- cov_cols
  curve_results[!vapply(curve_results, is.null, logical(1))]
}

get_ranges_from_rast <- function(env_train, cov_cols) {
  available <- intersect(cov_cols, names(env_train))
  if (length(available) == 0) stop("No covariates found in env_train matching model_data columns.", call. = FALSE)
  rast_subset <- env_train[[available]]
  ranges <- t(terra::as.matrix(terra::global(rast_subset, "range", na.rm = TRUE)))
  colnames(ranges) <- available
  rownames(ranges) <- c("min", "max")
  ranges[, cov_cols, drop = FALSE]
}

get_ranges_from_data <- function(model_data, cov_cols) {
  valid_cols <- intersect(cov_cols, names(model_data))
  if (length(valid_cols) == 0) stop("No covariates found in model_data.", call. = FALSE)
  mat <- as.matrix(model_data[, valid_cols, drop = FALSE])
  ranges <- apply(mat, 2, function(x) {
    c(min = min(x, na.rm = TRUE), max = max(x, na.rm = TRUE))
  })
  if (!is.matrix(ranges)) {
    ranges <- matrix(ranges,
      nrow = 2, ncol = length(valid_cols),
      dimnames = list(c("min", "max"), valid_cols)
    )
  }
  result <- t(ranges)
  colnames(result) <- c("min", "max")
  result
}

get_mean_values <- function(model_data, cov_cols) {
  valid_cols <- intersect(cov_cols, names(model_data))
  col_means <- colMeans(model_data[, valid_cols, drop = FALSE], na.rm = TRUE)
  setNames(as.list(as.numeric(col_means)), names(col_means))
}

#' Plot marginal response curves as small-multiples.
#'
#' @param curve_data list of data.frames from compute_response_curves(), OR
#'   a single combined data.frame with $covariate column
#' @param out_dir if provided, save PNG files (one per covariate + combined)
#' @param ncol number of columns in the combined plot grid
#'
#' @return ggplot2 object
plot_response_curves <- function(curve_data, out_dir = NULL, ncol = 3) {
  if (is.list(curve_data) && !is.data.frame(curve_data[[1]]) && length(curve_data) == 0) {
    stop("curve_data is empty.", call. = FALSE)
  }

  if (is.list(curve_data) && is.data.frame(curve_data[[1]])) {
    combined_df <- do.call(rbind, curve_data)
  } else if (is.data.frame(curve_data) && "covariate" %in% names(curve_data)) {
    combined_df <- curve_data
  } else {
    stop("curve_data must be a list of data.frames or a combined data.frame with $covariate column.", call. = FALSE)
  }

  if (!is.null(out_dir) && nzchar(out_dir)) {
    dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
    for (cov in unique(combined_df$covariate)) {
      cov_df <- combined_df[combined_df$covariate == cov, , drop = FALSE]
      p <- ggplot2::ggplot(cov_df, ggplot2::aes(x = value, y = suitability)) +
        ggplot2::geom_line() +
        ggplot2::geom_point(size = 0.5) +
        ggplot2::labs(x = cov, y = "Suitability", title = paste("Response curve:", cov)) +
        ggplot2::theme_minimal()
      ggplot2::ggsave(file.path(out_dir, paste0("response_curve_", cov, ".png")), p, width = 6, height = 4)
    }
    combined_p <- ggplot2::ggplot(combined_df, ggplot2::aes(x = value, y = suitability)) +
      ggplot2::geom_line() +
      ggplot2::facet_wrap(~covariate, scales = "free_x", ncol = ncol) +
      ggplot2::labs(x = "Covariate value", y = "Suitability") +
      ggplot2::theme_minimal()
    ggplot2::ggsave(file.path(out_dir, "response_curves_combined.png"), combined_p, width = 12, height = 10)
  }

  ggplot2::ggplot(combined_df, ggplot2::aes(x = value, y = suitability)) +
    ggplot2::geom_line() +
    ggplot2::facet_wrap(~covariate, scales = "free_x", ncol = ncol) +
    ggplot2::labs(x = "Covariate value", y = "Suitability") +
    ggplot2::theme_minimal()
}
