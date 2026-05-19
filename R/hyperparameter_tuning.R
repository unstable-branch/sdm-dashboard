# Hyperparameter tuning for SDM model backends.
# Grid search for MaxNet regularisation multipliers and feature classes.

#' Tune MaxNet hyperparameters via grid search with cross-validation.
#'
#' @param model_data data.frame with presence and covariates
#' @param covariates character vector of covariate names
#' @param regmult_grid numeric vector of regularisation multipliers to test
#' @param feature_sets character vector of feature class combinations
#' @param k number of CV folds
#' @param seed random seed
#' @param n_cores number of cores
#' @param log_fun optional log function
#' @return data.frame with regmult, features, auc_mean, auc_sd, tss_mean, tss_sd
tune_maxnet <- function(model_data, covariates,
                        regmult_grid = c(0.5, 1.0, 1.5, 2.0, 3.0),
                        feature_sets = c("lqph", "lqp", "lp", "l"),
                        k = 5, seed = 42, n_cores = 1, log_fun = NULL) {
  if (!requireNamespace("maxnet", quietly = TRUE)) {
    stop("maxnet package required for tuning", call. = FALSE)
  }

  log_message(log_fun, "Tuning MaxNet hyperparameters (", length(regmult_grid), " regmult x ", length(feature_sets), " feature sets = ", length(regmult_grid) * length(feature_sets), " combinations)")

  results <- expand.grid(
    regmult = regmult_grid,
    features = feature_sets,
    auc_mean = NA_real_,
    auc_sd = NA_real_,
    tss_mean = NA_real_,
    tss_sd = NA_real_,
    stringsAsFactors = FALSE
  )

  for (i in seq_len(nrow(results))) {
    rm <- results$regmult[i]
    fc <- results$features[i]

    cv_result <- tryCatch({
      cross_validate_maxnet(model_data, covariates, fc, rm,
        k = k, seed = seed, n_cores = n_cores)
    }, error = function(e) {
      log_message(log_fun, "  MaxNet regmult=", rm, " features=", fc, " failed: ", conditionMessage(e))
      list(auc_mean = NA_real_, auc_sd = NA_real_, tss_mean = NA_real_, tss_sd = NA_real_)
    })

    results$auc_mean[i] <- cv_result$auc_mean
    results$auc_sd[i] <- cv_result$auc_sd
    results$tss_mean[i] <- cv_result$tss_mean
    results$tss_sd[i] <- cv_result$tss_sd

    if (is.finite(cv_result$auc_mean)) {
      log_message(log_fun, "  regmult=", rm, " features=", fc, " → AUC=", sprintf("%.3f", cv_result$auc_mean))
    }
  }

  # Sort by AUC descending
  results <- results[order(results$auc_mean, decreasing = TRUE, na.last = TRUE), ]
  rownames(results) <- NULL

  # Best result
  best <- results[1, ]
  log_message(log_fun, "Best MaxNet params: regmult=", best$regmult, " features=", best$features,
    " AUC=", sprintf("%.3f", best$auc_mean))

  attr(results, "best") <- best
  results
}

#' Tune GAM smoothness via k parameter grid search.
#'
#' @param model_data data.frame with presence and covariates
#' @param covariates character vector of covariate names
#' @param k_grid integer vector of max-k values to test
#' @param cv_folds number of CV folds
#' @param seed random seed
#' @param n_cores number of cores
#' @param cv_strategy CV strategy
#' @param cv_block_size_km block size for spatial CV
#' @param log_fun optional log function
#' @return data.frame with max_k, auc_mean, auc_sd, tss_mean, tss_sd
tune_gam <- function(model_data, covariates,
                     k_grid = c(3, 5, 7, 10),
                     cv_folds = 5, seed = 42, n_cores = 1,
                     cv_strategy = sdm_default_cv_strategy,
                     cv_block_size_km = sdm_default_cv_block_size_km,
                     log_fun = NULL) {
  if (!requireNamespace("mgcv", quietly = TRUE)) {
    stop("mgcv package required for GAM tuning", call. = FALSE)
  }

  log_message(log_fun, "Tuning GAM k parameter (", length(k_grid), " values: ", paste(k_grid, collapse = ", "), ")")

  results <- data.frame(
    max_k = k_grid,
    auc_mean = NA_real_,
    auc_sd = NA_real_,
    tss_mean = NA_real_,
    tss_sd = NA_real_,
    stringsAsFactors = FALSE
  )

  for (i in seq_along(k_grid)) {
    max_k <- k_grid[i]
    formula <- make_gam_formula(covariates, data = model_data, max_k = max_k)

    cv_result <- tryCatch({
      cross_validate_gam(model_data, formula, k = cv_folds, seed = seed, n_cores = n_cores,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km)
    }, error = function(e) {
      log_message(log_fun, "  GAM k=", max_k, " failed: ", conditionMessage(e))
      list(auc_mean = NA_real_, auc_sd = NA_real_, tss_mean = NA_real_, tss_sd = NA_real_)
    })

    results$auc_mean[i] <- cv_result$auc_mean
    results$auc_sd[i] <- cv_result$auc_sd
    results$tss_mean[i] <- cv_result$tss_mean
    results$tss_sd[i] <- cv_result$tss_sd

    if (is.finite(cv_result$auc_mean)) {
      log_message(log_fun, "  k=", max_k, " → AUC=", sprintf("%.3f", cv_result$auc_mean))
    }
  }

  results <- results[order(results$auc_mean, decreasing = TRUE, na.last = TRUE), ]
  rownames(results) <- NULL

  best <- results[1, ]
  log_message(log_fun, "Best GAM k: ", best$max_k, " AUC=", sprintf("%.3f", best$auc_mean))

  attr(results, "best") <- best
  results
}
