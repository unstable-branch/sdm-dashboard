# Calibration plot for SDM models.
# Binned observed vs predicted frequency (Pearce & Ferrier 2000).

#' Compute calibration data for a model.
#'
#' @param model_data data.frame with $presence (0/1) and covariate columns
#' @param fit model fit result (must have $model, $covariates)
#' @param n_bins number of bins (default 10)
#' @return data.frame with bin_mid, observed, predicted, n
compute_calibration <- function(model_data, fit, n_bins = 10) {
  covariates <- fit$covariates
  pred <- tryCatch({
    if (inherits(fit$model, "maxnet")) {
      as.numeric(predict(fit$model, model_data[, covariates, drop = FALSE], clamp = TRUE, type = "response"))
    } else if (inherits(fit$model, "ranger")) {
      predict(fit$model, data = model_data[, covariates, drop = FALSE])$predictions
    } else if (inherits(fit$model, "list") && inherits(fit$model$xgb_fit, "xgb.Booster")) {
      stats::predict(fit$model$xgb_fit, as.matrix(model_data[, covariates, drop = FALSE]))
    } else if (inherits(fit$model, "xgb.Booster")) {
      stats::predict(fit$model, as.matrix(model_data[, covariates, drop = FALSE]))
    } else if (inherits(fit$model, "dbarts")) {
      pred_list <- predict(fit$model, newdata = as.matrix(model_data[, covariates, drop = FALSE]))
      pnorm(as.numeric(colMeans(pred_list$yhat.test)))
    } else {
      stats::predict(fit$model, newdata = model_data[, covariates, drop = FALSE], type = "response")
    }
  }, error = function(e) rep(NA_real_, nrow(model_data)))

  obs <- model_data$presence
  ok <- is.finite(pred) & is.finite(obs)
  pred <- pred[ok]
  obs <- obs[ok]

  if (length(pred) < 20) {
    return(data.frame(bin_mid = numeric(0), observed = numeric(0),
                      predicted = numeric(0), n = integer(0)))
  }

  bins <- cut(pred, breaks = seq(0, 1, length.out = n_bins + 1), include.lowest = TRUE, right = TRUE)
  bin_mid <- (seq_len(n_bins) - 0.5) / n_bins

  cal <- data.frame(
    bin_mid = bin_mid,
    observed = tapply(obs, bins, mean, na.rm = TRUE),
    predicted = tapply(pred, bins, mean, na.rm = TRUE),
    n = as.integer(tapply(obs, bins, length)),
    stringsAsFactors = FALSE
  )
  cal <- cal[!is.na(cal$observed), , drop = FALSE]
  cal
}

#' Plot calibration curve.
#'
#' @param cal_data data.frame from compute_calibration()
#' @return ggplot2 object
plot_calibration <- function(cal_data) {
  if (nrow(cal_data) == 0 || !requireNamespace("ggplot2", quietly = TRUE)) {
    if (!requireNamespace("ggplot2", quietly = TRUE)) {
      plot.new(); title("ggplot2 not available"); return(invisible(NULL))
    }
    return(ggplot2::ggplot() + ggplot2::theme_void() + ggplot2::labs(title = "No calibration data"))
  }

  ggplot2::ggplot(cal_data, ggplot2::aes(x = predicted, y = observed)) +
    ggplot2::geom_abline(slope = 1, intercept = 0, linetype = "dashed", colour = "#a8b6c7") +
    ggplot2::geom_point(ggplot2::aes(size = n), colour = "#2166ac", alpha = 0.8) +
    ggplot2::geom_line(colour = "#2166ac", alpha = 0.5) +
    ggplot2::scale_size_area(max_size = 6, guide = "none") +
    ggplot2::scale_x_continuous(limits = c(0, 1), expand = c(0.02, 0.02)) +
    ggplot2::scale_y_continuous(limits = c(0, 1), expand = c(0.02, 0.02)) +
    ggplot2::labs(
      x = "Predicted suitability (bin mean)",
      y = "Observed proportion presences",
      title = "Calibration plot"
    ) +
    ggplot2::theme_minimal(base_size = 11) +
    ggplot2::theme(panel.grid.minor = ggplot2::element_blank())
}
