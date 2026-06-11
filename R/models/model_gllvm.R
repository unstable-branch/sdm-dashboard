# gllvm-based Joint Species Distribution Model (JSDM) backend.
# Uses gllvm::gllvm() for latent variable joint species distribution modeling.

fit_gllvm_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                           include_quadratic = FALSE, cv_folds = 0L,
                           seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                           cv_strategy = sdm_default_cv_strategy,
                           cv_block_size_km = sdm_default_cv_block_size_km,
                           threshold = sdm_default_threshold,
                           gllvm_family = "binomial",
                           gllvm_num_lv = 2L,
                           gllvm_num_rows = 1L,
                           gllvm_lv_corr = FALSE,
                           ...) {
  if (!requireNamespace("gllvm", quietly = TRUE)) {
    stop("gllvm package required for JSDM backend. Install with: install.packages('gllvm')", call. = FALSE)
  }

  cm <- build_community_matrix(occ, env_train_scaled, background_n = background_n,
    seed = seed, log_fun = log_fun)

  n_species <- cm$n_species
  n_sites <- cm$n_sites
  covariates <- cm$covariates
  community_mat <- cm$community_mat
  site_xy <- cm$site_xy

  if (n_sites < 20) stop("Too few training sites (", n_sites, "). Need at least 20.", call. = FALSE)

  log_message(log_fun, "Fitting gllvm JSDM (", n_species, " species, ", n_sites, " sites, ",
    gllvm_num_lv, " latent variables)")

  # Build model matrix from environmental covariates
  x_train <- as.matrix(cm$model_data[, covariates, drop = FALSE])
  colnames(x_train) <- covariates

  # Standardize covariates for better gllvm convergence
  scaler <- list(
    mean = colMeans(x_train, na.rm = TRUE),
    sd = matrixStats::colSds(x_train, na.rm = TRUE)
  )
  scaler$sd[scaler$sd == 0 | !is.finite(scaler$sd)] <- 1
  x_train_scaled <- sweep(x_train, 2, scaler$mean, "-")
  x_train_scaled <- sweep(x_train_scaled, 2, scaler$sd, "/")

  if (isTRUE(include_quadratic)) {
    log_message(log_fun, "Note: gllvm captures nonlinearity via latent variables; quadratic terms not needed")
  }

  set.seed(seed)
  tryCatch({
    fit <- gllvm::gllvm(
      y = community_mat,
      X = x_train_scaled,
      family = gllvm_family,
      num.lv = as.integer(gllvm_num_lv),
      row.eff = as.integer(gllvm_num_rows),
      lv.corr = isTRUE(gllvm_lv_corr),
      seed = seed
    )
  }, error = function(e) {
    stop("gllvm fit failed: ", conditionMessage(e), call. = FALSE)
  })

  log_message(log_fun, "  gllvm converged with ", n_species, " species, ", n_sites, " sites")

  # Compute per-species AUC on training data (internal cross-validation)
  cv <- tryCatch({
    pred <- stats::predict(fit)
    if (is.matrix(pred)) {
      auc_values <- vapply(seq_len(n_species), function(s) {
        tryCatch(auc_rank(community_mat[, s], pred[, s]), error = function(e) NA_real_)
      }, numeric(1))
      list(
        k = as.integer(gllvm_num_lv),
        strategy = "gllvm_latent_variable",
        n_species = n_species,
        n_sites = n_sites,
        auc_mean = mean(auc_values, na.rm = TRUE),
        auc_sd = stats::sd(auc_values, na.rm = TRUE)
      )
    } else {
      list(k = as.integer(gllvm_num_lv), strategy = "gllvm_latent_variable",
        n_species = n_species, n_sites = n_sites)
    }
  }, error = function(e) {
    list(k = as.integer(gllvm_num_lv), strategy = "gllvm_latent_variable",
      n_species = n_species, n_sites = n_sites)
  })

  list(
    model = fit,
    formula = NULL,
    coefficients = fit$params$beta,
    model_data = as.data.frame(x_train_scaled),
    community_matrix = community_mat,
    species_names = cm$species_names,
    n_species = n_species,
    occurrence_used = NULL,
    background_xy = site_xy[!duplicated(site_xy), , drop = FALSE],
    cv = cv,
    covariates = covariates,
    variable_importance = NULL,
    scaler = scaler,
    gllvm_family = gllvm_family,
    gllvm_num_lv = as.integer(gllvm_num_lv)
  )
}

predict_gllvm_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) {
    stop("fit must be a gllvm fit result list.", call. = FALSE)
  }

  covariates <- fit$covariates
  if (is.null(covariates)) stop("fit$covariates is missing.", call. = FALSE)

  raster_names <- names(env_project_scaled)
  raster_names_clean <- make.names(raster_names)
  cov_idx <- match(covariates, raster_names_clean)
  if (any(is.na(cov_idx))) {
    missing <- covariates[is.na(cov_idx)]
    stop("Missing covariates: ", paste(missing, collapse = ", "), call. = FALSE)
  }
  env_subset <- env_project_scaled[[raster_names[cov_idx]]]

  n_species <- fit$n_species
  species_names <- fit$species_names
  scaler <- fit$scaler

  log_message(log_fun, "Predicting gllvm JSDM suitability (", n_species, " species)")

  env_df <- as.data.frame(terra::values(env_subset))
  names(env_df) <- covariates
  complete_idx <- which(stats::complete.cases(env_df))
  n_cells <- length(complete_idx)

  if (n_cells == 0) {
    suit <- terra::rast(env_subset[[1]])
    names(suit) <- "suitability"
    suit <- terra::writeRaster(suit, output_tif, overwrite = TRUE)
    return(suit)
  }

  x_pred <- as.matrix(env_df[complete_idx, covariates, drop = FALSE])
  x_pred_scaled <- sweep(x_pred, 2, scaler$mean, "-")
  x_pred_scaled <- sweep(x_pred_scaled, 2, scaler$sd, "/")

  pred <- tryCatch({
    p <- stats::predict(fit$model, newX = x_pred_scaled, type = "response")
    if (is.matrix(p)) p else as.matrix(p)
  }, error = function(e) {
    stop("gllvm prediction failed: ", conditionMessage(e), call. = FALSE)
  })

  if (ncol(pred) != n_species) {
    log_message(log_fun, "  Warning: model predicted ", ncol(pred), " outputs but expected ", n_species)
    n_species <- min(ncol(pred), n_species)
  }

  # Write per-species tifs
  species_tifs <- character(n_species)
  for (i in seq_len(n_species)) {
    sp_tif <- sub("\\.tif$", paste0("_", make.names(species_names[i]), ".tif"), output_tif)
    sp_rast <- terra::rast(env_subset[[1]])
    terra::values(sp_rast) <- NA_real_
    sp_rast[complete_idx] <- pmax(0, pmin(1, pred[, i]))
    names(sp_rast) <- make.names(species_names[i])
    terra::writeRaster(sp_rast, sp_tif, overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
    species_tifs[i] <- sp_tif
  }

  # Write multi-band stack
  multi_rast <- terra::rast(species_tifs)
  names(multi_rast) <- make.names(species_names)

  # Richness raster
  richness <- sum(multi_rast, na.rm = TRUE)
  names(richness) <- "richness"
  richness_tif <- sub("\\.tif$", "_richness.tif", output_tif)
  terra::writeRaster(richness, richness_tif, overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))

  log_message(log_fun, "  Wrote ", n_species, " species rasters + richness to ", dirname(output_tif))

  attr(multi_rast, "species_tifs") <- species_tifs
  attr(multi_rast, "richness_tif") <- richness_tif
  multi_rast
}
