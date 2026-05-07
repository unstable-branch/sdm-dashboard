# Marginal (partial) response curves for SDM models.
#
# Computes one curve per covariate by varying that covariate across its training
# range while holding all others at their mean, then predicting suitability.

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
  predict_fun <- get_predict_fun(fit)

  model_data <- as.data.frame(model_data, check.names = FALSE)

  exclude_cols <- c("presence", ".x", ".y", "case_weight_sdm", "cell", "x", "y")
  cov_cols <- setdiff(names(model_data), exclude_cols)
  cov_cols <- cov_cols[vapply(cov_cols, function(c) is.numeric(model_data[[c]]), logical(1))]
  if (length(cov_cols) == 0) stop("No numeric covariate columns found in model_data.", call. = FALSE)

  if (!is.null(env_train) && inherits(env_train, "SpatRaster")) {
    var_ranges <- get_ranges_from_rast(env_train, cov_cols)
  } else {
    var_ranges <- get_ranges_from_data(model_data, cov_cols)
  }

  mean_values <- get_mean_values(model_data, cov_cols)

  curve_results <- lapply(cov_cols, function(var) {
    seq_val <- seq(var_ranges[var, "min"], var_ranges[var, "max"], length.out = n_points)
    newdata <- replicate(n_points, mean_values, simplify = FALSE)
    newdata <- lapply(seq_len(n_points), function(i) {
      row <- mean_values
      row[[var]] <- seq_val[i]
      row
    })
    newdata <- do.call(rbind, newdata)

    pred <- tryCatch(predict_fun(fit, newdata), error = function(e) {
      warning("Prediction failed for covariate '", var, "': ", conditionMessage(e), call. = FALSE)
      rep(NA_real_, nrow(newdata))
    })

    data.frame(
      covariate = var,
      value = seq_val,
      suitability = pred,
      stringsAsFactors = FALSE,
      row.names = NULL
    )
  })
  names(curve_results) <- cov_cols
  curve_results
}

get_predict_fun <- function(fit) {
  model <- fit$model
  if (inherits(model, "glm")) {
    function(fit, newdata) {
      stats::predict.glm(fit$model, newdata = as.data.frame(newdata, check.names = FALSE), type = "response")
    }
  } else if (inherits(model, "gam")) {
    function(fit, newdata) {
      mgcv::predict.gam(fit$model, newdata = as.data.frame(newdata, check.names = FALSE), type = "response")
    }
  } else if (inherits(model, "maxnet")) {
    function(fit, newdata) {
      as.numeric(maxnet::predict.maxnet(fit$model, as.data.frame(newdata, check.names = FALSE), clamp = TRUE, type = "cloglog"))
    }
  } else if (is.list(model) && !is.null(model$bags)) {
    function(fit, newdata) {
      predict_rangebag_values(fit$model, as.data.frame(newdata, check.names = FALSE))
    }
  } else {
    stop("Unsupported model class for response curves: ", class(model)[1], call. = FALSE)
  }
}

get_ranges_from_rast <- function(env_train, cov_cols) {
  available <- intersect(cov_cols, names(env_train))
  if (length(available) == 0) stop("No covariates found in env_train matching model_data columns.", call. = FALSE)
  rast_subset <- env_train[[available]]
  ranges <- t(terra::as.matrix(terra::global(rast_subset, "range", na.rm = TRUE)))
  rownames(ranges) <- c("min", "max")
  colnames(ranges) <- available
  ranges[, cov_cols, drop = FALSE]
}

get_ranges_from_data <- function(model_data, cov_cols) {
  valid_cols <- intersect(cov_cols, names(model_data))
  if (length(valid_cols) == 0) stop("No covariates found in model_data.", call. = FALSE)
  mat <- as.matrix(model_data[, valid_cols, drop = FALSE])
  ranges <- apply(mat, 2, function(x) {
    c(min = min(x, na.rm = TRUE), max = max(x, na.rm = TRUE))
  })
  if (is.vector(ranges)) {
    ranges <- matrix(ranges, nrow = 2, dimnames = c(c("min", "max"), valid_cols))
  }
  t(ranges)
}

get_mean_values <- function(model_data, cov_cols) {
  valid_cols <- intersect(cov_cols, names(model_data))
  col_means <- colMeans(model_data[, valid_cols, drop = FALSE], na.rm = TRUE)
  as.list(as.numeric(col_means))
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
