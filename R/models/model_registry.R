# Model backend registry for SDM fitting and prediction.

sdm_model_registry <- new.env(parent = emptyenv())

register_sdm_model <- function(id, label, method, fit_fun, predict_fun,
                               packages = character(), maturity = "stable",
                               supports_importance = FALSE, supports_uncertainty = FALSE,
                               supports_future = TRUE, diagnostics = list(), notes = character(),
                               predict_component_fun = NULL, fit_component_fun = NULL,
                               min_records = NULL,
                               importance_fun = NULL, pdp_fun = NULL,
                               ale_fun = NULL, shap_fun = NULL) {
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
    min_records = as.integer(min_records)[1] %||% NA_integer_,
    importance_fun = if (is.function(importance_fun)) importance_fun else NULL,
    pdp_fun = if (is.function(pdp_fun)) pdp_fun else NULL,
    ale_fun = if (is.function(ale_fun)) ale_fun else NULL,
    shap_fun = if (is.function(shap_fun)) shap_fun else NULL
  )
  assign(id, spec, envir = sdm_model_registry)
  invisible(spec)
}

sdm_model_ids <- function() {
  sort(ls(envir = sdm_model_registry, all.names = FALSE))
}

sdm_model_choices <- function() {
  ids <- sdm_model_ids()
  if (length(ids) == 0) return(setNames(character(), character()))
  labels <- vapply(ids, function(id) get_sdm_model(id)$label, character(1))
  stats::setNames(labels, ids)
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

# BIOCLIM / Mahalanobis envelope — always available (terra is a hard dependency)
register_sdm_model(
  id = "bioclim",
  label = "BIOCLIM / Mahalanobis envelope",
  method = "Presence-only environmental envelope via terra::bioclim()",
  packages = "terra",
  maturity = "experimental",
  fit_fun = function(...) fit_bioclim_sdm(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_bioclim_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = FALSE,
  supports_uncertainty = FALSE,
  supports_future = TRUE,
  diagnostics = list(cv_auc = TRUE, cv_tss = TRUE),
  notes = "Simple environmental envelope model. Presence-only — does not use background points. No permutation importance.",
  min_records = 5L
)

# INLA Bayesian spatial — conditional on INLA package (special repo, not CRAN)
if (requireNamespace("INLA", quietly = TRUE)) {
  register_sdm_model(
    id = "inla_spde",
    label = "INLA / Bayesian spatial (SPDE)",
    method = "Bayesian spatial SDM via INLA with SPDE Matern covariance",
    packages = "INLA",
    maturity = "experimental",
    fit_fun = function(...) fit_inla_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_inla_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = FALSE,
    supports_uncertainty = TRUE,
    supports_future = TRUE,
    diagnostics = list(waic = TRUE, dic = TRUE, fixed_effects = TRUE),
    notes = "Bayesian spatial model with Matern covariance via INLA-SPDE. Models spatial autocorrelation natively. Requires INLA package from https://inla.r-inla-download.org/R/stable/",
    min_records = 20L
  )
}

# BART (Bayesian Additive Regression Trees) — conditional on dbarts
# Occupancy (unmarked) — conditional on unmarked package
# brms (general Bayesian) — conditional on brms package
# Python executor bridge — conditional on reticulate + arrow
if (requireNamespace("arrow", quietly = TRUE)) {
  python_manifests <- tryCatch(discover_python_models(), error = function(e) character(0))
  for (manifest_path in python_manifests) {
    m <- tryCatch(read_python_model_manifest(manifest_path), error = function(e) NULL)
    if (is.null(m) || is.null(m$id)) next

    register_sdm_model(
      id = paste0("python_", m$id),
      label = m$label,
      method = m$method,
      packages = c("arrow", "reticulate"),
      maturity = "experimental",
      fit_fun = function(..., python_model_id = m$id) fit_python_sdm(..., python_model_id = python_model_id),
      predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
        predict_python_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
      },
      supports_importance = isTRUE(m$supports_importance),
      supports_uncertainty = isTRUE(m$supports_uncertainty),
      supports_future = TRUE,
      diagnostics = list(cv_auc = TRUE),
      notes = paste("Python model via", m$id, "bridge. Requires Python + required pip packages."),
      min_records = m$min_records %||% 10L
    )
  }
}

if (requireNamespace("brms", quietly = TRUE)) {
  register_sdm_model(
    id = "brms",
    label = "brms / General Bayesian (Stan)",
    method = "Full Bayesian inference via brms with cmdstanr backend",
    packages = c("brms", "cmdstanr"),
    maturity = "experimental",
    fit_fun = function(...) fit_brms_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_brms_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = FALSE,
    supports_uncertainty = TRUE,
    supports_future = TRUE,
    diagnostics = list(waic = TRUE, looic = TRUE, coefficients = TRUE, rhat = TRUE),
    notes = "Full Bayesian SDM via brms (Stan backend). First fit compiles Stan code (5-15 min). Subsequent fits use cached model. Provides posterior uncertainty maps.",
    min_records = 30L
  )
}

if (requireNamespace("unmarked", quietly = TRUE)) {
  register_sdm_model(
    id = "occupancy",
    label = "Occupancy (unmarked)",
    method = "Single-season occupancy model accounting for imperfect detection via unmarked",
    packages = "unmarked",
    maturity = "experimental",
    fit_fun = function(...) fit_occupancy_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_occupancy_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = FALSE,
    supports_uncertainty = TRUE,
    supports_future = TRUE,
    diagnostics = list(state_coefficients = TRUE, detection_coefficients = TRUE),
    notes = "Requires detection-history data (repeated surveys), not presence/background. Use read_detection_history() to load data. Detection probability is modeled explicitly.",
    min_records = 10L
  )
}

if (requireNamespace("dbarts", quietly = TRUE)) {
  register_sdm_model(
    id = "bart",
    label = "BART / Bayesian Additive Regression Trees",
    method = "Bayesian sum-of-trees model with uncertainty quantification via dbarts",
    packages = "dbarts",
    maturity = "experimental",
    fit_fun = function(...) fit_bart_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_bart_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = TRUE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, variable_importance = TRUE),
    notes = "Bayesian Additive Regression Trees. Provides native posterior uncertainty (95% CI). Tune ntree/ndpost/nskip.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting BART component")
      predict_bart_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_bart_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

if (requireNamespace("gbm", quietly = TRUE)) {
  register_sdm_model(
    id = "brt",
    label = "BRT / Boosted Regression Trees (gbm)",
    method = "Boosted Regression Trees via the gbm package",
    packages = "gbm",
    maturity = "experimental",
    fit_fun = function(...) fit_brt_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_brt_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, feature_importance = TRUE),
    notes = "BRT via gbm. Handles interactions and nonlinearity. Tune n_trees, interaction_depth, shrinkage.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting BRT component")
      predict_brt_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_brt_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

if (requireNamespace("rpart", quietly = TRUE)) {
  register_sdm_model(
    id = "cta",
    label = "CTA / Classification Tree Analysis (rpart)",
    method = "Classification tree via the rpart package",
    packages = "rpart",
    maturity = "experimental",
    fit_fun = function(...) fit_cta_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_cta_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, variable_importance = TRUE),
    notes = "Simple interpretable classification tree. Good baseline model.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting CTA component")
      predict_cta_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_cta_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

if (requireNamespace("earth", quietly = TRUE)) {
  register_sdm_model(
    id = "mars",
    label = "MARS / Multivariate Adaptive Regression Splines (earth)",
    method = "MARS via the earth package with binomial GLM",
    packages = "earth",
    maturity = "experimental",
    fit_fun = function(...) fit_mars_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_mars_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, variable_importance = TRUE),
    notes = "MARS handles nonlinearity and interactions via hinge functions. Use degree to control interaction order.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting MARS component")
      predict_mars_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_mars_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

if (requireNamespace("mda", quietly = TRUE)) {
  register_sdm_model(
    id = "fda",
    label = "FDA / Flexible Discriminant Analysis (mda)",
    method = "Flexible Discriminant Analysis with MARS regression via the mda package",
    packages = c("mda", "earth"),
    maturity = "experimental",
    fit_fun = function(...) fit_fda_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_fda_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = FALSE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE),
    notes = "FDA extends linear discriminant analysis using MARS. Supports nonlinear class boundaries. Variable importance via permutation.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting FDA component")
      predict_fda_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_fda_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

if (requireNamespace("nnet", quietly = TRUE)) {
  register_sdm_model(
    id = "ann",
    label = "ANN / Artificial Neural Network (nnet)",
    method = "Single-hidden-layer neural network via the nnet package",
    packages = "nnet",
    maturity = "experimental",
    fit_fun = function(...) fit_ann_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_ann_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = FALSE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE),
    notes = "Simple single-hidden-layer ANN. Lighter than cito/torch DNN. Variable importance via permutation.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting ANN component")
      predict_ann_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_ann_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
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
    fit_fast_sdm(
      occ = occ, env_train_scaled = env_train_scaled,
      background_n = background_n, include_quadratic = include_quadratic,
      cv_folds = cv_folds, seed = seed, n_cores = n_cores,
      log_fun = log_fun, bias_method = bias_method,
      target_group_occ = target_group_occ,
      thickening_distance_km = thickening_distance_km,
      cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
    )
  }
)

register_sdm_model(
  id = "gam",
  label = "GAM / Smooth response curves",
  method = "Generalized Additive Model with smooth environmental response curves",
  packages = "mgcv",
  maturity = "stable",
  fit_fun = function(...) fit_gam_sdm(...),
  predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    predict_gam_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  supports_importance = TRUE,
  supports_uncertainty = FALSE,
  supports_future = TRUE,
  diagnostics = list(coefficients = TRUE, cv_auc = TRUE),
  notes = "GAM backend via mgcv with REML smoothing. Supports spatial-block CV. Promoted to stable in Phase 4.",
  predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
    log_message(log_fun, "  Predicting GAM component")
    predict_gam_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
  },
  fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
    fit_gam_sdm(
      occ = occ, env_train_scaled = env_train_scaled,
      background_n = background_n,
      cv_folds = cv_folds, seed = seed, n_cores = n_cores,
      log_fun = log_fun, bias_method = bias_method,
      target_group_occ = target_group_occ,
      thickening_distance_km = thickening_distance_km,
      cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
    )
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
  },
  fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
    fit_rangebag_sdm(
      occ = occ, env_train_scaled = env_train_scaled,
      background_n = background_n,
      cv_folds = cv_folds, seed = seed, n_cores = n_cores,
      log_fun = log_fun
    )
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
    maturity = "stable",
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
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_maxnet_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n, include_quadratic = include_quadratic,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, maxnet_features = maxnet_features,
        maxnet_regmult = maxnet_regmult,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
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

# Random Forest via ranger — conditional registration
if (requireNamespace("ranger", quietly = TRUE)) {
  register_sdm_model(
    id = "rf",
    label = "Random Forest (ranger)",
    method = "Random Forest with permutation importance via ranger package",
    packages = "ranger",
    maturity = "experimental",
    fit_fun = function(...) fit_rf_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_rf_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(coefficients = FALSE, cv_auc = TRUE, cv_tss = TRUE, oob_auc = TRUE),
    notes = "Experimental RF backend via ranger. Handles interactions and nonlinear responses natively.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting RF component")
      predict_rf_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_rf_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

# XGBoost — conditional registration (depends on xgboost, NOT ranger)
if (requireNamespace("xgboost", quietly = TRUE)) {
  register_sdm_model(
    id = "xgboost",
    label = "BRT / XGBoost",
    method = "Boosted Regression Trees via xgboost package",
    packages = "xgboost",
    maturity = "experimental",
    fit_fun = function(...) fit_xgboost_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_xgboost_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(coefficients = FALSE, cv_auc = TRUE, cv_tss = TRUE, feature_importance = TRUE),
    notes = "Experimental XGBoost backend. Handles interactions and nonlinear responses. Tune max_depth/eta/nrounds for best results.",
    predict_component_fun = function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
      log_message(log_fun, "  Predicting XGBoost component")
      predict_xgboost_suitability(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    fit_component_fun = function(occ, env_train_scaled, background_n, include_quadratic, cv_folds, seed, n_cores, log_fun, bias_method, target_group_occ, thickening_distance_km, cv_strategy, cv_block_size_km, maxnet_features, maxnet_regmult, ...) {
      fit_xgboost_sdm(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    }
  )
}

# DNN (cito/torch) — conditional registration (depends on cito+torch, NOT ranger)
if (requireNamespace("cito", quietly = TRUE) && requireNamespace("torch", quietly = TRUE)) {
  register_sdm_model(
    id = "dnn",
    label = "DNN (cito/torch)",
    method = "Deep Neural Network via cito with torch backend",
    packages = c("cito", "torch"),
    maturity = "experimental",
    fit_fun = function(...) fit_dnn_sdm(...),
    predict_fun = function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
      predict_dnn_suitability(fit, env_project_scaled, output_tif, n_cores, log_fun)
    },
    supports_importance = TRUE,
    supports_uncertainty = FALSE,
    supports_future = TRUE,
    diagnostics = list(cv_auc = TRUE, cv_tss = TRUE, shap = TRUE, pdp = TRUE),
    importance_fun = function(fit, ...) fit$cito_importance,
    pdp_fun = function(fit, ...) fit$cito_pdp,
    shap_fun = function(fit, ...) fit$shap,
    notes = "Experimental DNN backend. Requires cito and torch. GPU acceleration if CUDA available. cito::explain() provides SHAP-like feature attribution."
  )
}
