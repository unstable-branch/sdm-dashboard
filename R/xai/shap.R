# Model-agnostic SHAP feature attribution.

#' Compute SHAP values for a fitted SDM model
#' @param fit model fit result list
#' @param model_data data.frame with covariates (from fit$model_data)
#' @param n_samples number of Monte Carlo samples for fastshap
#' @param n_cores CPU cores for parallel computation
#' @param log_fun optional logging function
#' @return data.frame with columns: variable, shap (mean abs), value, sign
compute_shap <- function(fit, model_data = fit$model_data,
                         n_samples = 100L, n_cores = 1,
                         log_fun = NULL) {
  if (!requireNamespace("fastshap", quietly = TRUE)) {
    log_message(log_fun, "fastshap package not available; install with: install.packages('fastshap')")
    return(NULL)
  }

  model_obj <- fit$model
  if (is.null(model_obj)) return(NULL)

  exclude_cols <- c("presence", ".x", ".y", "case_weight_sdm", "cell", "x", "y")
  cov_cols <- setdiff(names(model_data), exclude_cols)
  cov_cols <- cov_cols[vapply(cov_cols, function(c) is.numeric(model_data[[c]]), logical(1))]
  if (length(cov_cols) == 0) return(NULL)

  pred_fun <- build_importance_predict_fun(fit)
  if (is.null(pred_fun)) return(NULL)

  x_data <- as.data.frame(model_data[, cov_cols, drop = FALSE])
  wrapped_pred <- function(object, newdata) {
    fit_copy <- fit
    fit_copy$model <- object
    pred <- pred_fun(fit_copy, newdata)
    if (is.matrix(pred)) pred[, 1] else as.numeric(pred)
  }

  shap <- tryCatch({
    fastshap::explain(
      model_obj,
      X = x_data,
      nsim = n_samples,
      pred_wrapper = wrapped_pred,
      adjust = TRUE,
      parallel = n_cores > 1
    )
  }, error = function(e) {
    log_message(log_fun, "SHAP computation failed: ", conditionMessage(e))
    NULL
  })

  if (is.null(shap) || !is.matrix(shap) && !is.data.frame(shap)) return(NULL)

  shap_df <- as.data.frame(shap)
  names(shap_df) <- cov_cols

  shap_summary <- data.frame(
    variable = cov_cols,
    importance = colMeans(abs(shap_df), na.rm = TRUE),
    mean_shap = colMeans(shap_df, na.rm = TRUE),
    sd_shap = vapply(shap_df, function(x) stats::sd(x, na.rm = TRUE), numeric(1)),
    stringsAsFactors = FALSE
  )
  shap_summary <- shap_summary[order(shap_summary$importance, decreasing = TRUE), , drop = FALSE]
  imp_max <- max(shap_summary$importance, na.rm = TRUE)
  if (is.finite(imp_max) && imp_max > 0) {
    shap_summary$importance <- shap_summary$importance / imp_max
  }

  list(
    summary = shap_summary,
    values = shap_df
  )
}

#' Compute SHAP for a single prediction cell
#' @param fit model fit result list
#' @param cell_values named numeric vector of covariate values for one cell
#' @param background model_data used as background distribution
#' @param n_samples Monte Carlo samples
#' @return named numeric vector of SHAP values
compute_shap_cell <- function(fit, cell_values, background = fit$model_data,
                              n_samples = 100L) {
  covariates <- names(cell_values)
  bg_df <- as.data.frame(background[, covariates, drop = FALSE])

  pred_fun <- build_importance_predict_fun(fit)
  if (is.null(pred_fun)) return(NULL)

  wrapped_pred <- function(object, newdata) {
    fit_copy <- fit
    fit_copy$model <- object
    pred <- pred_fun(fit_copy, newdata)
    if (is.matrix(pred)) pred[, 1] else as.numeric(pred)
  }

  shap <- fastshap::explain(
    fit$model,
    X = bg_df,
    nsim = n_samples,
    pred_wrapper = wrapped_pred,
    newdata = as.data.frame(t(cell_values)),
    adjust = TRUE
  )

  result <- as.numeric(shap)
  names(result) <- covariates
  result
}
