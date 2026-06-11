# Accumulated Local Effects (ALE) for SDM models.
# ALE provides unbiased feature effects when covariates are correlated,
# unlike PDP which extrapolates into impossible feature combinations.
# Reference: Apley & Zhu 2020, https://doi.org/10.1111/rssb.12377

#' Compute ALE for all covariates in a fitted SDM model
#' @param fit model fit result list
#' @param model_data data.frame with covariates (from fit$model_data)
#' @param n_points number of bins along each covariate
#' @param log_fun optional logging function
#' @return list of data.frames, one per covariate, with columns:
#'   covariate, value, ale (centered effect), y_mean (mean prediction)
compute_ale <- function(fit, model_data = fit$model_data,
                        n_points = 50, log_fun = NULL) {
  model_obj <- fit$model
  model_id <- fit$model_id %||% "glm"
  if (is.null(model_obj) || is.null(model_data)) {
    return(list())
  }

  exclude_cols <- c("presence", ".x", ".y", "case_weight_sdm", "cell", "x", "y")
  cov_cols <- setdiff(names(model_data), exclude_cols)
  cov_cols <- cov_cols[vapply(cov_cols, function(c) is.numeric(model_data[[c]]), logical(1))]
  if (length(cov_cols) == 0) return(list())

  pred_fun <- build_importance_predict_fun(fit)
  if (is.null(pred_fun)) return(list())

  base_pred <- pred_fun(fit, model_data)
  y_mean <- mean(base_pred, na.rm = TRUE)

  ale_results <- lapply(cov_cols, function(var) {
    tryCatch({
      compute_ale_one_var(model_data, var, pred_fun, fit, n_points, y_mean)
    }, error = function(e) {
      log_message(log_fun, "ALE failed for '", var, "': ", conditionMessage(e))
      NULL
    })
  })

  names(ale_results) <- cov_cols
  ale_results[!vapply(ale_results, is.null, logical(1))]
}

compute_ale_one_var <- function(model_data, var, pred_fun, fit, n_points, y_mean) {
  vals <- model_data[[var]]
  if (!is.numeric(vals)) return(NULL)

  na_ok <- is.finite(vals)
  vals <- vals[na_ok]
  if (length(vals) < 10) return(NULL)

  grid <- stats::quantile(vals, probs = seq(0, 1, length.out = n_points + 1), na.rm = TRUE)
  grid <- unique(grid)
  if (length(grid) < 3) return(NULL)

  bin_labels <- cut(vals, breaks = grid, include.lowest = TRUE, labels = FALSE)
  n_bins <- length(grid) - 1

  ale_values <- numeric(n_bins)
  for (k in seq_len(n_bins)) {
    in_bin <- which(bin_labels == k)
    if (length(in_bin) < 2) {
      ale_values[k] <- NA
      next
    }

    x_upper <- grid[k + 1]
    x_lower <- grid[k]

    data_upper <- model_data[na_ok, , drop = FALSE][in_bin, , drop = FALSE]
    data_lower <- data_upper
    data_upper[[var]] <- x_upper
    data_lower[[var]] <- x_lower

    pred_upper <- pred_fun(fit, data_upper)
    pred_lower <- pred_fun(fit, data_lower)
    if (!is.numeric(pred_upper) || !is.numeric(pred_lower)) {
      ale_values[k] <- NA
      next
    }

    diffs <- pred_upper - pred_lower
    ale_values[k] <- mean(diffs, na.rm = TRUE)
  }

  finite_idx <- which(is.finite(ale_values))
  if (length(finite_idx) < 2) return(NULL)

  ale_centered <- cumsum(ale_values)
  ale_centered <- ale_centered - mean(ale_centered[finite_idx], na.rm = TRUE)

  bin_mid <- (grid[-length(grid)] + grid[-1]) / 2

  data.frame(
    covariate = var,
    value = bin_mid,
    ale = ale_centered,
    y_mean = y_mean,
    stringsAsFactors = FALSE,
    row.names = NULL
  )
}

#' Plot ALE curves as small-multiples
#' @param ale_data list of data.frames from compute_ale()
#' @param out_dir optional directory for PNG output
#' @param ncol columns in grid
plot_ale <- function(ale_data, out_dir = NULL, ncol = 3) {
  if (length(ale_data) == 0) stop("ALE data is empty", call. = FALSE)

  combined <- as.data.frame(data.table::rbindlist(ale_data))
  combined <- combined[is.finite(combined$ale), , drop = FALSE]

  p <- ggplot2::ggplot(combined, ggplot2::aes(x = value, y = ale)) +
    ggplot2::geom_line() +
    ggplot2::geom_hline(yintercept = 0, linetype = "dashed", alpha = 0.5) +
    ggplot2::facet_wrap(~covariate, scales = "free_x", ncol = ncol) +
    ggplot2::labs(x = "Covariate value", y = "ALE (centered effect)",
      title = "Accumulated Local Effects") +
    ggplot2::theme_minimal()

  if (!is.null(out_dir)) {
    dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
    ggplot2::ggsave(file.path(out_dir, "ale_curves.png"), p, width = 12, height = 10)
    for (cov in unique(combined$covariate)) {
      cov_df <- combined[combined$covariate == cov, , drop = FALSE]
      cp <- ggplot2::ggplot(cov_df, ggplot2::aes(x = value, y = ale)) +
        ggplot2::geom_line() +
        ggplot2::geom_hline(yintercept = 0, linetype = "dashed", alpha = 0.5) +
        ggplot2::labs(x = cov, y = "ALE", title = paste("ALE:", cov)) +
        ggplot2::theme_minimal()
      ggplot2::ggsave(file.path(out_dir, paste0("ale_", cov, ".png")), cp, width = 6, height = 4)
    }
  }
  p
}
