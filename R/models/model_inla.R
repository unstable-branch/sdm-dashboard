# Bayesian spatial SDM backend via INLA with SPDE.

fit_inla_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                         include_quadratic = FALSE, cv_folds = 0L,
                         seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                         cv_strategy = sdm_default_cv_strategy,
                         cv_block_size_km = sdm_default_cv_block_size_km,
                         threshold = sdm_default_threshold,
                         mesh_max_edge = NULL, mesh_cutoff = NULL,
                         prior_range = NULL, prior_sigma = NULL,
                         n_samples = 100L,
                         bias_method = "uniform",
                         target_group_occ = NULL,
                         thickening_distance_km = NULL,
                         ...) {
  if (!requireNamespace("INLA", quietly = TRUE)) {
    stop("INLA package is required for Bayesian spatial SDM. Install from: https://inla.r-inla-download.org/R/stable/", call. = FALSE)
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

  if (isTRUE(include_quadratic)) {
    log_message(log_fun, "Note: INLA spatial model captures nonlinearity via SPDE; quadratic terms not needed")
  }

  all_coords <- model_data[, c(".x", ".y"), drop = FALSE]
  names(all_coords) <- c("x", "y")
  occ_xy <- data.frame(x = occ_used$longitude, y = occ_used$latitude)

  log_message(log_fun, "Building INLA mesh from ", nrow(all_coords), " points (", nrow(occ_xy), " presences)")

  mesh <- build_inla_mesh(all_coords,
    max_edge_inner = mesh_max_edge,
    cutoff = mesh_cutoff
  )
  mesh_summary <- summarise_mesh(mesh)
  log_message(log_fun, "  Mesh: ", mesh_summary$n_vertices, " vertices, ", mesh_summary$n_triangles, " triangles")

  log_message(log_fun, "Building SPDE model with PC priors")
  spde <- build_spde_model(mesh, prior_range = prior_range, prior_sigma = prior_sigma)

  A <- INLA::inla.spde.make.A(mesh, loc = as.matrix(all_coords))
  field_idx <- 1:spde$n.spde

  stack <- INLA::inla.stack(
    tag = "est",
    data = list(y = model_data$presence),
    A = list(A, 1),
    effects = list(
      list(field = field_idx),
      data.frame(Intercept = 1, model_data[, covariates, drop = FALSE])
    )
  )

  formula <- stats::as.formula(paste(
    "y ~ 0 + Intercept + f(field, model = spde)",
    paste0("+ ", covariates, collapse = " ")
  ))

  log_message(log_fun, "Fitting INLA spatial SDM (", length(covariates), " covariates, ", nrow(model_data), " training points)")

  inla_result <- tryCatch({
    INLA::inla(
      formula,
      family = "binomial",
      data = INLA::inla.stack.data(stack),
      control.predictor = list(
        A = INLA::inla.stack.A(stack),
        compute = TRUE,
        link = 1
      ),
      control.compute = list(
        dic = TRUE,
        waic = TRUE,
        config = TRUE,
        return.marginals = FALSE
      ),
      num.threads = normalize_core_count(n_cores),
      verbose = FALSE,
      safe = TRUE
    )
  }, error = function(e) {
    stop("INLA model fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  if (is.finite(inla_result$waic$waic)) {
    log_message(log_fun, "  WAIC: ", sprintf("%.1f", inla_result$waic$waic))
  }

  cv <- list(
    k = 0L, strategy = "none",
    auc_mean = NA_real_, auc_sd = NA_real_,
    tss_mean = NA_real_, tss_sd = NA_real_,
    fold_auc = numeric(),
    waic = if (is.finite(inla_result$waic$waic)) inla_result$waic$waic else NA_real_,
    dic = if (is.finite(inla_result$dic$dic)) inla_result$dic$dic else NA_real_
  )

  fixed_effects <- inla_result$summary.fixed
  fixed_effects_df <- data.frame(
    variable = rownames(fixed_effects),
    mean = fixed_effects$mean,
    sd = fixed_effects$sd,
    q0.025 = fixed_effects$`0.025quant`,
    q0.975 = fixed_effects$`0.975quant`,
    stringsAsFactors = FALSE
  )

  if (cv_folds >= 2L) {
    log_message(log_fun, "INLA CV not yet implemented; skipping cross-validation")
  }

  list(
    model = inla_result,
    formula = formula,
    coefficients = fixed_effects_df,
    model_data = model_data,
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = NULL,
    mesh = mesh,
    spde = spde,
    inla_params = list(
      n_samples = n_samples,
      mesh_max_edge = mesh_max_edge,
      mesh_summary = mesh_summary
    )
  )
}

predict_inla_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be an INLA model fit result list.", call. = FALSE)
  if (is.null(fit$covariates)) stop("fit$covariates is missing; cannot map covariates.", call. = FALSE)
  if (is.null(fit$mesh)) stop("fit$mesh is missing; cannot project spatial field.", call. = FALSE)

  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(fit$covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- fit$covariates[is.na(cov_idx)]
    stop("The following covariates are missing from the projection stack: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]
  n_samples <- fit$inla_params$n_samples %||% 100L

  log_message(log_fun, "Predicting INLA suitability over ", terra::ncol(env_subset), "x", terra::nrow(env_subset), " raster (", n_samples, " posterior samples)")

  env_df <- as.data.frame(terra::values(env_subset))
  names(env_df) <- fit$covariates
  complete_idx <- which(stats::complete.cases(env_df))
  n_cells <- length(complete_idx)

  if (n_cells == 0) {
    suit <- terra::rast(env_subset[[1]])
    names(suit) <- "suitability"
    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
    return(suit)
  }

  pred_coords <- terra::xyFromCell(env_subset, complete_idx)
  pred_coords_df <- as.data.frame(pred_coords)
  names(pred_coords_df) <- c("x", "y")

  proj <- INLA::inla.mesh.projector(fit$mesh, loc = pred_coords)

  log_message(log_fun, "  Drawing ", n_samples, " posterior samples from INLA fit")

  samples <- tryCatch({
    INLA::inla.posterior.sample(n = n_samples, result = fit$model)
  }, error = function(e) {
    stop("INLA posterior sampling failed: ", conditionMessage(e), call. = FALSE)
  })

  spatial_field_names <- grep("^field:", rownames(samples[[1]]$latent), value = TRUE)

  pred_matrix <- matrix(NA_real_, nrow = n_cells, ncol = n_samples)

  for (i in seq_len(n_samples)) {
    s_field <- samples[[i]]$latent[spatial_field_names, 1]
    spatial_proj <- as.numeric(proj$proj$A %*% s_field)

    intercept <- samples[[i]]$latent["Intercept", 1]
    fixed_part <- intercept + as.matrix(env_df[complete_idx, , drop = FALSE]) %*%
      samples[[i]]$latent[fit$covariates, 1]

    linpred <- spatial_proj + fixed_part
    pred_matrix[, i] <- stats::plogis(linpred)
  }

  mean_pred <- rowMeans(pred_matrix, na.rm = TRUE)
  mean_pred <- pmax(0, pmin(1, mean_pred))

  suit <- terra::rast(env_subset[[1]])
  terra::values(suit) <- NA_real_
  suit[complete_idx] <- mean_pred
  names(suit) <- "suitability"

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
  log_message(log_fun, "INLA suitability raster written to: ", output_tif)

  attr(suit, "n_posterior_samples") <- n_samples
  attr(suit, "posterior_sd") <- apply(pred_matrix, 1, sd, na.rm = TRUE)

  if (ncol(pred_matrix) >= 20) {
    lower <- apply(pred_matrix, 1, stats::quantile, probs = 0.025, na.rm = TRUE)
    upper <- apply(pred_matrix, 1, stats::quantile, probs = 0.975, na.rm = TRUE)
    uncertainty_tif <- sub("\\.tif$", "_uncertainty.tif", output_tif)
    uncertainty <- upper - lower
    uncertainty_rast <- terra::rast(env_subset[[1]])
    terra::values(uncertainty_rast) <- NA_real_
    uncertainty_rast[complete_idx] <- uncertainty
    names(uncertainty_rast) <- "uncertainty_ci95"
    terra::writeRaster(uncertainty_rast, uncertainty_tif, overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
    log_message(log_fun, "INLA uncertainty raster written to: ", uncertainty_tif)
    attr(suit, "uncertainty_tif") <- uncertainty_tif
  }

  suit
}
