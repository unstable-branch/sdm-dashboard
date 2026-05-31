## DNN Modelling Wrapper using cito/torch ---------------------------------------
## This module provides deep neural network training and prediction using
## the cito package (torch backend) for species distribution modelling.
## DNN models run separately from biomod2 and are combined via ensemble.

#' Check DNN requirements
#'
#' @param n_records Number of presence records
#' @param log_fun Optional logging function
#' @return List with status (ok/warning/error), message, and GPU availability
#' @export
check_dnn_requirements <- function(n_records, log_fun = NULL) {
  check_result <- list(
    status = "ok",
    message = "DNN requirements met",
    gpu_available = FALSE,
    device = "cpu",
    estimated_time_cpu = NA,
    estimated_time_gpu = NA,
    cuda_version = NA,
    torch_version = NA,
    installation_status = NA
  )

  # Check torch installation first
  check_result$installation_status <- "not_checked"
  if (!requireNamespace("torch", quietly = TRUE)) {
    check_result$status <- "error"
    check_result$message <- "torch package not installed. Install with: install.packages('torch')"
    check_result$installation_status <- "missing"
    return(check_result)
  }

  # Check if LibTorch is installed
  check_result$installation_status <- tryCatch(
    {
      if (torch::torch_is_installed()) "ok" else "not_installed"
    },
    error = function(e) {
      "error"
    }
  )

  if (check_result$installation_status != "ok") {
    check_result$status <- "error"
    check_result$message <- paste(
      "LibTorch not installed. Run: library(torch); torch::install_torch()",
      "\nOr install GPU version: torch::install_torch(reinstall = TRUE)"
    )
    return(check_result)
  }

  # Get versions
  tryCatch(
    {
      check_result$torch_version <- as.character(packageVersion("torch"))
    },
    error = function(e) NULL
  )

  # Check record count
  if (n_records < config$dnn_hard_block) {
    check_result$status <- "error"
    check_result$message <- paste("Insufficient data for DNN (minimum", config$dnn_hard_block, "records required)")
    return(check_result)
  }

  if (n_records < config$dnn_warning_threshold) {
    check_result$status <- "warning"
    check_result$message <- "Limited data — DNN likely to underperform traditional models"
  } else if (n_records < config$dnn_soft_warning) {
    check_result$status <- "warning"
    check_result$message <- "Smaller dataset — DNN may benefit from simpler architecture"
  }

  # Check GPU availability with improved detection
  tryCatch(
    {
      has_cuda <- FALSE
      has_mps <- FALSE

      # CUDA detection
      has_cuda <- tryCatch(torch::cuda_is_available(), error = function(e) FALSE)

      # MPS detection (Apple Silicon)
      has_mps <- tryCatch(torch::mps_is_available(), error = function(e) FALSE)

      if (has_cuda) {
        check_result$gpu_available <- TRUE
        check_result$device <- "cuda"
        check_result$estimated_time_gpu <- 2
        check_result$estimated_time_cpu <- 25

        # Try to get CUDA version
        tryCatch(
          {
            cuda_ver <- Sys.getenv("CUDA", NA_character_)
            if (nzchar(cuda_ver)) {
              check_result$cuda_version <- cuda_ver
            }
          },
          error = function(e) NULL
        )

        if (!is.null(log_fun)) {
          log_fun(paste(
            "DNN GPU: CUDA available | Device: cuda |",
            "Records:", n_records,
            "| Expected time: ~2 min"
          ))
        }
      } else if (has_mps) {
        check_result$gpu_available <- TRUE
        check_result$device <- "mps"
        check_result$estimated_time_gpu <- 3
        check_result$estimated_time_cpu <- 25

        if (!is.null(log_fun)) {
          log_fun(paste(
            "DNN GPU: MPS (Apple Silicon) available | Device: mps |",
            "Records:", n_records,
            "| Expected time: ~3 min"
          ))
        }
      } else {
        check_result$device <- "cpu"
        check_result$estimated_time_cpu <- 25

        if (!is.null(log_fun)) {
          log_fun(paste(
            "DNN: CPU only | No GPU detected |",
            "Records:", n_records,
            "| Expected time: ~25 min"
          ))
        }
      }
    },
    error = function(e) {
      check_result$device <- "cpu"
      check_result$estimated_time_cpu <- 25
      if (!is.null(log_fun)) {
        log_fun(paste("DNN GPU detection failed:", conditionMessage(e), "- using CPU"))
      }
    }
  )

  if (!is.null(log_fun) && check_result$status == "ok") {
    log_fun(paste(
      "DNN requirements:",
      check_result$message,
      "| Device:",
      check_result$device,
      "| Installation:",
      check_result$installation_status
    ))
  }

  check_result
}

#' Prepare DNN training data
#'
#' @param occ_df Data frame with longitude, latitude columns
#' @param pred_stack terra SpatRaster stack of covariates
#' @param background_n Number of background points to sample
#' @param seed Random seed for reproducibility
#' @return List with train_x, train_y, test_x, test_y, scaler
#' @export
prepare_dnn_data <- function(occ_df, pred_stack, background_n = 1000, seed = 42L) {
  set.seed(seed)

  # DNN-104: Check raster stack has valid layers
  if (is.null(pred_stack) || terra::nlyr(pred_stack) < 1) {
    stop("DNN-104: Raster stack is empty or has no layers. Ensure covariates are properly loaded.", call. = FALSE)
  }

  # DNN-101: Extract presence points
  coords <- occ_df[, c("longitude", "latitude")]
  pres_vals <- tryCatch(
    {
      terra::extract(pred_stack, coords)
    },
    error = function(e) {
      stop(paste("DNN-101: Failed to extract presence points from raster:", conditionMessage(e)), call. = FALSE)
    }
  )
  pres_vals <- pres_vals[complete.cases(pres_vals), , drop = FALSE]

  if (nrow(pres_vals) == 0) {
    stop("DNN-101: No valid presence points found after raster extraction. Check that occurrence coordinates overlap with covariate raster extent.", call. = FALSE)
  }

  # DNN-102: Sample background points
  bg_mask <- pred_stack[[1]]
  bg_mask[!is.na(bg_mask)] <- 1
  bg_points <- tryCatch(
    {
      terra::spatSample(bg_mask, size = background_n * 2, method = "random", na.rm = TRUE, as.points = TRUE)
    },
    error = function(e) {
      stop(paste("DNN-102: Failed to sample background points:", conditionMessage(e)), call. = FALSE)
    }
  )

  if (terra::nrow(bg_points) == 0) {
    stop("DNN-102: No background points could be sampled. Ensure the raster extent contains valid data.", call. = FALSE)
  }

  if (terra::nrow(bg_points) > background_n) {
    bg_points <- bg_points[sample(terra::nrow(bg_points), background_n), ]
  }

  bg_vals <- tryCatch(
    {
      terra::extract(pred_stack, bg_points)
    },
    error = function(e) {
      stop(paste("DNN-102: Failed to extract background values from raster:", conditionMessage(e)), call. = FALSE)
    }
  )
  bg_vals <- bg_vals[complete.cases(bg_vals), , drop = FALSE]

  if (nrow(bg_vals) == 0) {
    stop("DNN-102: No valid background points found after raster extraction.", call. = FALSE)
  }

  # Combine and create labels
  n_pres <- nrow(pres_vals)
  n_bg <- nrow(bg_vals)

  all_data <- rbind(pres_vals, bg_vals)
  labels <- c(rep(1, n_pres), rep(0, n_bg))

  # DNN-103: Train/test split (80/20)
  n_total <- length(labels)
  if (n_total < 10) {
    stop(paste("DNN-103: Insufficient total data points (", n_total, "). Minimum 10 points required for train/test split."), call. = FALSE)
  }

  test_indices <- sample(n_total, size = floor(0.2 * n_total))
  train_indices <- setdiff(1:n_total, test_indices)

  train_x <- as.matrix(all_data[train_indices, ])
  train_y <- labels[train_indices]
  test_x <- as.matrix(all_data[test_indices, ])
  test_y <- labels[test_indices]

  # Scale features (z-score normalization)
  scaler <- list(
    mean = colMeans(train_x),
    sd = apply(train_x, 2, sd)
  )
  scaler$sd[scaler$sd == 0] <- 1

  train_x_scaled <- sweep(train_x, 2, scaler$mean, "-")
  train_x_scaled <- sweep(train_x_scaled, 2, scaler$sd, "/")
  test_x_scaled <- sweep(test_x, 2, scaler$mean, "-")
  test_x_scaled <- sweep(test_x_scaled, 2, scaler$sd, "/")

  list(
    train_x = train_x_scaled,
    train_y = train_y,
    test_x = test_x_scaled,
    test_y = test_y,
    scaler = scaler,
    n_presences = n_pres,
    n_background = n_bg,
    feature_names = names(pred_stack)
  )
}

#' Train a DNN model using cito
#'
#' @param train_data Output from prepare_dnn_data
#' @param model_type DNN architecture name (DNN_Small, DNN_Medium, DNN_Large)
#' @param device Device to use ("cuda", "mps", "cpu")
#' @param log_fun Optional logging function
#' @return Trained cito model object
#' @export
train_dnn_model <- function(train_data, model_type = "DNN_Medium", device = "cpu", log_fun = NULL,
                            dropout = NULL, lambda = NULL) {
  # DNN-201: Check cito package is installed
  if (!requireNamespace("cito", quietly = TRUE)) {
    stop("DNN-201: cito package not installed. Install with: install.packages('cito')", call. = FALSE)
  }

  # DNN-201b: Verify torch is installed and working
  if (!requireNamespace("torch", quietly = TRUE)) {
    stop("DNN-201b: torch package missing. Install with: install.packages('torch')", call. = FALSE)
  }

  if (!torch::torch_is_installed()) {
    stop(paste(
      "DNN-201b: LibTorch not installed.",
      "\n  Fix: Run in R: library(torch); torch::install_torch()",
      "\n  For GPU: Ensure CUDA Toolkit 12.8 + cuDNN installed, then: torch::install_torch(reinstall = TRUE)"
    ), call. = FALSE)
  }

  # DNN-202: Validate architecture
  arch <- config$dnn_arch[[model_type]]
  if (is.null(arch)) {
    stop(paste("DNN-202: Unknown DNN architecture:", model_type, ". Valid options: DNN_Small, DNN_Medium, DNN_Large"), call. = FALSE)
  }

  # DNN-203: Check training data size
  n_train <- length(train_data$train_y)
  if (n_train < 20) {
    stop(paste("DNN-203: Training data too small (", n_train, "samples). Minimum 20 samples required for DNN training."), call. = FALSE)
  }

  if (!is.null(log_fun)) {
    log_fun(paste(
      "Training DNN:", model_type, "| Hidden:", paste(arch$hidden, collapse = "->"),
      "| Epochs:", arch$epochs, "| Device:", device
    ))
  }

  formula_str <- paste("y ~", paste(train_data$feature_names, collapse = " + "))
  df <- as.data.frame(cbind(y = train_data$train_y, train_data$train_x))

  # Check device availability if GPU requested
  if (device == "cuda") {
    if (!torch::cuda_is_available()) {
      warning("DNN: CUDA requested but not available. Falling back to CPU.")
      device <- "cpu"
    }
  } else if (device == "mps") {
    if (!torch::mps_is_available()) {
      warning("DNN: MPS requested but not available. Falling back to CPU.")
      device <- "cpu"
    }
  }

  # DNN-204: Train model with error handling
  model <- tryCatch(
    {
      cito::dnn(
        formula = as.formula(formula_str),
        data = df,
        hidden = arch$hidden,
        activation = "relu",
        loss = "binomial",
        optimizer = "adam",
        lr = arch$lr,
        epochs = arch$epochs,
        batchsize = min(100L, max(32L, floor(n_train / 10))),
        dropout = dropout %||% arch$dropout,
        lambda = lambda %||% 0.001,
        alpha = 1.0,
        validation = 0.3,
        lr_scheduler = cito::config_lr_scheduler("reduce_on_plateau", patience = 7),
        early_stopping = 14L,
        device = device,
        verbose = FALSE
      )
    },
    error = function(e) {
      err_msg <- conditionMessage(e)

      # Provide specific suggestions based on error type
      if (grepl("cuda|CUDA", err_msg, ignore.case = TRUE)) {
        stop(paste(
          "DNN-204: CUDA error:", err_msg,
          "\n  Suggestions:",
          "\n  1. Verify CUDA Toolkit 12.8 is installed: nvidia-smi",
          "\n  2. Reinstall torch with GPU: torch::install_torch(reinstall = TRUE)",
          "\n  3. Try CPU device instead: device = 'cpu'"
        ), call. = FALSE)
      } else if (grepl("memory|Memory", err_msg, ignore.case = TRUE)) {
        stop(paste(
          "DNN-204: Out of memory error:", err_msg,
          "\n  Suggestions:",
          "\n  1. Reduce model size (use DNN_Small instead of DNN_Large)",
          "\n  2. Reduce batch size or epochs in config$dnn_arch",
          "\n  3. Use CPU with more available RAM"
        ), call. = FALSE)
      } else {
        stop(paste(
          "DNN-204: Training failed:", err_msg,
          "\n  Suggestions:",
          "\n  1. Check data: ensure covariate values are not all NA/NaN",
          "\n  2. Try CPU device: device = 'cpu'",
          "\n  3. Try simpler architecture: DNN_Small"
        ), call. = FALSE)
      }
    }
  )

  model
}

#' Generate DNN predictions on raster
#'
#' @param model Trained cito model
#' @param pred_stack SpatRaster stack for prediction
#' @param scaler Scaler from prepare_dnn_data
#' @param device Device used for training
#' @param batch_size Batch size for prediction
#' @return SpatRaster with prediction probabilities
#' @export
predict_dnn_raster <- function(model, pred_stack, scaler, device = "cpu", batch_size = 1000) {
  # DNN-301: Validate model object
  if (is.null(model)) {
    stop("DNN-301: Model object is NULL or invalid. Ensure training completed successfully.", call. = FALSE)
  }

  # DNN-302: Check raster has valid cells
  n_cells <- terra::ncell(pred_stack)
  valid_cells <- which(!is.na(terra::values(pred_stack[[1]])))

  if (length(valid_cells) == 0) {
    stop("DNN-302: Raster stack has no valid cells to predict. Check that the projection extent overlaps with covariate rasters.", call. = FALSE)
  }

  # Process in batches with error handling
  pred_vals <- rep(NA, n_cells)

  for (i in seq(1, length(valid_cells), by = batch_size)) {
    batch_idx <- valid_cells[i:min(i + batch_size - 1, length(valid_cells))]
    batch_xy <- terra::xyFromCell(pred_stack, batch_idx)
    batch_vals <- tryCatch(
      {
        terra::extract(pred_stack, batch_xy)
      },
      error = function(e) {
        stop(paste("DNN-303: Failed to extract raster values for prediction:", conditionMessage(e)), call. = FALSE)
      }
    )

    # Track which rows in batch_idx had valid data
    valid_rows <- complete.cases(batch_vals)
    valid_batch_idx <- batch_idx[valid_rows]
    valid_batch_vals <- batch_vals[valid_rows, , drop = FALSE]

    if (nrow(valid_batch_vals) > 0) {
      # Scale
      batch_scaled <- sweep(as.matrix(valid_batch_vals), 2, scaler$mean, "-")
      batch_scaled <- sweep(batch_scaled, 2, scaler$sd, "/")

      # DNN-303: Predict with error handling
      batch_pred <- tryCatch(
        {
          pred <- predict(model, newdata = as.data.frame(batch_scaled), type = "response")
          if (is.matrix(pred)) pred[, 1] else as.numeric(pred)
        },
        error = function(e) {
          stop(paste("DNN-303: Prediction failed for batch:", conditionMessage(e)), call. = FALSE)
        }
      )

      # Map back to valid cell indices
      pred_vals[valid_batch_idx] <- batch_pred
    }
  }

  # Create raster
  pred_raster <- pred_stack[[1]]
  terra::values(pred_raster) <- pred_vals
  pred_raster
}

#' Calculate DNN performance metrics
#'
#' @param model Trained cito model
#' @param test_data Test data from prepare_dnn_data
#' @return List with AUC, TSS, sensitivity, specificity
#' @export
get_dnn_metrics <- function(model, test_data) {
  # DNN-401: Check test data is not empty
  if (is.null(test_data) || is.null(test_data$test_x) || is.null(test_data$test_y)) {
    stop("DNN-401: Test data is NULL or missing. Ensure prepare_dnn_data completed successfully.", call. = FALSE)
  }

  if (length(test_data$test_y) == 0) {
    stop("DNN-401: Test data is empty. Cannot calculate metrics.", call. = FALSE)
  }

  # DNN-402: Get predictions with error handling
  pred_probs <- tryCatch(
    {
      pred <- predict(model, newdata = as.data.frame(test_data$test_x), type = "response")
      if (is.matrix(pred)) pred[, 1] else as.numeric(pred)
    },
    error = function(e) {
      stop(paste("DNN-402: Failed to get predictions on test data:", conditionMessage(e)), call. = FALSE)
    }
  )

  pred_binary <- ifelse(pred_probs > 0.5, 1, 0)

  # Calculate metrics
  tp <- sum(pred_binary == 1 & test_data$test_y == 1)
  tn <- sum(pred_binary == 0 & test_data$test_y == 0)
  fp <- sum(pred_binary == 1 & test_data$test_y == 0)
  fn <- sum(pred_binary == 0 & test_data$test_y == 1)

  sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else 0
  specificity <- if ((tn + fp) > 0) tn / (tn + fp) else 0

  # TSS = sensitivity + specificity - 1
  tss <- sensitivity + specificity - 1

  # DNN-403: Check test labels have variance
  auc <- NA
  if (length(unique(test_data$test_y)) == 1) {
    warning("DNN-403: Test labels have no variance (all 0s or all 1s). AUC cannot be calculated meaningfully.")
  } else {
    tryCatch(
      {
        auc <- auc_rank(test_data$test_y, pred_probs)
      },
      error = function(e) {
        warning(paste("DNN-403: AUC calculation failed:", conditionMessage(e)))
      }
    )
  }

  list(
    AUC = as.numeric(auc),
    TSS = as.numeric(tss),
    sensitivity = as.numeric(sensitivity),
    specificity = as.numeric(specificity),
    n_test = length(test_data$test_y)
  )
}

#' Run DNN models
#'
#' @param occ_df Data frame with longitude, latitude columns
#' @param pred_stack SpatRaster stack of covariates
#' @param selected_dnn_models Character vector of DNN architectures to run
#' @param background_n Number of background points
#' @param device Device for training ("auto", "cuda", "mps", "cpu")
#' @param log_fun Optional logging function
#' @param progress_fun Optional progress function
#' @return List with predictions, metrics, and models for each architecture
#' @export
run_dnn <- function(occ_df, pred_stack, selected_dnn_models = NULL,
                    background_n = 1000, device = "auto",
                    dropout = NULL, lambda = NULL,
                    log_fun = NULL, progress_fun = NULL) {
  if (is.null(selected_dnn_models) || length(selected_dnn_models) == 0) {
    return(NULL)
  }

  # Validate requirements
  check <- check_dnn_requirements(nrow(occ_df), log_fun = log_fun)
  if (check$status == "error") {
    if (!is.null(log_fun)) log_fun(paste("DNN skipped:", check$message))
    return(NULL)
  }

  # DNN-501: Additional check for record count
  if (nrow(occ_df) < config$dnn_hard_block) {
    err_msg <- paste(
      "DNN-501: Insufficient records for DNN. Found", nrow(occ_df),
      "but minimum", config$dnn_hard_block, "required."
    )
    if (!is.null(log_fun)) log_fun(paste("ERROR:", err_msg))
    stop(err_msg, call. = FALSE)
  }

  # Determine device
  if (device == "auto") {
    device <- check$device
  } else if (device == "gpu") {
    # Try GPU, fall back to CPU if not available
    if (check$gpu_available) {
      device <- check$device
      if (!is.null(log_fun)) log_fun(paste("Using GPU device:", device))
    } else {
      device <- "cpu"
      if (!is.null(log_fun)) log_fun("GPU requested but not available, using CPU")
    }
  } else if (device == "cpu") {
    device <- "cpu"
  }

  # DNN-502: Prepare data with error handling
  dnn_data <- tryCatch(
    {
      prepare_dnn_data(occ_df, pred_stack, background_n = background_n)
    },
    error = function(e) {
      err_msg <- paste("DNN-502: Data preparation failed:", conditionMessage(e))
      if (!is.null(log_fun)) log_fun(paste("ERROR:", err_msg))
      stop(err_msg, call. = FALSE)
    }
  )

  if (!is.null(progress_fun)) {
    progress_fun(0.1, "Preparing DNN training data")
  }

  # Train and predict for each model
  results <- list()
  n_models <- length(selected_dnn_models)

  for (i in seq_along(selected_dnn_models)) {
    model_type <- selected_dnn_models[i]

    if (!is.null(log_fun)) {
      log_fun(paste("Training DNN model:", model_type))
    }

    if (!is.null(progress_fun)) {
      progress_fun(0.1 + (i - 1) * 0.4 / n_models, paste("Training DNN:", model_type))
    }

    # DNN-503: Train model with error handling
    model <- tryCatch(
      {
        train_dnn_model(dnn_data, model_type = model_type, device = device, log_fun = log_fun,
                         dropout = dropout, lambda = lambda)
      },
      error = function(e) {
        err_msg <- paste("DNN-503: Model training failed for", model_type, ":", conditionMessage(e))
        if (!is.null(log_fun)) log_fun(paste("ERROR:", err_msg))
        stop(err_msg, call. = FALSE)
      }
    )

    # Get metrics
    metrics <- tryCatch(
      {
        get_dnn_metrics(model, dnn_data)
      },
      error = function(e) {
        warning(paste("DNN: Metrics calculation failed for", model_type, ":", conditionMessage(e)))
        list(AUC = NA, TSS = NA, sensitivity = NA, specificity = NA, n_test = 0)
      }
    )
    metrics$model_type <- model_type

    if (!is.null(progress_fun)) {
      progress_fun(0.5 + i * 0.4 / n_models, paste("Predicting DNN:", model_type))
    }

    # DNN-504: Generate predictions with error handling
    pred_raster <- tryCatch(
      {
        predict_dnn_raster(model, pred_stack, dnn_data$scaler, device = device)
      },
      error = function(e) {
        err_msg <- paste("DNN-504: Prediction failed for", model_type, ":", conditionMessage(e))
        if (!is.null(log_fun)) log_fun(paste("ERROR:", err_msg))
        stop(err_msg, call. = FALSE)
      }
    )

    results[[model_type]] <- list(
      model = model,
      prediction = pred_raster,
      metrics = metrics,
      scaler = dnn_data$scaler,
      train_data = dnn_data
    )
  }

  if (!is.null(progress_fun)) {
    progress_fun(0.95, "DNN training complete")
  }

  list(
    results = results,
    device = device,
    gpu_used = check$gpu_available,
    record_count = nrow(occ_df)
  )
}

# --- Registry-compatible wrappers ---

#' Fit DNN SDM (registry pattern)
fit_dnn_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                         include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                         seed = sdm_default_seed, n_cores = 1, log_fun = NULL,
                         cv_strategy = sdm_default_cv_strategy,
                         cv_block_size_km = sdm_default_cv_block_size_km,
                         threshold = sdm_default_threshold,
                         bias_method = "uniform",
                         target_group_occ = NULL,
                         thickening_distance_km = NULL,
                          dnn_model_type = "DNN_Medium",
                          dnn_device = "auto",
                          n_seeds = 5L,
                          dropout = NULL,
                          lambda = NULL,
                         ...) {
  if (!requireNamespace("cito", quietly = TRUE) || !requireNamespace("torch", quietly = TRUE)) {
    stop("DNN backend requires cito and torch packages. Install them or choose a different backend.", call. = FALSE)
  }

  d <- prepare_sdm_data(occ, env_train_scaled, background_n,
    seed = seed, log_fun = log_fun,
    bias_method = bias_method %||% "uniform",
    target_group_occ = target_group_occ %||% NULL,
    thickening_distance_km = thickening_distance_km %||% NULL
  )
  occ_used <- d$occ_used
  bg_xy <- d$bg_xy
  model_data <- d$model_data
  covariates <- d$covariates

  x_train <- as.matrix(model_data[, covariates, drop = FALSE])
  scaler <- list(
    mean = colMeans(x_train, na.rm = TRUE),
    sd = apply(x_train, 2, stats::sd, na.rm = TRUE)
  )
  scaler$sd[scaler$sd == 0 | !is.finite(scaler$sd)] <- 1
  x_train_scaled <- sweep(x_train, 2, scaler$mean, "-")
  x_train_scaled <- sweep(x_train_scaled, 2, scaler$sd, "/")

  n_seeds <- as.integer(n_seeds)[1]
  if (is.na(n_seeds) || n_seeds < 1) n_seeds <- 1L

  log_message(log_fun, "Fitting DNN SDM (", dnn_model_type, ") with ", n_seeds, " seeds, ",
    sum(model_data$presence == 1), " presences")

  # Train multiple seeds
  seed_models <- vector("list", n_seeds)
  seed_metrics <- vector("list", n_seeds)
  train_df <- as.data.frame(x_train_scaled)
  names(train_df) <- covariates

  for (s in seq_len(n_seeds)) {
    log_message(log_fun, "  Training seed ", s, "/", n_seeds)
    dnn_data <- list(
      train_x = x_train_scaled,
      train_y = model_data$presence,
      test_x = x_train_scaled,
      test_y = model_data$presence,
      feature_names = covariates
    )

    model <- tryCatch(
      train_dnn_model(dnn_data, model_type = dnn_model_type, device = dnn_device, log_fun = log_fun,
                       dropout = dropout, lambda = lambda),
      error = function(e) {
        log_message(log_fun, "    Seed ", s, " failed: ", conditionMessage(e))
        NULL
      }
    )
    if (is.null(model)) next

    seed_models[[s]] <- model
  }

  seed_models <- Filter(Negate(is.null), seed_models)
  if (length(seed_models) == 0) stop("All DNN seeds failed to train.", call. = FALSE)

  n_success <- length(seed_models)
  log_message(log_fun, "  ", n_success, "/", n_seeds, " seeds trained successfully")

  # Ensemble: average predictions across seeds
  best_model <- seed_models[[1]]
  ensemble_models <- seed_models

  # Compute mean AUC across seeds
  auc_vals <- vapply(seed_models, function(m) {
    tryCatch({
      pred <- predict(m, newdata = as.data.frame(dnn_data$train_x), type = "response")
      if (is.matrix(pred)) pred <- pred[, 1]
      auc_rank(dnn_data$train_y, as.numeric(pred))
    }, error = function(e) NA_real_)
  }, numeric(1))
  auc_mean <- mean(auc_vals, na.rm = TRUE)
  auc_sd <- stats::sd(auc_vals, na.rm = TRUE)

  cv <- list(
    k = n_success,
    strategy = "dnn_multi_seed",
    auc_mean = if (is.finite(auc_mean)) auc_mean else NA_real_,
    auc_sd = if (is.finite(auc_sd)) auc_sd else NA_real_,
    tss_mean = NA_real_,
    tss_sd = NA_real_,
    fold_auc = auc_vals,
    n_seeds = n_success
  )

  if (is.finite(cv$auc_mean)) {
    log_message(log_fun, "DNN multi-seed AUC: ", sprintf("%.3f", cv$auc_mean),
      if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else "")
  }

  # Compute SHAP and native importance/PDP on the first model
  shap_values <- tryCatch({
    cito::explain(best_model, data = train_df)
  }, error = function(e) {
    log_message(log_fun, "cito::explain() failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(shap_values)) {
    log_message(log_fun, "SHAP feature attribution computed (", length(shap_values), " variables)")
  }

  cito_importance <- tryCatch({
    cito::variable_importance(best_model, data = train_df)
  }, error = function(e) {
    log_message(log_fun, "cito::variable_importance() failed: ", conditionMessage(e))
    NULL
  })

  cito_pdp <- tryCatch({
    cito::PDP(best_model, data = train_df, variable = covariates)
  }, error = function(e) {
    log_message(log_fun, "cito::PDP() failed: ", conditionMessage(e))
    NULL
  })

  list(
    model = best_model,
    ensemble_models = ensemble_models,
    formula = NULL,
    coefficients = NULL,
    model_data = model_data,
    occurrence_used = occurrence_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = cito_importance,
    shap = shap_values,
    cito_importance = cito_importance,
    cito_pdp = cito_pdp,
    scaler = scaler,
    n_seeds = n_success,
    dnn_device = dnn_device,
    dnn_model_type = dnn_model_type
  )
}

#' Predict DNN suitability (registry pattern)
predict_dnn_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  n_seeds <- length(fit$ensemble_models %||% list())
  if (n_seeds > 1) {
    log_message(log_fun, "Predicting suitability raster with DNN ensemble (", n_seeds, " seeds, ", fit$dnn_model_type, ")")

    seed_preds <- vector("list", n_seeds)
    for (s in seq_len(n_seeds)) {
      seed_preds[[s]] <- predict_dnn_raster(fit$ensemble_models[[s]], env_project_scaled,
        fit$scaler, device = fit$dnn_device)
    }

    pred_stack <- terra::rast(seed_preds)
    mean_pred <- mean(pred_stack, na.rm = TRUE)
    sd_pred <- terra::stdev(pred_stack, na.rm = TRUE)

    terra::values(mean_pred)[is.nan(terra::values(mean_pred))] <- NA
    terra::values(sd_pred)[is.nan(terra::values(sd_pred))] <- NA
    names(mean_pred) <- "suitability"

    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(mean_pred, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
    log_message(log_fun, "DNN ensemble suitability saved: ", output_tif)

    uncertainty_tif <- sub("\\.tif$", "_uncertainty.tif", output_tif)
    terra::writeRaster(sd_pred, uncertainty_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
    log_message(log_fun, "DNN ensemble uncertainty (SD) saved: ", uncertainty_tif, " +/- ", sprintf("%.3f", mean(terra::values(sd_pred), na.rm = TRUE)))

    attr(mean_pred, "uncertainty_tif") <- uncertainty_tif
    mean_pred
  } else {
    log_message(log_fun, "Predicting suitability raster with DNN (", fit$dnn_model_type, ")")
    pred <- predict_dnn_raster(fit$model, env_project_scaled, fit$scaler, device = fit$dnn_device)
    dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(pred, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
    log_message(log_fun, "DNN suitability saved: ", output_tif)
    pred
  }
}
