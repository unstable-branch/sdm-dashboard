# Multi-species DNN SDM backend via cito (multi-output).

fit_dnn_multispecies_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                                      include_quadratic = FALSE, cv_folds = 0L,
                                      seed = sdm_default_seed, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                                      cv_strategy = sdm_default_cv_strategy,
                                      cv_block_size_km = sdm_default_cv_block_size_km,
                                      threshold = sdm_default_threshold,
                                      dnn_architecture = "DNN_Medium",
                                      dnn_device = "auto",
                                      n_seeds = 3L,
                                      use_fused_adam = "auto",
                                      dnn_mixed_precision = "auto",
                                      dnn_cuda_graphs = "auto",
                                      ...) {
  if (!requireNamespace("cito", quietly = TRUE) || !requireNamespace("torch", quietly = TRUE)) {
    stop("DNN backend requires cito and torch packages.", call. = FALSE)
  }

  cm <- build_community_matrix(occ, env_train_scaled, background_n = background_n,
    seed = seed, log_fun = log_fun)

  n_species <- cm$n_species
  n_sites <- cm$n_sites
  covariates <- cm$covariates
  community_mat <- cm$community_mat
  site_xy <- cm$site_xy

  if (n_sites < 20) stop("Too few training sites (", n_sites, "). Need at least 20.", call. = FALSE)

  # Scale covariates
  x_train <- as.matrix(cm$model_data[, covariates, drop = FALSE])
  scaler <- list(
    mean = colMeans(x_train, na.rm = TRUE),
    sd = apply(x_train, 2, stats::sd, na.rm = TRUE)
  )
  scaler$sd[scaler$sd == 0 | !is.finite(scaler$sd)] <- 1
  x_train_scaled <- sweep(x_train, 2, scaler$mean, "-")
  x_train_scaled <- sweep(x_train_scaled, 2, scaler$sd, "/")

  if (isTRUE(include_quadratic)) {
    log_message(log_fun, "Note: DNN captures nonlinearity natively; quadratic terms not needed")
  }

  log_message(log_fun, "Fitting multi-species DNN (", n_species, " species, ", n_sites, " sites, ",
    dnn_architecture, ")")

  arch <- sdm_dnn_arch(dnn_architecture)
  if (is.null(arch)) arch <- sdm_dnn_arch("DNN_Medium")

  # Resolve device: "auto"/"gpu" → "cuda"/"cpu"/"mps"
  if (dnn_device == "auto" || dnn_device == "gpu") {
    if (torch::cuda_is_available()) {
      dnn_device <- "cuda"
    } else {
      has_mps <- tryCatch(torch::mps_is_available(), error = function(e) FALSE)
      if (has_mps) dnn_device <- "mps" else dnn_device <- "cpu"
    }
  } else if (dnn_device == "cuda") {
    if (!torch::cuda_is_available()) {
      warning("DNN: CUDA requested but not available. Falling back to CPU.")
      dnn_device <- "cpu"
    }
  } else if (dnn_device == "mps") {
    if (!tryCatch(torch::mps_is_available(), error = function(e) FALSE)) {
      warning("DNN: MPS requested but not available. Falling back to CPU.")
      dnn_device <- "cpu"
    }
  } else {
    dnn_device <- "cpu"
  }

  # Resolve fused Adam: "off" → no, "always"/"auto" → yes if torch is available
  # Uses custom ATen-op Adam kernel (train_step_adam.so) which works on CPU/CUDA/MPS
  torch_has_fused <- exists("torch__fused_adam_", envir = asNamespace("torch"))
  use_fused <- if (identical(use_fused_adam, "off")) {
    FALSE
  } else {
    torch_has_fused
  }

  # Build training data for cito multi-output
  colnames(community_mat) <- paste0("sp__", make.names(cm$species_names))
  train_df <- as.data.frame(x_train_scaled)
  names(train_df) <- covariates
  for (i in seq_len(n_species)) {
    train_df[[colnames(community_mat)[i]]] <- community_mat[, i]
  }

  response_vars <- paste(colnames(community_mat), collapse = ", ")
  formula_str <- paste("cbind(", response_vars, ") ~", paste(covariates, collapse = " + "))
  model_formula <- stats::as.formula(formula_str)

  n_seeds <- as.integer(n_seeds)[1]
  if (is.na(n_seeds) || n_seeds < 1) n_seeds <- 1L

  seed_models <- vector("list", n_seeds)
  for (s in seq_len(n_seeds)) {
    log_message(log_fun, "  Training seed ", s, "/", n_seeds)

    # Patch cito's train_model with fused Adam if enabled
    .old_train_model <- NULL
    if (use_fused) {
      # Load custom ATen-op Adam kernel (works on CPU/CUDA/MPS)
      cpp_so <- file.path(getwd(), "sdmtorch", "train_step_adam.so")
      if (file.exists(cpp_so) && !is.loaded("adam_step_direct", PACKAGE = "")) {
        tryCatch(dyn.load(cpp_so, local = FALSE, now = TRUE), error = function(e) NULL)
      }
      # Fall back to libtorch _fused_adam_ kernel (CPU only, NaN on Blackwell GPU)
      cpp_so2 <- file.path(getwd(), "sdmtorch", "train_step_libtorch.so")
      if (!is.loaded("adam_step_direct", PACKAGE = "") &&
          file.exists(cpp_so2) && !is.loaded("fused_adam_step_direct", PACKAGE = "")) {
        tryCatch(dyn.load(cpp_so2, local = FALSE, now = TRUE), error = function(e) NULL)
      }
      set_train_opts(
        mixed_precision = dnn_mixed_precision,
        cuda_graphs = dnn_cuda_graphs
      )
      .old_train_model <- get("train_model", envir = asNamespace("cito"))
      tryCatch({
        assignInNamespace("train_model", train_model_fused, ns = "cito")
      }, error = function(e) {
        use_fused <<- FALSE
        .old_train_model <<- NULL
      })
    }

    model <- tryCatch({
      cito::dnn(
        formula = model_formula,
        data = train_df,
        hidden = arch$hidden,
        activation = "relu",
        loss = "binomial",
        optimizer = "adam",
        lr = arch$lr,
        epochs = arch$epochs,
        batchsize = .vram_safe_batchsize(n_sites, arch$hidden, dnn_device, max_batch = 512L),
        dropout = arch$dropout,
        lambda = arch$lambda %||% 0.001,
        alpha = 1.0,
        validation = 0.3,
        lr_scheduler = cito::config_lr_scheduler("reduce_on_plateau", patience = 7),
        early_stopping = 14L,
        device = dnn_device,
        verbose = FALSE
      )
    }, error = function(e) {
      log_message(log_fun, "    Seed ", s, " failed: ", conditionMessage(e))
      NULL
    })

    # Restore original train_model
    if (!is.null(.old_train_model)) {
      tryCatch(assignInNamespace("train_model", .old_train_model, ns = "cito"),
        error = function(e) NULL)
    }

    if (!is.null(model)) seed_models[[s]] <- model
  }

  seed_models <- Filter(Negate(is.null), seed_models)
  if (length(seed_models) == 0) stop("All seeds failed to train.", call. = FALSE)

  best_model <- seed_models[[1]]
  n_success <- length(seed_models)

  # Compute per-species AUC across seeds
  if (n_success > 0 && n_species >= 2) {
    auc_vals <- vapply(seq_len(n_species), function(s) {
      obs <- community_mat[, s]
      if (length(unique(obs)) < 2) return(NA_real_)
      preds <- vapply(seed_models, function(m) {
        tryCatch({
          p <- stats::predict(m, newdata = as.data.frame(x_train_scaled), type = "response")
          as.numeric(p[, s] %||% p[, 1])
        }, error = function(e) rep(NA_real_, nrow(x_train_scaled)))
      }, numeric(nrow(x_train_scaled)))
      mean_pred <- rowMeans(preds, na.rm = TRUE)
      if (all(is.na(mean_pred))) return(NA_real_)
      tryCatch(pROC::auc(obs, mean_pred), error = function(e) NA_real_)
    }, numeric(1))
  } else {
    auc_vals <- NA_real_
  }
  auc_mean <- mean(auc_vals, na.rm = TRUE)
  auc_sd <- stats::sd(auc_vals, na.rm = TRUE)

  cv <- list(
    k = n_seeds,
    strategy = "dnn_multi_seed",
    n_species = n_species,
    n_sites = n_sites,
    auc_mean = if (is.finite(auc_mean)) auc_mean else NA_real_,
    auc_sd = if (is.finite(auc_sd)) auc_sd else NA_real_,
    tss_mean = NA_real_,
    tss_sd = NA_real_
  )

  log_message(log_fun, "  ", n_success, "/", n_seeds, " seeds trained successfully")
  if (is.finite(cv$auc_mean)) {
    log_message(log_fun, "  Multi-species DNN mean AUC across species: ", sprintf("%.3f", cv$auc_mean))
  }

  # SHAP on the first species only (cito::explain on multi-output is expensive)
  shap_values <- tryCatch({
    cito::explain(best_model, data = as.data.frame(x_train_scaled))
  }, error = function(e) NULL)

  list(
    model = best_model,
    ensemble_models = if (n_success > 1) seed_models else NULL,
    formula = model_formula,
    coefficients = NULL,
    model_data = train_df,
    community_matrix = community_mat,
    species_names = cm$species_names,
    n_species = n_species,
    occurrence_used = NULL,
    background_xy = site_xy[!duplicated(site_xy), , drop = FALSE],
    cv = cv,
    covariates = covariates,
    variable_importance = NULL,
    shap = shap_values,
    scaler = scaler,
    dnn_device = dnn_device,
    dnn_model_type = dnn_architecture
  )
}

predict_dnn_multispecies_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model)) stop("fit must be a multi-species DNN fit result list.", call. = FALSE)

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

  log_message(log_fun, "Predicting multi-species DNN suitability (", n_species, " species)")

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

  pred_df <- as.data.frame(x_pred_scaled)
  names(pred_df) <- covariates

  pred <- tryCatch({
    p <- stats::predict(fit$model, newdata = pred_df, type = "response")
    if (is.matrix(p)) p else as.matrix(p)
  }, error = function(e) {
    stop("Multi-species DNN prediction failed: ", conditionMessage(e), call. = FALSE)
  })

  if (ncol(pred) != n_species) {
    log_message(log_fun, "  Warning: model predicted ", ncol(pred), " outputs but expected ", n_species)
    n_species <- min(ncol(pred), n_species)
  }

  # Write per-species rasters
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

  # Write pixel-stack multi-band raster
  multi_rast <- terra::rast(species_tifs)
  names(multi_rast) <- make.names(species_names)

  # Richness raster (sum across species)
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
