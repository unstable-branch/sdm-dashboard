prepare_sdm_data <- function(occ, env_train_scaled, background_n,
                              seed = 42, log_fun = NULL,
                              bias_method = "uniform",
                              target_group_occ = NULL,
                              thickening_distance_km = NULL,
                              include_xy = TRUE) {
  covariates <- names(env_train_scaled)
  if (length(covariates) < 2) stop("At least two covariates are required for modelling.", call. = FALSE)

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  if (sum(!pres_keep) > 0) log_message(log_fun, "Dropped ", sum(!pres_keep), " occurrence records with missing covariates")
  pres_vals <- pres_vals[pres_keep, , drop = FALSE]
  pres_xy_used <- pres_xy[pres_keep, , drop = FALSE]
  occ_used <- occ[pres_keep, , drop = FALSE]
  if (nrow(pres_vals) < 20) stop("Too few presence records with complete environmental data after removing ", sum(!pres_keep), " records with missing covariate values (", nrow(pres_vals), " remaining, minimum 20).", call. = FALSE)

  bg_xy <- sample_background_points(env_train_scaled, background_n,
    seed = seed, presence_xy = pres_xy_used,
    bias_method = bias_method,
    target_group_occ = target_group_occ,
    thickening_distance_km = thickening_distance_km
  )
  bg_vals <- extract_covariates(env_train_scaled, bg_xy)
  bg_keep <- stats::complete.cases(bg_vals)
  bg_vals <- bg_vals[bg_keep, , drop = FALSE]
  bg_xy <- bg_xy[bg_keep, , drop = FALSE]
  if (nrow(bg_vals) < 100) stop("Too few background points could be sampled.", call. = FALSE)

  covariates <- make.names(covariates)
  names(pres_vals) <- covariates
  names(bg_vals) <- covariates

  if (include_xy) {
    model_data <- rbind(
      data.frame(presence = 1L, pres_vals, .x = pres_xy_used$x, .y = pres_xy_used$y, check.names = FALSE),
      data.frame(presence = 0L, bg_vals, .x = bg_xy$x, .y = bg_xy$y, check.names = FALSE)
    )
  } else {
    model_data <- rbind(
      data.frame(presence = 1L, pres_vals, check.names = FALSE),
      data.frame(presence = 0L, bg_vals, check.names = FALSE)
    )
  }

  list(
    pres_vals = pres_vals,
    pres_xy_used = pres_xy_used,
    occ_used = occ_used,
    bg_vals = bg_vals,
    bg_xy = bg_xy,
    model_data = model_data,
    covariates = covariates
  )
}

make_sdm_result <- function(model, coefficients, occurrence_used, background_xy, cv, covariates, ...) {
  extra <- list(...)
  result <- list(
    model = model,
    coefficients = coefficients,
    occurrence_used = occurrence_used,
    background_xy = background_xy,
    cv = cv,
    covariates = covariates
  )
  for (nm in names(extra)) {
    result[[nm]] <- extra[[nm]]
  }
  result
}

log_cv_result <- function(log_fun, cv) {
  if (is.finite(cv$auc_mean)) {
    log_message(
      log_fun, "Cross-validation (", cv$strategy, ") AUC: ", sprintf("%.3f", cv$auc_mean),
      if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else ""
    )
  }
}

#' Store a run summary in rv$past_runs for cross-run comparison.
store_past_run <- function(rv, result) {
  run_summary <- list(
    timestamp = Sys.time(),
    species = result$config$species %||% "unknown",
    model_id = result$config$model_id %||% result$model_id %||% "unknown",
    auc = if (!is.null(result$cv)) result$cv$auc_mean else NA_real_,
    tss = if (!is.null(result$cv)) result$cv$tss_mean else NA_real_,
    threshold = result$config$threshold %||% result$metrics$threshold %||% NA_real_,
    area_km2 = result$summary$high_risk_area_km2 %||% NA_real_
  )
  rv$past_runs <- c(rv$past_runs, list(run_summary))
  if (length(rv$past_runs) > 10) rv$past_runs <- tail(rv$past_runs, 10)
}

# Global threshold optimization — Youden's J (max TSS)
# Returns the threshold that maximises TSS = sensitivity + specificity - 1
find_optimal_threshold <- function(obs, pred) {
  obs <- as.integer(obs)
  pred <- as.numeric(pred)
  ok <- is.finite(obs) & is.finite(pred)
  obs <- obs[ok]
  pred <- pred[ok]
  if (length(pred) < 3 || sum(obs == 1) < 1 || sum(obs == 0) < 1) return(sdm_default_threshold)
  candidates <- sort(unique(pred))
  best <- sdm_default_threshold
  best_tss <- -Inf
  n_p <- sum(obs == 1)
  n_a <- sum(obs == 0)
  for (t in candidates) {
    sens <- sum(obs == 1 & pred >= t, na.rm = TRUE) / n_p
    spec <- sum(obs == 0 & pred < t, na.rm = TRUE) / n_a
    tss <- sens + spec - 1
    if (is.finite(tss) && tss > best_tss) { best_tss <- tss; best <- t }
  }
  best
}