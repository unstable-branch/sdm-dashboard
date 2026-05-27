# Climate-change driver attribution via SHAP decomposition.
# Decomposes suitability change (future - current) into per-covariate
# contributions using SHAP values.

#' Attribute climate-change suitability changes to individual covariates
#' @param fit model fit result list
#' @param env_current SpatRaster of current environmental covariates
#' @param env_future SpatRaster of future environmental covariates
#' @param model_data data.frame from fit$model_data (used as SHAP background)
#' @param n_samples SHAP Monte Carlo samples
#' @param n_cores CPU cores
#' @param log_fun optional logging function
#' @return list with:
#'   driver_map: SpatRaster of dominant driver per cell
#'   driver_table: data.frame of regional driver contributions
#'   delta_map: SpatRaster of suitability change (future - current)
attribute_climate_drivers <- function(fit, env_current, env_future,
                                       model_data = fit$model_data,
                                       n_samples = 100L,
                                       n_cores = 1,
                                       log_fun = NULL) {
  if (!requireNamespace("fastshap", quietly = TRUE)) {
    log_message(log_fun, "fastshap required for climate driver attribution")
    return(NULL)
  }

  covariates <- fit$covariates
  if (is.null(covariates) || length(covariates) == 0) return(NULL)

  raster_names_current <- names(env_current)
  raster_names_clean_current <- make.names(raster_names_current)
  cov_idx <- match(covariates, raster_names_clean_current)
  if (any(is.na(cov_idx))) {
    stop("Covariates missing from current raster stack", call. = FALSE)
  }
  env_current_sub <- env_current[[raster_names_current[cov_idx]]]

  raster_names_future <- names(env_future)
  raster_names_clean_future <- make.names(raster_names_future)
  cov_idx_f <- match(covariates, raster_names_clean_future)
  if (any(is.na(cov_idx_f))) {
    stop("Covariates missing from future raster stack", call. = FALSE)
  }
  env_future_sub <- env_future[[raster_names_future[cov_idx_f]]]

  pred_fun <- build_importance_predict_fun(fit)
  if (is.null(pred_fun)) return(NULL)

  # Sample cells for SHAP computation (not all cells — too expensive)
  env_df_current <- as.data.frame(terra::values(env_current_sub))
  names(env_df_current) <- covariates
  complete_idx <- which(stats::complete.cases(env_df_current))

  env_df_future <- as.data.frame(terra::values(env_future_sub))
  names(env_df_future) <- covariates

  if (length(complete_idx) == 0) return(NULL)

  max_cells <- 5000L
  if (length(complete_idx) > max_cells) {
    set.seed(42)
    complete_idx <- sort(sample(complete_idx, max_cells))
  }

  sample_current <- env_df_current[complete_idx, , drop = FALSE]
  sample_future <- env_df_future[complete_idx, , drop = FALSE]

  log_message(log_fun, "Computing SHAP-based climate driver attribution for ",
    length(complete_idx), " cells, ", length(covariates), " covariates")

  # Predict suitability for current and future
  wrapped_pred <- function(object, newdata) {
    fit_copy <- fit
    fit_copy$model <- object
    pred <- pred_fun(fit_copy, newdata)
    if (is.matrix(pred)) pred[, 1] else as.numeric(pred)
  }

  current_suit <- wrapped_pred(fit$model, sample_current)
  future_suit <- wrapped_pred(fit$model, sample_future)
  delta <- future_suit - current_suit

  # Compute SHAP for current (background = model_data)
  bg_data <- as.data.frame(model_data[, covariates, drop = FALSE])

  shap_current <- fastshap::explain(
    fit$model, X = bg_data, nsim = n_samples,
    pred_wrapper = wrapped_pred,
    newdata = sample_current, adjust = TRUE
  )

  shap_future <- fastshap::explain(
    fit$model, X = bg_data, nsim = n_samples,
    pred_wrapper = wrapped_pred,
    newdata = sample_future, adjust = TRUE
  )

  if (is.null(shap_current) || is.null(shap_future)) {
    log_message(log_fun, "SHAP computation failed for climate attribution")
    return(NULL)
  }

  shap_current_df <- as.data.frame(shap_current)
  shap_future_df <- as.data.frame(shap_future)
  names(shap_current_df) <- covariates
  names(shap_future_df) <- covariates

  # Per-covariate contribution to delta
  driver_contrib <- shap_future_df - shap_current_df

  # Dominant driver per cell (covariate with largest |contribution|)
  driver_idx <- max.col(abs(as.matrix(driver_contrib)), ties.method = "first")
  dominant_driver <- covariates[driver_idx]

  # Aggregate to regional summary
  driver_summary <- data.frame(
    driver = dominant_driver,
    contribution = rowMeans(abs(driver_contrib)),
    stringsAsFactors = FALSE
  )
  total_contrib <- sum(abs(driver_contrib))
  driver_table <- aggregate(contribution ~ driver, data = driver_summary, sum)
  driver_table$pct <- driver_table$contribution / total_contrib * 100
  driver_table <- driver_table[order(driver_table$pct, decreasing = TRUE), , drop = FALSE]
  names(driver_table)[1] <- "variable"

  # Mean signed contribution per covariate (direction of effect)
  mean_contrib <- colMeans(driver_contrib, na.rm = TRUE)
  mean_contrib_df <- data.frame(
    variable = covariates,
    mean_delta_shap = mean_contrib,
    mean_delta_suitability = tapply(delta, driver_idx, mean, na.rm = TRUE),
    stringsAsFactors = FALSE
  )

  log_message(log_fun,
    "Across the projected range, ", sprintf("%.1f%%", driver_table$pct[1]),
    " of suitability change is attributed to ", driver_table$variable[1])

  list(
    driver_table = driver_table,
    mean_contributions = mean_contrib_df,
    delta_range = range(delta, na.rm = TRUE),
    n_cells_attributed = length(complete_idx),
    n_covariates = length(covariates),
    dominant_driver = as.character(dominant_driver)
  )
}

#' Plot climate driver attribution results
#' @param attribution result from attribute_climate_drivers()
#' @param out_dir optional directory for PNG output
plot_climate_drivers <- function(attribution, out_dir = NULL) {
  if (is.null(attribution)) return(NULL)

  p_table <- ggplot2::ggplot(attribution$driver_table,
    ggplot2::aes(x = stats::reorder(variable, pct), y = pct)) +
    ggplot2::geom_col(fill = "steelblue") +
    ggplot2::coord_flip() +
    ggplot2::labs(x = "Covariate", y = "% contribution to suitability change",
      title = "Climate-change driver attribution") +
    ggplot2::theme_minimal()

  if (!is.null(out_dir)) {
    dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
    ggplot2::ggsave(file.path(out_dir, "climate_drivers.png"), p_table, width = 8, height = 6)
  }
  p_table
}
