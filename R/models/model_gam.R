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

cross_validate_gam <- function(model_data, formula, k = sdm_default_cv_folds, seed = sdm_default_seed, n_cores = 1,
                                cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                                log_fun = NULL, max_k = 5L) {
  fit_fun <- function(i, model_data, fold_id, threshold) {
    train_data <- model_data[fold_id != i, , drop = FALSE]
    test_data <- model_data[fold_id == i, , drop = FALSE]
    train_formula <- make_gam_formula(setdiff(names(train_data), c("presence", "case_weight_sdm")), train_data, max_k = max_k)
    train_data$case_weight_sdm <- class_balance_weights(train_data$presence)
    model <- tryCatch(
      mgcv::gam(train_formula, data = train_data, family = stats::binomial(), weights = case_weight_sdm, method = "REML"),
      error = function(e) {
        log_message(log_fun, "  GAM CV fold ", i, " failed: ", conditionMessage(e))
        NULL
      }
    )
    if (is.null(model)) {
      return(metrics_list_to_row(list(
        auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_,
        threshold = threshold, tp = NA_integer_, fp = NA_integer_, tn = NA_integer_, fn = NA_integer_, n = 0L
      ), fold = i))
    }
    pred <- tryCatch(stats::predict(model, newdata = test_data, type = "response"), error = function(e) {
      log_message(log_fun, "  GAM CV fold ", i, " prediction failed: ", conditionMessage(e))
      rep(NA_real_, nrow(test_data))
    })
    metrics_list_to_row(compute_binary_metrics(test_data$presence, pred, threshold = threshold), fold = i)
  }

  cross_validate_model(model_data,
    k = k, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
    threshold = sdm_default_threshold, fit_fun = fit_fun,
    cluster_exports = c("auc_rank", "compute_binary_metrics", "metrics_list_to_row", "log_message", "make_gam_formula", "class_balance_weights"),
    log_fun = log_fun
  )
}

fit_gam_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                        include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                        seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                        cv_strategy = sdm_default_cv_strategy,
                        cv_block_size_km = sdm_default_cv_block_size_km,
                        bias_method = c("uniform", "target_group", "thickened"),
                        target_group_occ = NULL,
                        thickening_distance_km = NULL,
                        threshold = sdm_default_threshold,
                        max_k = 5L) {
  bias_method <- match.arg(bias_method)
  if (!requireNamespace("mgcv", quietly = TRUE)) {
    stop("The GAM backend requires the mgcv package. Install mgcv or choose a different model backend.", call. = FALSE)
  }

  d <- prepare_sdm_data(occ, env_train_scaled, background_n,
    seed = seed, log_fun = log_fun,
    include_xy = FALSE,
    bias_method = bias_method, target_group_occ = target_group_occ,
    thickening_distance_km = thickening_distance_km
  )
  occ_used <- d$occ_used
  pres_vals <- d$pres_vals
  bg_vals <- d$bg_vals
  bg_xy <- d$bg_xy
  covariates <- d$covariates
  model_data <- d$model_data
  formula <- make_gam_formula(covariates, model_data, max_k = max_k)
  model_data$case_weight_sdm <- class_balance_weights(model_data$presence)

  log_message(log_fun, "Fitting GAM SDM with ", nrow(pres_vals), " presences and ", nrow(bg_vals), " background points")
  set.seed(seed)
  model <- tryCatch({
    mgcv::gam(formula, data = model_data, family = stats::binomial(), weights = case_weight_sdm, method = "REML")
  }, error = function(e) {
    stop("GAM fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  # Check smooth basis dimension (k-index warning)
  tryCatch({
    k_check <- mgcv::k.check(model)
    low_k <- rownames(k_check)[k_check[, "k-index"] < 1 & k_check[, "p-value"] < 0.05]
    if (length(low_k) > 0) {
      log_message(log_fun, "  GAM warning: basis dimension may be too low for: ", paste(low_k, collapse = ", "),
        " (k-index < 1, try increasing max_k)")
    }
  }, error = function(e) {
    log_message(log_fun, "  GAM k-check skipped: ", conditionMessage(e))
  })

  # Training metrics
  train_pred <- tryCatch(
    stats::predict(model, newdata = model_data, type = "response"),
    error = function(e) rep(NA_real_, nrow(model_data))
  )
  train_metrics <- compute_binary_metrics(model_data$presence, train_pred, threshold = threshold)

  cv <- cross_validate_gam(model_data, formula, k = cv_folds, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km, max_k = max_k)
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
    variable_importance = NULL,
    metrics = list(training_auc = train_metrics$auc, training_tss = train_metrics$tss)
  )
}

predict_gam_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  log_message(log_fun, "Predicting suitability raster with GAM")
  predict_suitability(fit$model, env_project_scaled, output_tif, n_cores, log_fun)
}
