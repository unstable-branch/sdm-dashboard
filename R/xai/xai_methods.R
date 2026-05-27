# XAI method dispatch — unified explanation interface across all backends.
# Each generic function:
#   1. Looks up the model spec from registry
#   2. If a native method exists (e.g. cito::explain for DNN), calls it
#   3. Otherwise falls back to the model-agnostic default

#' Compute variable importance
#' @param fit model fit result list
#' @param method "permutation" (default), "native", or "auto"
#' @param ... passed to the implementation
xai_importance <- function(fit, method = "auto", ...) {
  spec <- get_sdm_model(fit$model_id %||% sdm_default_model_id)
  use_native <- identical(method, "native") ||
    (identical(method, "auto") && !is.null(spec$importance_fun))

  if (use_native) {
    spec$importance_fun(fit, ...)
  } else {
    pred_fun <- build_importance_predict_fun(fit)
    if (is.null(pred_fun)) {
      return(fit$variable_importance %||% data.frame(
        variable = character(), importance = numeric(),
        sd = numeric(), baseline = numeric(), stringsAsFactors = FALSE
      ))
    }
    permutation_importance(
      fit = fit, model_data = fit$model_data,
      predict_fun = pred_fun,
      metric_fun = auc_rank,
      n_perm = getOption("sdm.n_perm", sdm_default_n_perm),
      ...
    )
  }
}

#' Compute partial dependence / response curves
#' @param fit model fit result list
#' @param method "pdp" (generic), "native", "marginal" (hold-at-mean, legacy), or "auto"
#' @param ... passed to the implementation
xai_pdp <- function(fit, method = "auto", ...) {
  spec <- get_sdm_model(fit$model_id %||% sdm_default_model_id)
  use_native <- identical(method, "native") ||
    (identical(method, "auto") && !is.null(spec$pdp_fun))

  if (use_native) {
    spec$pdp_fun(fit, ...)
  } else if (identical(method, "marginal")) {
    compute_response_curves(fit, fit$model_data, ...)
  } else {
    compute_response_curves(fit, fit$model_data, ...)
  }
}

#' Compute Accumulated Local Effects
#' @param fit model fit result list
#' @param method "ale" (generic via iml), "native", or "auto"
#' @param ... passed to the implementation
xai_ale <- function(fit, method = "auto", ...) {
  spec <- get_sdm_model(fit$model_id %||% sdm_default_model_id)
  use_native <- identical(method, "native") ||
    (identical(method, "auto") && !is.null(spec$ale_fun))

  if (use_native) {
    spec$ale_fun(fit, ...)
  } else {
    compute_ale(fit, ...)
  }
}

#' Compute SHAP feature attributions
#' @param fit model fit result list
#' @param method "fastshap" (generic), "native", or "auto"
#' @param ... passed to the implementation
xai_shap <- function(fit, method = "auto", ...) {
  spec <- get_sdm_model(fit$model_id %||% sdm_default_model_id)
  use_native <- identical(method, "native") ||
    (identical(method, "auto") && !is.null(spec$shap_fun))

  if (use_native) {
    spec$shap_fun(fit, ...)
  } else {
    compute_shap_fastshap(fit, ...)
  }
}

#' Build a prediction function for permutation importance.
#' Returns a function(fit, data) that calls the appropriate model-specific
#' predict method, matching the structure expected by permutation_importance().
build_importance_predict_fun <- function(fit) {
  model_id <- fit$model_id %||% "glm"
  model_obj <- fit$model
  if (is.null(model_obj)) return(NULL)

  switch(model_id,
    glm = function(mod, newdata) {
      df <- as.data.frame(newdata)
      if (nrow(df) == 0) return(numeric(0))
      stats::predict.glm(mod$model, newdata = df, type = "response")
    },
    gam = function(mod, newdata) {
      df <- as.data.frame(newdata)
      if (nrow(df) == 0) return(numeric(0))
      predict(mod$model, newdata = df, type = "response")
    },
    rangebag = function(mod, newdata) {
      df <- as.data.frame(newdata)
      if (nrow(df) == 0) return(numeric(0))
      predict_rangebag_values(mod$model, df)
    },
    maxnet = function(mod, newdata) {
      df <- as.data.frame(newdata)
      if (nrow(df) == 0) return(numeric(0))
      as.numeric(maxnet::predict.maxnet(mod$model, df, clamp = TRUE, type = "link"))
    },
    # Default: generic predict()
    function(mod, newdata) {
      df <- as.data.frame(newdata)
      if (nrow(df) == 0) return(numeric(0))
      pred <- predict(mod$model, newdata = df, type = "response")
      if (is.matrix(pred)) pred[, 1] else as.numeric(pred)
    }
  )
}
