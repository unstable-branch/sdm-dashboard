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
                                      mc_samples = 0L,
                                      uncertainty_method = "none",
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
    sd = matrixStats::colSds(x_train, na.rm = TRUE)
  )
  scaler$sd[scaler$sd == 0 | !is.finite(scaler$sd)] <- 1
  x_train_scaled <- sweep(x_train, 2, scaler$mean, "-")
  x_train_scaled <- sweep(x_train_scaled, 2, scaler$sd, "/")

  if (isTRUE(include_quadratic)) {
    log_message(log_fun, "Note: DNN captures nonlinearity natively; quadratic terms not needed")
  }

  log_message(log_fun, "Fitting multi-species DNN (", n_species, " species, ", n_sites, " sites, ",
    dnn_architecture, ", ", dnn_device, ")")

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
  # Uses custom ATen-op Adam kernel (train_step_adam.so) which works on CPU/CUDA/MPS.
  # Multi-output (multi-species) DNN on CUDA must disable fused Adam — the JIT
  # fuser (TensorExpr) fails to compile fused kernels for multi-output models
  # with half-precision operations (libnvrtc resolution + __half2float bug).
  # Single-output DNN with fused Adam works fine on GPU (see bench_e2e.R).
  torch_has_fused <- exists("torch__fused_adam_", envir = asNamespace("torch"))
  use_fused <- if (identical(use_fused_adam, "off")) {
    FALSE
  } else if (identical(dnn_device, "cuda")) {
    log_message(log_fun, "  Fused Adam enabled for multi-species on CUDA (FP32-only, JIT fuser incompatible with FP16 multi-output)")
    dnn_mixed_precision <- "off"
    TRUE
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

  # Enable cuDNN autotuner + TF32 matmul precision on CUDA
  if (identical(dnn_device, "cuda")) {
    tryCatch(torch::torch_backends_cudnn_benchmark(TRUE), error = function(e) NULL)
    tryCatch(torch::set_float32_matmul_precision("high"), error = function(e) NULL)
  }

  seed_models <- vector("list", n_seeds)
  for (s in seq_len(n_seeds)) {
    log_message(log_fun, "  Training seed ", s, "/", n_seeds)

    # Patch cito's train_model with fused Adam if enabled
    .old_train_model <- NULL
    if (use_fused) {
      # Load custom ATen-op Adam kernel (works on CPU/CUDA/MPS)
      sdm_root <- if (exists("sdm_project_root", mode = "function")) sdm_project_root() else getwd()
      cpp_so <- file.path(sdm_root, "sdmtorch", "train_step_adam.so")
      if (file.exists(cpp_so) && !is.loaded("adam_step_direct", PACKAGE = "")) {
        tryCatch(dyn.load(cpp_so, local = FALSE, now = TRUE), error = function(e) NULL)
      }
      # Fall back to libtorch _fused_adam_ kernel (CPU only; produces NaN on Blackwell GPU)
      # Only attempt this fallback on CPU — CUDA fallback is unsafe
      is_cuda <- tryCatch(torch::cuda_is_available(), error = function(e) FALSE)
      if (!is_cuda) {
        cpp_so2 <- file.path(sdm_root, "sdmtorch", "train_step_libtorch.so")
        if (!is.loaded("adam_step_direct", PACKAGE = "") &&
            file.exists(cpp_so2) && !is.loaded("fused_adam_step_direct", PACKAGE = "")) {
          tryCatch(dyn.load(cpp_so2, local = FALSE, now = TRUE), error = function(e) NULL)
        }
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

    if (identical(dnn_device, "cuda")) {
      tryCatch(torch::cuda_empty_cache(), error = function(e) NULL)
    }
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
          p <- torch::with_no_grad({
            stats::predict(m, newdata = as.data.frame(x_train_scaled), type = "response", device = dnn_device)
          })
          as.numeric(p[, s] %||% p[, 1])
        }, error = function(e) rep(NA_real_, nrow(x_train_scaled)))
      }, numeric(nrow(x_train_scaled)))
      mean_pred <- rowMeans(preds, na.rm = TRUE)
      if (all(is.na(mean_pred))) return(NA_real_)
      tryCatch(auc_rank(obs, mean_pred), error = function(e) NA_real_)
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
    tss_sd = NA_real_,
    species_auc = setNames(as.list(auc_vals), cm$species_names)
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
    species_presence_counts = setNames(as.list(colSums(community_mat > 0, na.rm = TRUE)), cm$species_names),
    background_xy = site_xy[!duplicated(site_xy), , drop = FALSE],
    cv = cv,
    covariates = covariates,
    variable_importance = NULL,
    shap = shap_values,
    scaler = scaler,
    dnn_device = dnn_device,
    gpu_used = identical(dnn_device, "cuda"),
    dnn_model_type = dnn_architecture,
    mc_samples = as.integer(mc_samples),
    uncertainty_method = match.arg(uncertainty_method, c("none", "mc_dropout", "heteroscedastic", "aleatoric_epistemic"))
  )
}

#' MC Dropout prediction for multi-species DNN
#' Runs forward passes with dropout active for each species output independently.
prepare_dnn_multispecies_prediction_batches <- function(env_subset, scaler, batch_size = 1000L) {
  valid_cells <- which(!is.na(terra::values(env_subset[[1]])))
  if (length(valid_cells) == 0) {
    return(list(cell_indices = integer(0), batches = list(), n_covariates = terra::nlyr(env_subset)))
  }

  n_covariates <- terra::nlyr(env_subset)
  batches <- vector("list", length = ceiling(length(valid_cells) / batch_size))
  batch_count <- 0L
  row_start <- 1L

  for (i in seq(1, length(valid_cells), by = batch_size)) {
    batch_cells <- valid_cells[i:min(i + batch_size - 1L, length(valid_cells))]
    batch_xy <- terra::xyFromCell(env_subset, batch_cells)
    batch_vals <- tryCatch(
      terra::extract(env_subset, batch_xy),
      error = function(e) stop("Failed to extract raster values: ", conditionMessage(e), call. = FALSE)
    )
    valid_rows <- stats::complete.cases(batch_vals)
    if (!any(valid_rows)) next

    batch_count <- batch_count + 1L
    scaled <- sweep(as.matrix(batch_vals[valid_rows, , drop = FALSE]), 2, scaler$mean, "-")
    scaled <- sweep(scaled, 2, scaler$sd, "/")
    row_end <- row_start + nrow(scaled) - 1L
    batches[[batch_count]] <- list(
      row_idx = row_start:row_end,
      cell_idx = batch_cells[valid_rows],
      scaled = scaled
    )
    row_start <- row_end + 1L
  }

  batches <- batches[seq_len(batch_count)]
  list(
    cell_indices = unlist(lapply(batches, `[[`, "cell_idx"), use.names = FALSE),
    batches = batches,
    n_covariates = n_covariates
  )
}

predict_dnn_multispecies_mc <- function(model, env_subset, scaler, device = "cpu",
                                        batch_size = 1000L, mc_samples = 30L,
                                        log_fun = NULL, decompose = FALSE,
                                        n_species = NULL) {
  is_cuda <- startsWith(as.character(device), "cuda")
  use_fp16 <- is_cuda && requireNamespace("torch", quietly = TRUE) && torch::cuda_is_available()
  label <- if (use_fp16) "MC Dropout (FP16)" else "MC Dropout"

  log_message(log_fun, label, ": ", mc_samples, " forward passes with dropout active (batch_size=", batch_size, ")")

  model$net$train()
  on.exit(model$net$eval(), add = TRUE)

  prep <- prepare_dnn_multispecies_prediction_batches(env_subset, scaler, batch_size = batch_size)
  if (length(prep$cell_indices) == 0) {
    stop("DNN-302: No valid cells for MC Dropout prediction", call. = FALSE)
  }

  n_valid <- length(prep$cell_indices)
  if (is.null(n_species)) {
    n_species <- 1L
    n_pred <- tryCatch({
      p <- torch::with_no_grad({
        logits <- model$net(torch::torch_tensor(prep$batches[[1]]$scaled[1, , drop = FALSE], device = device))
        if (inherits(logits, "torch_tensor")) as.matrix(logits$cpu()) else logits
      })
      if (is.matrix(p)) ncol(p) else 1L
    }, error = function(e) 1L)
    n_species <- max(n_pred, 1L)
  }

  if (is_cuda) {
    gpu_mean_mat <- torch::torch_zeros(n_valid, n_species, device = device)
    gpu_m2_mat <- torch::torch_zeros(n_valid, n_species, device = device)
    gpu_alea_sum_mat <- torch::torch_zeros(n_valid, n_species, device = device)
    gpu_pred <- torch::torch_zeros(n_valid, n_species, device = device)
  } else {
    mean_mat <- matrix(0, nrow = n_valid, ncol = n_species)
    m2_mat <- matrix(0, nrow = n_valid, ncol = n_species)
    alea_sum_mat <- matrix(0, nrow = n_valid, ncol = n_species)
    pred_matrix <- matrix(NA_real_, nrow = n_valid, ncol = n_species)
  }

  for (t in seq_len(mc_samples)) {
    if (!is.null(log_fun) && mc_samples > 5 && (t %% 5 == 0 || t == 1)) {
      log_message(log_fun, sprintf("  MC sample %d/%d", t, mc_samples))
    }

    if (is_cuda) {
      gpu_pred$zero_()
    } else {
      pred_matrix[] <- NA_real_
    }

    for (b in prep$batches) {
      batch_scaled <- b$scaled
      batch_pred <- tryCatch({
        p <- torch::with_no_grad({
          logits <- model$net(torch::torch_tensor(batch_scaled, device = device))
          if (inherits(logits, "torch_tensor")) {
            torch::torch_sigmoid(logits)
          }
        })
        if (is_cuda) {
          p
        } else {
          if (inherits(p, "torch_tensor")) as.matrix(p$cpu()) else as.matrix(p)
        }
      }, error = function(e) {
        stop("MC prediction failed: ", conditionMessage(e), call. = FALSE)
      })
      batch_rows <- b$row_idx
      if (is_cuda) {
        if (inherits(batch_pred, "torch_tensor")) {
          gpu_pred[batch_rows, ] <- batch_pred[, seq_len(n_species), drop = FALSE]
        }
      } else {
        batch_pred[is.na(batch_pred)] <- 0
        pred_matrix[batch_rows, ] <- batch_pred[, seq_len(n_species), drop = FALSE]
      }
    }

    if (is_cuda) {
      gpu_sample <- gpu_pred
      delta <- gpu_sample - gpu_mean_mat
      gpu_mean_mat <- gpu_mean_mat + delta / t
      delta2 <- gpu_sample - gpu_mean_mat
      gpu_m2_mat <- gpu_m2_mat + delta * delta2
      if (decompose) {
        gpu_alea_sum_mat <- gpu_alea_sum_mat + gpu_sample * (1 - gpu_sample)
      }
    } else {
      delta <- pred_matrix - mean_mat
      mean_mat <- mean_mat + delta / t
      delta2 <- pred_matrix - mean_mat
      m2_mat <- m2_mat + delta * delta2
      if (decompose) {
        alea_sum_mat <- alea_sum_mat + pred_matrix * (1 - pred_matrix)
      }
    }
  }

  if (is_cuda) {
    mean_mat <- as.matrix(gpu_mean_mat$cpu())
    m2_mat <- as.matrix(gpu_m2_mat$cpu())
    if (decompose) alea_sum_mat <- as.matrix(gpu_alea_sum_mat$cpu())
    rm(gpu_mean_mat, gpu_m2_mat, gpu_alea_sum_mat, gpu_pred)
  }

  # Final statistics per species
  if (mc_samples >= 2) {
    var_mat <- m2_mat / mc_samples
  } else {
    var_mat <- matrix(0, nrow = n_valid, ncol = n_species)
  }

  if (decompose && mc_samples >= 2) {
    aleatoric_mat <- alea_sum_mat / mc_samples
    epistemic_mat <- pmax(var_mat - aleatoric_mat, 0)
    total_mat <- aleatoric_mat + epistemic_mat
    sd_mat <- sqrt(total_mat)
  } else {
    sd_mat <- sqrt(var_mat)
    aleatoric_mat <- NULL
    epistemic_mat <- NULL
    total_mat <- NULL
  }

  list(
    mean = mean_mat,
    sd = sd_mat,
    aleatoric = aleatoric_mat,
    epistemic = epistemic_mat,
    total = total_mat,
    n_species = n_species,
    cell_indices = prep$cell_indices
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
  dnn_device <- fit$dnn_device %||% "cpu"
  mc_samples <- fit$mc_samples %||% 0L
  uncertainty_method <- fit$uncertainty_method %||% "none"

  log_message(log_fun, "Predicting multi-species DNN suitability (", n_species, " species)")

  prep <- prepare_dnn_multispecies_prediction_batches(env_subset, scaler)
  complete_idx <- prep$cell_indices
  n_cells <- length(complete_idx)

  if (n_cells == 0) {
    suit <- terra::rast(env_subset[[1]])
    names(suit) <- "suitability"
    suit <- terra::writeRaster(suit, output_tif, overwrite = TRUE)
    return(suit)
  }

  # Ensemble across seeds if available
  all_models <- c(list(fit$model), fit$ensemble_models %||% list())
  n_ensemble <- length(all_models)
  if (n_ensemble > 1) {
    log_message(log_fun, "  Ensembling ", n_ensemble, " seeds")
  }

  # Determine if MC Dropout should be used
  use_mc <- isTRUE(mc_samples > 0L) && uncertainty_method != "none"
  decompose <- identical(uncertainty_method, "aleatoric_epistemic")
  is_cuda_pred <- identical(dnn_device, "cuda") || startsWith(dnn_device, "cuda")

  if (use_mc) {
    mc_result <- predict_dnn_multispecies_mc(
      fit$model, env_subset, scaler, device = dnn_device,
      mc_samples = mc_samples, log_fun = log_fun, decompose = decompose,
      n_species = n_species
    )
    complete_idx <- mc_result$cell_indices
    pred <- mc_result$mean
    pred_sd <- mc_result$sd
    if (ncol(pred) < n_species) {
      n_species <- ncol(pred)
    }
  } else {
    pred <- matrix(NA_real_, nrow = n_cells, ncol = n_species)
    pred_sd <- matrix(NA_real_, nrow = n_cells, ncol = n_species)

    max_batch_len <- 0L
    for (b in prep$batches) {
      bl <- length(b$row_idx)
      if (bl > max_batch_len) max_batch_len <- bl
    }
    batch_pred <- array(dim = c(max_batch_len, n_species, n_ensemble))

    for (batch in prep$batches) {
      batch_idx <- batch$row_idx
      batch_len <- length(batch_idx)
      batch_scaled <- batch$scaled

      n_ok <- 0L
      for (e in seq_len(n_ensemble)) {
        p <- tryCatch({
          pmat <- torch::with_no_grad({
            logits <- all_models[[e]]$net(torch::torch_tensor(batch_scaled, device = dnn_device))
            if (inherits(logits, "torch_tensor")) {
              as.matrix(torch::torch_sigmoid(logits)$cpu())
            } else {
              logits
            }
          })
          if (is.matrix(pmat)) pmat else as.matrix(pmat)
        }, error = function(e) {
          log_message(log_fun, "  Seed ", e, " prediction failed for batch: ", conditionMessage(e))
          NULL
        })
        if (!is.null(p)) {
          n_ok <- n_ok + 1L
          if (ncol(p) < n_species) {
            p <- cbind(p, matrix(NA_real_, nrow = batch_len, ncol = n_species - ncol(p)))
          }
          batch_pred[seq_len(batch_len), , n_ok] <- p[, seq_len(n_species), drop = FALSE]
        }
      }

      if (n_ok == 0) {
        stop("Multi-species DNN prediction failed for all ensemble models", call. = FALSE)
      }

      pred[batch_idx, ] <- rowMeans(batch_pred[seq_len(batch_len), , seq_len(n_ok), drop = FALSE], dims = 2, na.rm = TRUE)
      pred_sd[batch_idx, ] <- apply(batch_pred[seq_len(batch_len), , seq_len(n_ok), drop = FALSE], 1:2, stats::sd, na.rm = TRUE)
    }
  }

  if (ncol(pred) != n_species) {
    log_message(log_fun, "  Warning: model predicted ", ncol(pred), " outputs but expected ", n_species)
    n_species <- min(ncol(pred), n_species)
    species_names <- species_names[seq_len(n_species)]
  }

  # Build multi-band raster in memory, write once
  species_rasts <- vector("list", n_species)
  for (i in seq_len(n_species)) {
    r <- terra::rast(env_subset[[1]])
    terra::values(r) <- NA_real_
    pred_vals <- pmax(0, pmin(1, pred[, i]))
    pred_vals[is.na(pred_vals)] <- 0
    r[complete_idx] <- pred_vals
    names(r) <- make.names(species_names[i])
    species_rasts[[i]] <- r
  }
  multi_rast <- do.call(c, species_rasts)
  rm(species_rasts)

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  gdal_opts <- c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")
  terra::writeRaster(multi_rast, output_tif, overwrite = TRUE, wopt = list(gdal = gdal_opts))
  log_message(log_fun, "  Multi-species suitability saved: ", output_tif)

  species_tifs <- character(n_species)
  for (i in seq_len(n_species)) {
    sp_tif <- sub("\\.tif$", paste0("_", make.names(species_names[i]), ".tif"), output_tif)
    terra::writeRaster(multi_rast[[i]], sp_tif, overwrite = TRUE, wopt = list(gdal = gdal_opts))
    species_tifs[i] <- sp_tif
  }

  richness <- sum(multi_rast, na.rm = TRUE)
  names(richness) <- "richness"
  richness_tif <- sub("\\.tif$", "_richness.tif", output_tif)
  terra::writeRaster(richness, richness_tif, overwrite = TRUE, wopt = list(gdal = gdal_opts))

  unc_tifs <- character(0)
  if (use_mc || n_ensemble > 1) {
    unc_tifs <- character(n_species)
    for (i in seq_len(n_species)) {
      unc_tif <- sub("\\.tif$", paste0("_", make.names(species_names[i]), "_uncertainty.tif"), output_tif)
      unc_rast <- terra::rast(env_subset[[1]])
      terra::values(unc_rast) <- NA_real_
      unc_rast[complete_idx] <- pmax(0, pred_sd[, i])
      names(unc_rast) <- paste0(make.names(species_names[i]), "_uncertainty")
      terra::writeRaster(unc_rast, unc_tif, overwrite = TRUE, wopt = list(gdal = gdal_opts))
      unc_tifs[i] <- unc_tif
    }
  }

  if (use_mc && decompose && !is.null(mc_result$aleatoric)) {
    for (i in seq_len(n_species)) {
      alea_tif <- sub("\\.tif$", paste0("_", make.names(species_names[i]), "_aleatoric.tif"), output_tif)
      alea_rast <- terra::rast(env_subset[[1]])
      terra::values(alea_rast) <- NA_real_
      alea_rast[complete_idx] <- pmax(0, mc_result$aleatoric[, i])
      names(alea_rast) <- paste0(make.names(species_names[i]), "_aleatoric")
      terra::writeRaster(alea_rast, alea_tif, overwrite = TRUE, wopt = list(gdal = gdal_opts))

      epi_tif <- sub("\\.tif$", paste0("_", make.names(species_names[i]), "_epistemic.tif"), output_tif)
      epi_rast <- terra::rast(env_subset[[1]])
      terra::values(epi_rast) <- NA_real_
      epi_rast[complete_idx] <- pmax(0, mc_result$epistemic[, i])
      names(epi_rast) <- paste0(make.names(species_names[i]), "_epistemic")
      terra::writeRaster(epi_rast, epi_tif, overwrite = TRUE, wopt = list(gdal = gdal_opts))
    }
  }

  log_message(log_fun, "  Wrote ", n_species, " species rasters + richness",
    if (length(unc_tifs) > 0) paste0(" + ", length(unc_tifs), " uncertainty rasters"),
    if (use_mc && decompose) " + aleatoric/epistemic decomposition",
    " to ", dirname(output_tif))

  attr(multi_rast, "species_tifs") <- species_tifs
  attr(multi_rast, "richness_tif") <- richness_tif
  attr(multi_rast, "uncertainty_tifs") <- unc_tifs
  multi_rast
}
