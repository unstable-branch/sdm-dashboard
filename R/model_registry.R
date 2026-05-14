# Model backend registry for SDM fitting and prediction.

sdm_model_registry <- new.env(parent = emptyenv())

register_sdm_model <- function(id, label, method, fit_fun, predict_fun,
                               packages = character(), maturity = "stable",
                               supports_importance = FALSE, supports_uncertainty = FALSE,
                               supports_future = TRUE, diagnostics = list(), notes = character(),
                               predict_component_fun = NULL, fit_component_fun = NULL,
                               min_records = NULL) {
  id <- as.character(id)[1]
  if (is.na(id) || !nzchar(id)) stop("Model id must be a non-empty string.", call. = FALSE)
  if (!is.function(fit_fun)) stop("fit_fun must be a function for model id: ", id, call. = FALSE)
  if (!is.function(predict_fun)) stop("predict_fun must be a function for model id: ", id, call. = FALSE)

  spec <- list(
    id = id,
    label = as.character(label)[1],
    method = as.character(method)[1],
    packages = as.character(packages),
    maturity = as.character(maturity)[1],
    fit_fun = fit_fun,
    predict_fun = predict_fun,
    supports_importance = isTRUE(supports_importance),
    supports_uncertainty = isTRUE(supports_uncertainty),
    supports_future = isTRUE(supports_future),
    diagnostics = diagnostics,
    notes = as.character(notes),
    predict_component_fun = if (!is.null(predict_component_fun)) predict_component_fun else predict_fun,
    fit_component_fun = fit_component_fun,
    min_records = as.integer(min_records)[1] %||% NA_integer_
  )
  assign(id, spec, envir = sdm_model_registry)
  invisible(spec)
}

sdm_model_ids <- function() {
  sort(ls(envir = sdm_model_registry, all.names = FALSE))
}

sdm_model_choices <- function() {
  ids <- sdm_model_ids()
  labels <- vapply(ids, function(id) get_sdm_model(id)$label, character(1))
  stats::setNames(ids, labels)
}

validate_sdm_model_id <- function(id = sdm_default_model_id) {
  if (is.null(id) || length(id) == 0 || is.na(id[1]) || !nzchar(as.character(id[1]))) {
    id <- sdm_default_model_id
  }
  id <- as.character(id[1])
  ids <- sdm_model_ids()
  if (!(id %in% ids)) {
    stop("Unknown SDM model backend: ", id, ". Available backends: ", paste(ids, collapse = ", "), call. = FALSE)
  }
  id
}

get_sdm_model <- function(id = sdm_default_model_id) {
  id <- validate_sdm_model_id(id)
  get(id, envir = sdm_model_registry, inherits = FALSE)
}

fit_sdm_model <- function(model_id = sdm_default_model_id, ...) {
  model_id <- validate_sdm_model_id(model_id)
  spec <- get_sdm_model(model_id)
  fit <- spec$fit_fun(...)
  if (!is.list(fit)) stop("Model backend did not return a list: ", model_id, call. = FALSE)
  fit$model_id <- model_id
  fit$model_label <- spec$label
  fit$model_method <- spec$method
  fit$model_diagnostics <- spec$diagnostics
  fit
}

predict_sdm_model <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit)) stop("fit must be a model fit result list.", call. = FALSE)
  model_id <- if (!is.null(fit$model_id)) fit$model_id else sdm_default_model_id
  spec <- get_sdm_model(model_id)
  spec$predict_fun(fit, env_project_scaled, output_tif, n_cores = n_cores, log_fun = log_fun)
}

register_sdm_model(
  id = "glm",
  label = "GLM / Logistic regression",
  method = "Fast presence/background GLM with balanced class weights",
  packages = "stats",
  maturity = "stable",
  fit_fun = function(...) fit_fast_sdm(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_suitability(fit$model, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = TRUE,
  supports_uncertainty = FALSE,
  supports_future = TRUE,
  diagnostics = list(coefficients = TRUE, cv_auc = TRUE),
  predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
    log_message(log_fun, "  Predicting GLM component")
    predict_suitability(comp_fit$model, env_project_scaled, output_tif, n_cores, log_fun)
  },
  fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
    fit_fast_sdm(occ = occ, env_train_scaled = env_train_scaled,
                 background_n = background_n, include_quadratic = include_quadratic,
                 cv_folds = cv_folds, seed = seed, n_cores = n_cores,
                 log_fun = log_fun, bias_method = bias_method,
                 target_group_occ = target_group_occ,
                 thickening_distance_km = thickening_distance_km,
                 cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km)
  }
)

register_sdm_model(
  id = "gam",
  label = "GAM / Smooth response curves",
  method = "Generalized Additive Model with smooth environmental response curves",
  packages = "mgcv",
  maturity = "experimental",
  fit_fun = function(...) fit_gam_sdm(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_gam_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = TRUE,
  supports_uncertainty = FALSE,
  supports_future = TRUE,
  diagnostics = list(coefficients = TRUE, cv_auc = TRUE),
  notes = "Experimental mgcv backend for nonlinear environmental response curves.",
  predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
    log_message(log_fun, "  Predicting GAM component")
    predict_gam_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
  }
)

register_sdm_model(
  id = "rangebag",
  label = "Rangebagging",
  method = "Rangebagging presence/background SDM using repeated environmental range bags",
  packages = "terra",
  maturity = "experimental",
  fit_fun = function(...) fit_rangebag_sdm(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_rangebag_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = TRUE,
  supports_uncertainty = FALSE,
  supports_future = TRUE,
  diagnostics = list(coefficients = FALSE, cv_auc = TRUE, cv_tss = TRUE),
  notes = "Experimental backend using dependency-free rectangular range bags.",
  predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
    log_message(log_fun, "  Predicting Rangebagging component")
    predict_rangebag_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
  }
)

register_sdm_model(
  id = "ensemble_glm_rangebag",
  label = "Ensemble (GLM + Rangebagging)",
  method = "AUC-weighted ensemble of GLM and Rangebagging suitability predictions",
  packages = "terra",
  maturity = "experimental",
  fit_fun = function(...) fit_ensemble_glm_rangebag_sdm(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_ensemble_glm_rangebag_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = FALSE,
  supports_uncertainty = TRUE,
  supports_future = TRUE,
  diagnostics = list(coefficients = FALSE, cv_auc = TRUE, cv_tss = TRUE, component_weights = TRUE),
  notes = "Experimental ensemble backend combining standardized GLM and Rangebagging predictions."
)

register_sdm_model(
  id = "multi_ensemble",
  label = "Multi-Model Ensemble",
  method = "User-selected ensemble of multiple SDM algorithms (GLM, GAM, MaxNet, Rangebagging, biomod2) with configurable weighting",
  packages = c("terra"),
  maturity = "experimental",
  fit_fun = function(...) fit_multi_model_ensemble(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_multi_model_ensemble(fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = FALSE,
  supports_uncertainty = TRUE,
  supports_future = TRUE,
  diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, component_metrics = TRUE, component_weights = TRUE),
  notes = "Select 2+ models from GLM, GAM, MaxNet, Rangebagging, and biomod2 algorithms. biomod2 requires options(sdm.enable_biomod2 = TRUE)."
)

if (requireNamespace("biomod2", quietly = TRUE) && isTRUE(getOption("sdm.enable_biomod2", FALSE))) {
  register_sdm_model(
    id = "biomod2",
    label = "biomod2 (multi-algorithm)",
    method = "Ensemble SDM via biomod2 package (GLM, GAM, RF, MAXNET, etc.)",
    packages = c("biomod2", "PresenceAbsence", "pROC"),
    maturity = "experimental",
    fit_fun = function(...) run_biomod2(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_biomod2_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = TRUE,
    supports_future = TRUE,
    diagnostics = list(coefficients = TRUE, cv_auc = TRUE, cv_tss = TRUE, per_algorithm = TRUE),
    notes = "Experimental biomod2 backend. Enable with: options(sdm.enable_biomod2 = TRUE)"
  )
}

if (requireNamespace("maxnet", quietly = TRUE)) {
  register_sdm_model(
    id = "maxnet",
    label = "MaxEnt (maxnet)",
    method = "Maximum entropy presence/background SDM via maxnet/glmnet",
    packages = c("maxnet", "glmnet"),
    maturity = "experimental",
    fit_fun = function(...) fit_maxnet_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_maxnet_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(coefficients = TRUE, cv_auc = TRUE, cv_tss = TRUE),
    notes = "MaxEnt via the maxnet package (glmnet backend, no Java required).",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting MaxNet component")
      predict_maxnet_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    }
  )
}

if (requireNamespace("ecospat", quietly = TRUE) &&
    requireNamespace("biomod2", quietly = TRUE)) {

  register_sdm_model(
    id = "esm_glm",
    label = "ESM — GLM (rare species)",
    method = "Ensembles of Small Models: bivariate GLMs weighted by AUC",
    packages = c("ecospat", "biomod2"),
    maturity = "experimental",
    fit_fun = function(...) fit_esm(..., algorithm = "GLM"),
    predict_fun = predict_esm_suitability,
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, esm_pairs = TRUE, esm_importance = TRUE),
    notes = "Recommended for <30 presence records. Lomba et al. 2010; Breiner et al. 2015, 2018.",
    min_records = 5L
  )

  if (requireNamespace("maxnet", quietly = TRUE)) {
    register_sdm_model(
      id = "esm_maxnet",
      label = "ESM — MaxEnt (rare species)",
      method = "Ensembles of Small Models: bivariate MaxEnt weighted by AUC",
      packages = c("ecospat", "biomod2", "maxnet"),
      maturity = "experimental",
      fit_fun = function(...) fit_esm(..., algorithm = "MAXNET"),
      predict_fun = predict_esm_suitability,
      supports_importance = TRUE,
      supports_uncertainty = FALSE,
      supports_future = TRUE,
      diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, esm_pairs = TRUE, esm_importance = TRUE),
      notes = "ESM with MaxEnt base algorithm. Better for non-linear responses.",
      min_records = 5L
    )
  }
}
