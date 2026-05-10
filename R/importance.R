permutation_importance <- function(fit, model_data, predict_fun, metric_fun = NULL,
                                   n_perm = 5, seed = 42, n_cores = 1) {
  if (is.null(metric_fun)) metric_fun <- auc_rank
  if (!is.function(predict_fun)) stop("predict_fun must be a function", call. = FALSE)
  if (!is.function(metric_fun)) stop("metric_fun must be a function", call. = FALSE)
  n_perm <- as.integer(n_perm)[1]
  if (is.na(n_perm) || n_perm < 1) n_perm <- 1
  seed <- as.integer(seed)[1]
  if (is.na(seed)) seed <- 42
  n_cores <- as.integer(n_cores)[1]
  if (is.na(n_cores) || n_cores < 1) n_cores <- 1

  exclude_cols <- c("presence", ".x", ".y", "case_weight_sdm")
  cov_cols <- setdiff(names(model_data), exclude_cols)
  cov_cols <- cov_cols[is.finite(match(cov_cols, names(model_data)))]
  if (length(cov_cols) == 0) {
    return(data.frame(variable = character(), importance = numeric(),
                      sd = numeric(), baseline = numeric(), stringsAsFactors = FALSE))
  }

  obs <- model_data$presence
  if (!is.numeric(obs)) obs <- as.numeric(obs)
  ok_obs <- is.finite(obs) & (obs == 0 | obs == 1)
  if (sum(ok_obs) < 20) {
    return(data.frame(variable = cov_cols, importance = 0, sd = NA, baseline = NA,
                      stringsAsFactors = FALSE))
  }

  set.seed(seed)
  baseline_pred <- predict_fun(fit, model_data)
  if (!is.numeric(baseline_pred)) baseline_pred <- as.numeric(baseline_pred)
  ok_pred <- is.finite(baseline_pred)
  ok_both <- ok_obs & ok_pred
  if (sum(ok_both) < 20) {
    return(data.frame(variable = cov_cols, importance = 0, sd = NA, baseline = NA,
                      stringsAsFactors = FALSE))
  }

  baseline_metric <- metric_fun(obs[ok_both], baseline_pred[ok_both])
  if (!is.finite(baseline_metric)) {
    return(data.frame(variable = cov_cols, importance = 0, sd = NA, baseline = NA,
                      stringsAsFactors = FALSE))
  }

  compute_drops <- function(var) {
    if (!var %in% names(model_data)) return(c(importance = 0, sd = NA_real_))
    col_vals <- model_data[[var]]
    if (!is.numeric(col_vals)) return(c(importance = 0, sd = NA_real_))
    var_sd <- stats::sd(col_vals, na.rm = TRUE)
    if (is.na(var_sd) || var_sd < 1e-10) return(c(importance = 0, sd = 0))

    drops <- numeric(n_perm)
    for (p in seq_len(n_perm)) {
      if (isTRUE(getOption("sdm_cancelled"))) break
      shuffled <- model_data
      shuffled[[var]] <- sample(col_vals, size = nrow(model_data), replace = FALSE)
      pred_shuffled <- predict_fun(fit, shuffled)
      if (!is.numeric(pred_shuffled)) pred_shuffled <- as.numeric(pred_shuffled)
      ok_shuffled <- is.finite(pred_shuffled) & ok_both
      perm_metric <- if (sum(ok_shuffled) >= 20) {
        metric_fun(obs[ok_shuffled], pred_shuffled[ok_shuffled])
      } else {
        NA_real_
      }
      drops[p] <- baseline_metric - if (is.finite(perm_metric)) perm_metric else 0
    }
    list(
      importance = mean(drops, na.rm = TRUE),
      sd = if (n_perm > 1 && sum(is.finite(drops)) > 1) stats::sd(drops, na.rm = TRUE) else 0
    )
  }

  results <- if (n_cores > 1 && n_perm > 1 && requireNamespace("parallel", quietly = TRUE)) {
    tryCatch({
      cl <- parallel::makeCluster(n_cores)
      on.exit(parallel::stopCluster(cl), add = TRUE)
      parallel::parLapply(cl, cov_cols, compute_drops)
    }, error = function(e) lapply(cov_cols, compute_drops))
  } else {
    lapply(cov_cols, compute_drops)
  }

  importance_df <- data.frame(
    variable = cov_cols,
    importance = vapply(results, function(r) r$importance, numeric(1)),
    sd = vapply(results, function(r) r$sd, numeric(1)),
    baseline = baseline_metric,
    stringsAsFactors = FALSE
  )

  importance_df[order(importance_df$importance, decreasing = TRUE), , drop = FALSE]
}