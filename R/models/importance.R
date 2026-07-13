permutation_importance <- function(fit, model_data, predict_fun, metric_fun = NULL,
                                   n_perm = 50, seed = 42, n_cores = 1,
                                   use_held_out = TRUE) {
  if (is.null(metric_fun)) metric_fun <- auc_rank
  if (!is.function(predict_fun)) stop("predict_fun must be a function", call. = FALSE)
  if (!is.function(metric_fun)) stop("metric_fun must be a function", call. = FALSE)
  n_perm <- as.integer(n_perm)[1]
  if (is.na(n_perm) || n_perm < 1) n_perm <- 1
  seed <- as.integer(seed)[1]
  if (is.na(seed)) seed <- 42
  n_cores <- as.integer(n_cores)[1]
  if (is.na(n_cores) || n_cores < 1) n_cores <- 1

  eval_data <- model_data
  if (isTRUE(use_held_out) && nrow(model_data) >= 50) {
    set.seed(seed)
    hold_size <- max(20L, floor(nrow(model_data) * 0.2))
    hold_idx <- sample(seq_len(nrow(model_data)), size = hold_size, replace = FALSE)
    eval_data <- model_data[hold_idx, , drop = FALSE]
    eval_obs <- eval_data$presence
    if (!is.numeric(eval_obs)) eval_obs <- as.numeric(eval_obs)
    ok_eval <- is.finite(eval_obs) & (eval_obs == 0 | eval_obs == 1)
    if (sum(ok_eval) < 20) eval_data <- model_data
  }

  exclude_cols <- c("presence", ".x", ".y", "case_weight_sdm")
  cov_cols <- setdiff(names(model_data), exclude_cols)
  cov_cols <- cov_cols[is.finite(match(cov_cols, names(model_data)))]
  if (length(cov_cols) == 0) {
    return(data.frame(
      variable = character(), importance = numeric(),
      sd = numeric(), baseline = numeric(), stringsAsFactors = FALSE
    ))
  }

  obs <- eval_data$presence
  if (!is.numeric(obs)) obs <- as.numeric(obs)
  ok_obs <- is.finite(obs) & (obs == 0 | obs == 1)
  if (sum(ok_obs) < 20) {
    sd_vals <- vapply(cov_cols, function(v) {
      col_vals <- model_data[[v]]
      if (!is.numeric(col_vals)) {
        return(NA_real_)
      }
      var_sd <- stats::sd(col_vals, na.rm = TRUE)
      if (is.na(var_sd) || var_sd < 1e-10) 0 else NA_real_
    }, numeric(1))
    return(data.frame(
      variable = cov_cols, importance = 0, sd = sd_vals, baseline = NA,
      stringsAsFactors = FALSE
    ))
  }

  set.seed(seed)
  baseline_pred <- predict_fun(fit, eval_data)
  if (!is.numeric(baseline_pred)) baseline_pred <- as.numeric(baseline_pred)
  ok_pred <- is.finite(baseline_pred)
  ok_both <- ok_obs & ok_pred
  if (sum(ok_both) < 20) {
    sd_vals <- vapply(cov_cols, function(v) {
      col_vals <- model_data[[v]]
      if (!is.numeric(col_vals)) {
        return(NA_real_)
      }
      var_sd <- stats::sd(col_vals, na.rm = TRUE)
      if (is.na(var_sd) || var_sd < 1e-10) 0 else NA_real_
    }, numeric(1))
    return(data.frame(
      variable = cov_cols, importance = 0, sd = sd_vals, baseline = NA,
      stringsAsFactors = FALSE
    ))
  }

  baseline_metric <- as.numeric(metric_fun(obs[ok_both], baseline_pred[ok_both]))[1]
  if (!is.finite(baseline_metric)) {
    return(data.frame(
      variable = cov_cols, importance = 0, sd = NA, baseline = NA,
      stringsAsFactors = FALSE
    ))
  }

  compute_drops <- function(var) {
    if (!var %in% names(eval_data)) {
      return(c(importance = 0, sd = NA_real_))
    }
    col_vals <- eval_data[[var]]
    if (!is.numeric(col_vals)) {
      return(c(importance = 0, sd = NA_real_))
    }
    var_sd <- stats::sd(col_vals, na.rm = TRUE)
    if (is.na(var_sd) || var_sd < 1e-10) {
      return(c(importance = 0, sd = 0))
    }

    drops <- numeric(n_perm)
    for (p in seq_len(n_perm)) {
      if (isTRUE(getOption("sdm_cancelled"))) break
      shuffled <- eval_data
      shuffled[[var]] <- sample(col_vals, size = nrow(eval_data), replace = FALSE)
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
    sd_val <- if (n_perm > 1 && sum(is.finite(drops)) > 1) {
      sd_val <- stats::sd(drops, na.rm = TRUE)
      if (is.na(sd_val)) 0 else sd_val
    } else {
      0
    }
    list(importance = mean(drops, na.rm = TRUE), sd = sd_val)
  }

  results <- if (n_cores > 1 && n_perm > 1 && requireNamespace("parallel", quietly = TRUE)) {
    tryCatch(
      {
        cl <- parallel::makeCluster(n_cores)
        on.exit(parallel::stopCluster(cl), add = TRUE)
        parallel::parLapply(cl, cov_cols, compute_drops)
      },
      error = function(e) lapply(cov_cols, compute_drops)
    )
  } else {
    lapply(cov_cols, compute_drops)
  }

  importance_df <- data.frame(
    variable = cov_cols,
    importance = vapply(results, function(r) r$importance, numeric(1)),
    sd = vapply(results, function(r) r$sd, numeric(1)),
    baseline = rep(baseline_metric, length(cov_cols)),
    stringsAsFactors = FALSE
  )

  importance_df[order(importance_df$importance, decreasing = TRUE), , drop = FALSE]
}
