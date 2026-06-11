# General Bayesian SDM backend via brms (cmdstanr).

fit_brms_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                         include_quadratic = FALSE, cv_folds = 0L,
                         seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                         cv_strategy = sdm_default_cv_strategy,
                         cv_block_size_km = sdm_default_cv_block_size_km,
                         threshold = sdm_default_threshold,
                         chains = 4L, iter = 2000L, warmup = 1000L,
                         prior_intercept = NULL, prior_beta = NULL,
                         bias_method = "uniform",
                         target_group_occ = NULL,
                         thickening_distance_km = NULL,
                         ...) {
  if (!requireNamespace("brms", quietly = TRUE)) {
    stop("brms package is required. Install with: install.packages('brms')", call. = FALSE)
  }

  d <- prepare_sdm_data(occ, env_train_scaled, background_n,
    seed = seed, log_fun = log_fun,
    bias_method = bias_method %||% "uniform",
    target_group_occ = target_group_occ %||% NULL,
    thickening_distance_km = thickening_distance_km %||% NULL
  )
  occ_used <- d$occ_used
  pres_vals <- d$pres_vals
  bg_vals <- d$bg_vals
  bg_xy <- d$bg_xy
  model_data <- d$model_data
  covariates <- d$covariates

  formula_str <- if (isTRUE(include_quadratic)) {
    terms_list <- unlist(lapply(covariates, function(c) c(c, paste0("I(", c, "^2)"))))
    paste("presence ~", paste(terms_list, collapse = " + "))
  } else {
    paste("presence ~", paste(covariates, collapse = " + "))
  }

  prior_intercept <- prior_intercept %||% "normal(0, 3)"
  prior_beta <- prior_beta %||% "normal(0, 2)"
  priors <- c(
    brms::prior_string(prior_intercept, class = "Intercept"),
    brms::prior_string(prior_beta, class = "b")
  )

  log_message(log_fun, "Fitting brms Bayesian SDM with ", nrow(pres_vals), " presences and ",
    nrow(bg_vals), " background points (", chains, " chains x ", iter, " iterations)")

  log_message(log_fun, "  Note: First fit may take 5-15 min for Stan compilation")

  fit <- tryCatch({
    brms::brm(
      formula = stats::as.formula(formula_str),
      data = model_data,
      family = brms::bernoulli(link = "logit"),
      prior = priors,
      chains = chains,
      iter = iter,
      warmup = warmup,
      cores = min(chains, normalize_core_count(n_cores)),
      seed = seed,
      refresh = 0,
      silent = 2,
      save_pars = brms::save_pars(all = TRUE)
    )
  }, error = function(e) {
    stop("brms model fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  waic_val <- tryCatch(brms::waic(fit), error = function(e) NULL)
  loo_val <- tryCatch(brms::loo(fit), error = function(e) NULL)

  coef_summary <- brms::summary(fit)$fixed
  coef_df <- data.frame(
    variable = rownames(coef_summary),
    estimate = coef_summary$Estimate,
    est_error = coef_summary$Est.Error,
    q2.5 = coef_summary$Q2.5,
    q97.5 = coef_summary$Q97.5,
    rhat = coef_summary$Rhat,
    stringsAsFactors = FALSE
  )

  cv <- list(
    k = 0L, strategy = "none",
    auc_mean = NA_real_, auc_sd = NA_real_,
    tss_mean = NA_real_, tss_sd = NA_real_,
    fold_auc = numeric(),
    waic = if (!is.null(waic_val) && is.finite(waic_val$estimates["waic", "Estimate"])) waic_val$estimates["waic", "Estimate"] else NA_real_,
    looic = if (!is.null(loo_val) && is.finite(loo_val$estimates["looic", "Estimate"])) loo_val$estimates["looic", "Estimate"] else NA_real_
  )

  list(
    model = fit,
    formula = fit$formula,
    coefficients = coef_df,
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = NULL,
    brms_params = list(chains = chains, iter = iter, warmup = warmup,
      prior_intercept = prior_intercept, prior_beta = prior_beta,
      formula_str = formula_str),
    waic = waic_val,
    loo = loo_val
  )
}

predict_brms_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be a brms model fit result list.", call. = FALSE)
  if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)

  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(fit$covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- fit$covariates[is.na(cov_idx)]
    stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]

  log_message(log_fun, "Predicting brms suitability over ", terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster")

  env_df <- as.data.frame(terra::values(env_subset), stringsAsFactors = FALSE)
  names(env_df) <- fit$covariates
  complete_idx <- which(stats::complete.cases(env_df))
  n_cells <- length(complete_idx)

  if (n_cells == 0) {
    suit <- terra::rast(env_subset[[1]])
    names(suit) <- "suitability"
    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
    return(suit)
  }

  log_message(log_fun, "  Computing posterior expected predictions for ", n_cells, " cells")

  epred <- tryCatch({
    brms::posterior_epred(fit$model, newdata = env_df[complete_idx, , drop = FALSE],
      cores = min(2, normalize_core_count(n_cores)))
  }, error = function(e) {
    stop("brms posterior prediction failed: ", conditionMessage(e), call. = FALSE)
  })

  mean_suit <- colMeans(epred)
  mean_suit <- pmax(0, pmin(1, mean_suit))

  suit <- terra::rast(env_subset[[1]])
  terra::values(suit) <- NA_real_
  suit[complete_idx] <- mean_suit
  names(suit) <- "suitability"

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
  log_message(log_fun, "Suitability raster written to: ", output_tif)

  if (nrow(epred) >= 20) {
    uncertainty_tif <- sub("\\.tif$", "_uncertainty.tif", output_tif)
    sd_suit <- matrixStats::colSds(epred, na.rm = TRUE)
    sd_suit[!is.finite(sd_suit)] <- 0
    uncertainty_rast <- terra::rast(env_subset[[1]])
    terra::values(uncertainty_rast) <- NA_real_
    uncertainty_rast[complete_idx] <- sd_suit
    names(uncertainty_rast) <- "uncertainty_sd"
    terra::writeRaster(uncertainty_rast, uncertainty_tif, overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
    log_message(log_fun, "Uncertainty raster written to: ", uncertainty_tif)
    attr(suit, "uncertainty_tif") <- uncertainty_tif
  }

  suit
}
