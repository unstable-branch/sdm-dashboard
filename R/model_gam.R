# Generalized Additive Model SDM backend.

make_gam_formula <- function(covariates, data = NULL, max_k = 5) {
  terms <- vapply(covariates, function(covariate) {
    unique_n <- if (!is.null(data) && covariate %in% names(data)) {
      length(unique(stats::na.omit(data[[covariate]])))
    } else {
      max_k + 1L
    }
    if (!is.finite(unique_n) || unique_n < 4L) {
      covariate
    } else {
      k <- min(max_k, unique_n - 1L)
      sprintf("s(%s, k = %d)", covariate, k)
    }
  }, character(1))
  formula <- stats::as.formula(paste("presence ~", paste(terms, collapse = " + ")))
  environment(formula) <- asNamespace("mgcv")
  formula
}

cross_validate_gam <- function(model_data, formula, k = sdm_default_cv_folds, seed = sdm_default_seed, n_cores = 1) {
  fit_fun <- function(i, model_data, fold_id, threshold) {
    train_data <- model_data[fold_id != i, , drop = FALSE]
    test_data <- model_data[fold_id == i, , drop = FALSE]
    train_formula <- make_gam_formula(setdiff(names(train_data), c("presence", "case_weight_sdm")), train_data)
    train_data$case_weight_sdm <- class_balance_weights(train_data$presence)
    model <- tryCatch(
      mgcv::gam(train_formula, data = train_data, family = stats::binomial(), weights = case_weight_sdm, method = "REML"),
      error = function(e) NULL
    )
    if (is.null(model)) {
      return(metrics_list_to_row(list(auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_,
                                       threshold = threshold, tp = NA_integer_, fp = NA_integer_, tn = NA_integer_, fn = NA_integer_, n = 0L), fold = i))
    }
    pred <- tryCatch(stats::predict(model, newdata = test_data, type = "response"), error = function(e) rep(NA_real_, nrow(test_data)))
    metrics_list_to_row(compute_binary_metrics(test_data$presence, pred, threshold = threshold), fold = i)
  }

  cross_validate_model(model_data, k = k, seed = seed, n_cores = n_cores,
                       cv_strategy = "stratified_random", cv_block_size_km = NA_real_,
                       threshold = sdm_default_threshold, fit_fun = fit_fun,
                       cluster_exports = c("auc_rank", "compute_binary_metrics", "metrics_list_to_row"))
}

fit_gam_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                        include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                        seed = sdm_default_seed, n_cores = 1, log_fun = NULL) {
  if (!requireNamespace("mgcv", quietly = TRUE)) {
    stop("The GAM backend requires the mgcv package. Install mgcv or choose a different model backend.", call. = FALSE)
  }

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  if (sum(!pres_keep) > 0) log_message(log_fun, "Dropped ", sum(!pres_keep), " occurrence records with missing covariates")
  pres_vals <- pres_vals[pres_keep, , drop = FALSE]
  occ_used <- occ[pres_keep, , drop = FALSE]
  if (nrow(pres_vals) < 20) stop("Too few presence records with complete environmental data for GAM fitting.", call. = FALSE)

  bg_xy <- sample_background_points(env_train_scaled, background_n, seed = seed, presence_xy = pres_xy[pres_keep, , drop = FALSE])
  bg_vals <- extract_covariates(env_train_scaled, bg_xy)
  bg_keep <- stats::complete.cases(bg_vals)
  bg_vals <- bg_vals[bg_keep, , drop = FALSE]
  bg_xy <- bg_xy[bg_keep, , drop = FALSE]
  if (nrow(bg_vals) < 100) stop("Too few background points could be sampled for GAM fitting.", call. = FALSE)

  covariates <- make.names(names(env_train_scaled))
  names(pres_vals) <- covariates
  names(bg_vals) <- covariates
  model_data <- rbind(
    data.frame(presence = 1L, pres_vals, check.names = FALSE),
    data.frame(presence = 0L, bg_vals, check.names = FALSE)
  )
  formula <- make_gam_formula(covariates, model_data)
  model_data$case_weight_sdm <- class_balance_weights(model_data$presence)

  log_message(log_fun, "Fitting GAM SDM with ", nrow(pres_vals), " presences and ", nrow(bg_vals), " background points")
  model <- mgcv::gam(formula, data = model_data, family = stats::binomial(), weights = case_weight_sdm, method = "REML")
  cv <- cross_validate_gam(model_data, formula, k = cv_folds, seed = seed, n_cores = n_cores)
  if (is.finite(cv$auc_mean)) {
    log_message(log_fun, "GAM cross-validation AUC: ", sprintf("%.3f", cv$auc_mean), if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else "")
  }

  coefficients <- as.data.frame(summary(model)$p.table)
  coefficients$term <- rownames(coefficients)
  rownames(coefficients) <- NULL
  coefficients <- coefficients[, c("term", setdiff(names(coefficients), "term")), drop = FALSE]

  model$model <- NULL
  model$data <- NULL
  model$y <- NULL
  model$formula <- formula
  if (!is.null(model$call)) model$call <- base::call("gam", formula = formula, family = stats::binomial())

  list(
    model = model,
    formula = formula,
    coefficients = coefficients,
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = NULL
  )
}

predict_gam_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  log_message(log_fun, "Predicting suitability raster with GAM")
  predict_suitability(fit$model, env_project_scaled, output_tif, n_cores, log_fun)
}
