# Ensemble SDM backend.

ensemble_weighted_metric <- function(values, weights) {
  values <- suppressWarnings(as.numeric(values))
  weights <- suppressWarnings(as.numeric(weights))
  ok <- is.finite(values) & is.finite(weights) & weights > 0
  if (!any(ok)) {
    return(NA_real_)
  }
  weights <- weights[ok] / sum(weights[ok])
  sum(values[ok] * weights)
}

ensemble_model_weights <- function(glm_fit, rangebag_fit, weighting = sdm_default_ensemble_weighting) {
  weighting <- match.arg(weighting, c("equal", "auc", "tss"))
  if (identical(weighting, "equal")) {
    return(c(glm = 0.5, rangebag = 0.5))
  }

  metric <- function(fit, name, fallback = 0.5) {
    value <- suppressWarnings(as.numeric(fit$cv[[name]][1]))
    if (is.finite(value) && value > 0) value else fallback
  }
  raw <- if (identical(weighting, "auc")) {
    c(glm = metric(glm_fit, "auc_mean"), rangebag = metric(rangebag_fit, "auc_mean"))
  } else {
    c(glm = max(metric(glm_fit, "tss_mean", 0), 0), rangebag = max(metric(rangebag_fit, "tss_mean", 0), 0))
  }
  if (!all(is.finite(raw)) || sum(raw) <= 0) c(glm = 0.5, rangebag = 0.5) else raw / sum(raw)
}

fit_ensemble_glm_rangebag_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                                          include_quadratic = TRUE, cv_folds = sdm_default_cv_folds,
                                          seed = sdm_default_seed, n_cores = 1, log_fun = NULL,
                                          ensemble_weighting = sdm_default_ensemble_weighting) {
  log_message(log_fun, "Fitting ensemble component: GLM")
  glm_fit <- fit_fast_sdm(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun)
  glm_fit$model_id <- "glm"
  glm_fit$model_label <- "GLM / Logistic regression"

  log_message(log_fun, "Fitting ensemble component: Rangebagging")
  rangebag_fit <- fit_rangebag_sdm(
    occ, env_train_scaled,
    background_n = background_n, include_quadratic = include_quadratic,
    cv_folds = cv_folds, seed = seed, n_cores = n_cores, log_fun = log_fun
  )
  rangebag_fit$model_id <- "rangebag"
  rangebag_fit$model_label <- "Rangebagging"

  weights <- ensemble_model_weights(glm_fit, rangebag_fit, weighting = ensemble_weighting)
  log_message(log_fun, sprintf("Ensemble weights: GLM %.2f, Rangebag %.2f", weights[["glm"]], weights[["rangebag"]]))

  component_auc <- c(glm = glm_fit$cv$auc_mean %||% NA_real_, rangebag = rangebag_fit$cv$auc_mean %||% NA_real_)
  component_tss <- c(glm = glm_fit$cv$tss_mean %||% NA_real_, rangebag = rangebag_fit$cv$tss_mean %||% NA_real_)
  auc_values <- component_auc[is.finite(component_auc)]
  tss_values <- component_tss[is.finite(component_tss)]
  component_k <- c(glm = glm_fit$cv$k %||% NA_real_, rangebag = rangebag_fit$cv$k %||% NA_real_)
  component_k <- component_k[is.finite(component_k)]

  list(
    model = list(glm = glm_fit, rangebag = rangebag_fit, weights = weights, weighting = ensemble_weighting),
    formula = NULL,
    coefficients = data.frame(
      Component = c("GLM / Logistic regression", "Rangebagging"),
      Weight = as.numeric(weights[c("glm", "rangebag")]),
      AUC = c(glm_fit$cv$auc_mean %||% NA_real_, rangebag_fit$cv$auc_mean %||% NA_real_),
      stringsAsFactors = FALSE
    ),
    model_data = glm_fit$model_data,
    occurrence_used = glm_fit$occurrence_used,
    background_xy = glm_fit$background_xy,
    cv = list(
      k = if (length(component_k) > 0) min(component_k) else NA_integer_,
      auc_mean = ensemble_weighted_metric(component_auc, weights[c("glm", "rangebag")]),
      auc_sd = NA_real_,
      auc_component_sd = if (length(auc_values) > 1) stats::sd(auc_values) else NA_real_,
      tss_mean = ensemble_weighted_metric(component_tss, weights[c("glm", "rangebag")]),
      tss_sd = if (length(tss_values) > 1) stats::sd(tss_values) else NA_real_,
      component_metrics = data.frame(
        model = c("glm", "rangebag"),
        auc = c(glm_fit$cv$auc_mean %||% NA_real_, rangebag_fit$cv$auc_mean %||% NA_real_),
        tss = c(glm_fit$cv$tss_mean %||% NA_real_, rangebag_fit$cv$tss_mean %||% NA_real_),
        weight = as.numeric(weights[c("glm", "rangebag")]),
        stringsAsFactors = FALSE
      )
    ),
    covariates = glm_fit$covariates,
    variable_importance = NULL
  )
}

ensemble_component_path <- function(output_tif, suffix) {
  if (grepl("[.]tif$", output_tif, ignore.case = TRUE)) {
    sub("[.]tif$", paste0("_", suffix, ".tif"), output_tif, ignore.case = TRUE)
  } else {
    paste0(output_tif, "_", suffix, ".tif")
  }
}

predict_ensemble_glm_rangebag_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model) || is.null(fit$model$glm) || is.null(fit$model$rangebag)) {
    stop("fit must be an ensemble GLM + Rangebag fit result.", call. = FALSE)
  }
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  glm_tif <- ensemble_component_path(output_tif, "glm")
  rangebag_tif <- ensemble_component_path(output_tif, "rangebag")
  disagreement_tif <- ensemble_component_path(output_tif, "disagreement")

  log_message(log_fun, "Predicting ensemble GLM component")
  glm_suit <- predict_suitability(fit$model$glm$model, env_project_scaled, glm_tif, n_cores, log_fun)
  log_message(log_fun, "Predicting ensemble Rangebagging component")
  rangebag_suit <- predict_rangebag_suitability(fit$model$rangebag, env_project_scaled, rangebag_tif, n_cores, log_fun)

  weights <- fit$model$weights
  ensemble_suit <- (glm_suit * weights[["glm"]]) + (rangebag_suit * weights[["rangebag"]])
  names(ensemble_suit) <- "suitability"
  terra::writeRaster(ensemble_suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))

  disagreement <- abs(glm_suit - rangebag_suit)
  names(disagreement) <- "model_disagreement"
  terra::writeRaster(disagreement, disagreement_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))

  attr(ensemble_suit, "component_paths") <- list(glm = glm_tif, rangebag = rangebag_tif, disagreement = disagreement_tif)
  ensemble_suit
}
