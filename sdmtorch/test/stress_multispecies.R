#!/usr/bin/env Rscript
#
# Multi-species DNN Stress Test
#
# Generates synthetic multi-species occurrence data with known environmental
# niches and stresses the dnn_multispecies pipeline at scale:
#   10,000 synthetic occurrence points per species
#   150x150 raster (22,500 cells) with 6 BIO layers
#   Up to 10 species with 1-3 seeds
#   Small, Medium, Large architectures
#
# Usage:
#   Rscript sdmtorch/test/stress_multispecies.R
#
# Requirements:
#   cito, torch, terra installed
#   CUDA for GPU tests (optional)

`%||%` <- function(a, b) if (!is.null(a)) a else b

stress_main <- function() {
  # ---------------------------------------------------------------------------
  # 1. Project setup
  # ---------------------------------------------------------------------------
  app_dir <- tryCatch({
    # If running from project root with Rscript, getwd() should be the root
    wd <- getwd()
    if (file.exists(file.path(wd, "R", "core", "bootstrap.R"))) {
      wd
    } else if (file.exists(file.path(wd, "..", "R", "core", "bootstrap.R"))) {
      normalizePath(file.path(wd, ".."))
    } else {
      stop("Cannot find project root from ", wd)
    }
  }, error = function(e) stop("Run from project root directory"))
  cat("Project root:", app_dir, "\n")

  source(file.path(app_dir, "R", "core", "bootstrap.R"))
  sdm_set_project_root(app_dir)
  source(file.path(app_dir, "R", "load_compute.R"))

  has_cito <- requireNamespace("cito", quietly = TRUE)
  has_torch <- requireNamespace("torch", quietly = TRUE)
  if (!has_cito || !has_torch) {
    stop("cito and torch packages required for DNN stress test")
  }

  has_cuda <- tryCatch(torch::cuda_is_available(), error = function(e) FALSE)

  # CUDA JIT (TensorExpr fuser) requires libnvrtc.so.12 on LD_LIBRARY_PATH.
  # R's Sys.setenv does NOT affect dlopen() — the env var must be set before R
  # starts. Use the wrapper script: ./sdmtorch/test/run_gpu_stress.sh
  if (has_cuda) {
    torch_lib_dir <- file.path(system.file(package = "torch"), "lib")
    nvrtc_test <- tryCatch({
      suppressWarnings(torch::torch_tensor(1, device = "cuda")$pow(2)$sum()$item())
      TRUE
    }, error = function(e) FALSE)
    if (!nvrtc_test) {
      cat("WARNING: CUDA available but JIT compilation fails (libnvrtc not found).\n")
      cat("  GPU test combos will be skipped.\n")
      cat("  To enable GPU, use: ./sdmtorch/test/run_gpu_stress.sh\n")
    }
  }

  # Set terra temp dir to a local temp directory to avoid cross-device link errors
  local_tmp <- file.path(tempdir(), "stress_tmp")
  dir.create(local_tmp, recursive = TRUE, showWarnings = FALSE)
  terra::terraOptions(tempdir = local_tmp)

  cat("Multi-species DNN Stress Test\n")
  cat("============================\n")
  cat("Project root:", app_dir, "\n")
  cat("CUDA available:", has_cuda, "\n")
  cat("Terra temp dir:", local_tmp, "\n\n")

  # ---------------------------------------------------------------------------
  # 2. Synthetic data generation
  # ---------------------------------------------------------------------------
  make_stress_raster <- function(nrows = 150L, ncols = 150L, seed = 42L) {
     set.seed(seed)
     layer_names <- c("bio1", "bio2", "bio3", "bio4", "bio12", "bio15")
     rasters <- lapply(seq_along(layer_names), function(i) {
       r <- terra::rast(nrows = nrows, ncols = ncols,
                        xmin = 140, xmax = 142, ymin = -24, ymax = -22)
       terra::values(r) <- runif(terra::ncell(r), 0, 1)
       r
     })
     stack <- do.call(c, rasters)
     names(stack) <- layer_names
     stack
   }

  generate_niches <- function(n_species, n_covariates = 6L, seed = 42L) {
    set.seed(seed)
    # Spread niche centers across environmental space with minimum separation
    centers <- matrix(0, nrow = n_species, ncol = n_covariates)
    min_dist <- 1.0 / sqrt(n_species)
    for (s in seq_len(n_species)) {
      for (attempt in 1:100) {
        candidate <- runif(n_covariates, 0.1, 0.9)
        if (s == 1) break
        dists <- apply(centers[seq_len(s - 1), , drop = FALSE], 1,
                       function(c) sqrt(sum((candidate - c)^2)))
        if (all(dists >= min_dist)) break
      }
      centers[s, ] <- candidate
    }
    # Niche width: moderate breadth, slight variation per species
    sigma <- rep(0.25, n_species)
    list(centers = centers, sigma = sigma)
  }

  sample_occurrences <- function(raster, env_vals, complete_cells,
                                 center, sigma, n_points = 10000L, seed = 42L) {
    set.seed(seed)
    vals <- env_vals[complete_cells, , drop = FALSE]
    diffs <- sweep(vals, 2, center, "-")
    if (ncol(diffs) > 0) {
      dists <- sqrt(rowSums(diffs^2))
    } else {
      dists <- rep(0, nrow(vals))
    }
    probs <- exp(-dists^2 / (2 * sigma^2))
    probs <- probs / sum(probs)
    sample_idx <- sample(length(complete_cells), n_points, replace = TRUE, prob = probs)
    cell_ids <- complete_cells[sample_idx]
    xy <- terra::xyFromCell(raster, cell_ids)
    data.frame(longitude = xy[, "x"], latitude = xy[, "y"])
  }

  # ---------------------------------------------------------------------------
  # 3. Test combos
  # ---------------------------------------------------------------------------
  combos <- list(
    list(n_species = 3L,  occ = 10000L, arch = "DNN_Small",  seeds = 1L),
    list(n_species = 3L,  occ = 10000L, arch = "DNN_Medium", seeds = 1L),
    list(n_species = 3L,  occ = 10000L, arch = "DNN_Large",  seeds = 1L),
    list(n_species = 10L, occ = 10000L, arch = "DNN_Medium", seeds = 1L),
    list(n_species = 10L, occ = 10000L, arch = "DNN_Medium", seeds = 3L),
    list(n_species = 3L,  occ = 10000L, arch = "DNN_Large",  seeds = 3L)
  )

  gpu_combos <- list()
  if (has_cuda) {
    gpu_combos <- list(
      list(n_species = 3L, occ = 10000L, arch = "DNN_Large", seeds = 1L),
      list(n_species = 3L, occ = 10000L, arch = "DNN_Large", seeds = 1L)
    )
  }

  all_combos <- c(combos, gpu_combos)
  cat("Total combos:", length(all_combos), "\n\n")

  # ---------------------------------------------------------------------------
  # 4. Stress test runner
  # ---------------------------------------------------------------------------
  report_mem <- function() {
    if (!torch::cuda_is_available()) return(list(allocated_mb = NA, reserved_mb = NA, peak_allocated_mb = NA))
    tryCatch({
      stats <- torch::cuda_memory_stats()
      allocated <- stats$allocated_bytes$all$current %/% (1024L * 1024L)
      reserved <- stats$reserved_bytes$all$current %/% (1024L * 1024L)
      peak <- tryCatch(stats$allocated_bytes$all$peak %/% (1024L * 1024L), error = function(e) NA_integer_)
      list(allocated_mb = allocated, reserved_mb = reserved, peak_allocated_mb = peak)
    }, error = function(e) list(allocated_mb = NA, reserved_mb = NA, peak_allocated_mb = NA))
  }

  has_duplicate_rows <- function(df) {
    nrow(df) != nrow(unique(df))
  }

  # Generate one shared raster and environmental data for all combos
  cat("Generating stress raster...\n")
  env_raster <- make_stress_raster(nrows = 150L, ncols = 150L)
  env_vals <- terra::values(env_raster)
  complete_cells <- which(stats::complete.cases(env_vals))
  ncells <- length(complete_cells)
  cat("  Raster cells:", ncells, "\n\n")

  results <- list()
  n_species_base <- 3L

  for (idx in seq_along(all_combos)) {
    combo <- all_combos[[idx]]
    is_gpu <- idx > length(combos)
    n_sp <- combo$n_species
    n_occ <- combo$occ
    arch <- combo$arch
    n_seeds <- combo$seeds
    label <- sprintf("%dsp-%s-%dseed%s", n_sp, arch, n_seeds,
                     if (is_gpu) "-GPU" else "")

    cat(sprintf("\n[%d/%d] %s\n", idx, length(all_combos), label))
    cat(strrep("-", 60), "\n", sep = "")

    # Generate species data
    niches <- generate_niches(n_sp, 6L, seed = idx * 42L)
    species_names <- paste0("Sp_", LETTERS[seq_len(n_sp)])

    all_occ_list <- vector("list", n_sp)
    for (s in seq_len(n_sp)) {
      occ_df <- sample_occurrences(
        env_raster, env_vals, complete_cells,
        center = niches$centers[s, ],
        sigma = niches$sigma[s],
        n_points = n_occ,
        seed = idx * 100L + s * 7L
      )
      occ_df$species <- species_names[s]
      all_occ_list[[s]] <- occ_df
    }
    occ_data <- do.call(rbind, all_occ_list)
    cat("  Occurrence rows:", nrow(occ_data), "\n")

    # Run the combo
    result <- list(
      label = label,
      n_species = n_sp,
      arch = arch,
      seeds = n_seeds,
      gpu = is_gpu,
      fit_ok = FALSE,
      pred_ok = FALSE,
      auc_mean = NA_real_,
      auc_per_species = NA_character_,
      raster_ok = FALSE,
      richness_ok = FALSE,
      cell_range = NA_character_,
      fit_time = NA_real_,
      pred_time = NA_real_,
      device_used = "cpu",
      mem_mb = NA_real_,
      errors = character(),
      n_sites = NA_integer_
    )

    result <- tryCatch({
      gc(full = TRUE)

      if (is_gpu && torch::cuda_is_available()) {
        # Verify CUDA JIT works — a simple tensor operation triggers it
        jit_ok <- tryCatch({
          suppressWarnings(torch::torch_tensor(1, device = "cuda")$pow(2)$sum()$item())
          TRUE
        }, error = function(e) FALSE)
        if (!jit_ok) {
          result$errors <- c(result$errors, "CUDA JIT compiler unavailable (missing libnvrtc)")
          return(result)
        }
        torch::cuda_synchronize()
        gc(full = TRUE)
        result$device_used <- "cuda"
      } else if (is_gpu) {
        result$errors <- c(result$errors, "CUDA not available")
        return(result)
      }

      # Build community matrix
      t0 <- Sys.time()
      cm <- build_community_matrix(
        occ_data, env_raster,
        background_n = 3000L,
        seed = idx * 42L
      )
      result$n_sites <- cm$n_sites
      cat("  Community matrix: n_sites =", cm$n_sites, ", n_species =", cm$n_species, "\n")

      if (cm$n_species < 2) {
        result$errors <- c(result$errors, "Less than 2 species in community matrix")
        return(result)
      }

      # Fit model
      cat("  Fitting", arch, "with", n_seeds, "seed(s)...\n")
      fit_time_start <- Sys.time()
      device <- if (is_gpu) "cuda" else "cpu"
      # Multi-species DNN on GPU: disable fused Adam and mixed precision because
      # the fused Adam kernel triggers CUDA JIT (TensorExpr fuser) which fails on
      # multi-output models with this torch/CUDA version. Single-species DNN with
      # fused Adam + AMP works fine (see bench_e2e.R).
      fa_setting <- if (is_gpu) "off" else "auto"
      mp_setting <- if (is_gpu) "off" else "off"

      fit <- fit_dnn_multispecies_sdm(
        occ = occ_data,
        env_train_scaled = env_raster,
        background_n = 3000L,
        cv_folds = 0L,
        seed = idx * 42L,
        n_cores = 1L,
        dnn_architecture = arch,
        dnn_device = device,
        n_seeds = n_seeds,
        use_fused_adam = fa_setting,
        dnn_mixed_precision = mp_setting,
        dnn_cuda_graphs = "off"
      )
      result$fit_time <- as.numeric(Sys.time() - fit_time_start)
      result$fit_ok <- TRUE
      cat("  Fit time:", sprintf("%.1f", result$fit_time), "s\n")

      # Check AUC
      if (is.list(fit$cv) && is.finite(fit$cv$auc_mean %||% NA_real_)) {
        result$auc_mean <- fit$cv$auc_mean
        cat("  Mean AUC:", sprintf("%.4f", result$auc_mean), "\n")

        # Per-species AUC
        auc_vals <- fit$cv$auc_per_species %||% NULL
        if (!is.null(auc_vals) && is.numeric(auc_vals) && length(auc_vals) >= 1) {
          result$auc_per_species <- paste(sprintf("%.3f", auc_vals), collapse = ", ")
          all_above_half <- all(auc_vals > 0.5, na.rm = TRUE)
          result$auc_ok <- result$auc_mean > 0.5 && all_above_half
        } else {
          result$auc_ok <- result$auc_mean > 0.5
        }
      }

      # Check loss convergence
      if (is.numeric(fit$cv$loss %||% NULL)) {
        loss_vec <- fit$cv$loss
        result$loss_ok <- length(loss_vec) >= 2 && loss_vec[length(loss_vec)] < loss_vec[1]
      }

      # Predict suitability
      cat("  Predicting...\n")
      output_tif <- tempfile(pattern = paste0("stress_", idx, "_"), fileext = ".tif")
      pred_time_start <- Sys.time()

      pred_result <- predict_dnn_multispecies_suitability(
        fit, env_raster, output_tif
      )
      result$pred_time <- as.numeric(Sys.time() - pred_time_start)
      result$pred_ok <- TRUE
      cat("  Predict time:", sprintf("%.1f", result$pred_time), "s\n")

      # Validate output rasters
      species_tifs <- attr(pred_result, "species_tifs") %||% character()
      richness_tif <- attr(pred_result, "richness_tif") %||% NA_character_

      if (length(species_tifs) == n_sp && all(file.exists(species_tifs))) {
        result$raster_ok <- TRUE

        # Check value ranges
        all_in_range <- TRUE
        range_str <- ""
        for (stif in species_tifs) {
          sr <- terra::rast(stif)
          sv <- terra::values(sr)
          sv <- sv[!is.na(sv)]
          if (length(sv) > 0) {
            if (any(sv < 0 | sv > 1)) { all_in_range <- FALSE; break }
            range_str <- paste0("[", sprintf("%.3f", min(sv)), ", ", sprintf("%.3f", max(sv)), "]")
          }
        }
        result$cell_range <- range_str

        # Check richness
        if (!is.na(richness_tif) && file.exists(richness_tif)) {
          rich <- terra::rast(richness_tif)
          rich_vals <- terra::values(rich)
          rich_vals <- rich_vals[!is.na(rich_vals)]
          if (length(rich_vals) > 0) {
            if (all(rich_vals >= 0) && all(rich_vals <= n_sp)) {
              # Verify richness = sum of species rasters
              species_stack <- terra::rast(species_tifs)
              computed_rich <- sum(species_stack, na.rm = TRUE)
              computed_vals <- terra::values(computed_rich)
              max_diff <- max(abs(rich_vals - computed_vals[!is.na(rich_vals)]), na.rm = TRUE)
              if (max_diff < 0.001) result$richness_ok <- TRUE
            }
          }
        }
      }

      # Memory report
      if (is_gpu) {
        mem <- report_mem()
        if (is.list(mem)) result$mem_mb <- mem$allocated_mb
      }

      # Cleanup combo outputs
      unlink(c(output_tif, species_tifs, richness_tif), force = TRUE)
      gc(full = TRUE)

      result

    }, error = function(e) {
      result$errors <- c(result$errors, conditionMessage(e))
      cat("  ERROR:", conditionMessage(e), "\n")
      result
    })

    results[[idx]] <- result

    # Print combo summary
    r <- results[[idx]]
    cat("  -> ")
    if (r$fit_ok && r$pred_ok) cat("PASS")
    else cat("FAIL")
    cat(sprintf(" | AUC: %.3f", r$auc_mean %||% NA_real_))
    cat(sprintf(" | Fit: %.0fs", r$fit_time %||% NA_real_))
    cat(sprintf(" | Pred: %.0fs", r$pred_time %||% NA_real_))
    if (length(r$errors) > 0)
      cat(" | Errors:", paste(r$errors, collapse = "; "))
    cat("\n")
  }

  # ---------------------------------------------------------------------------
  # 5. GPU-only raw prediction benchmark
  # ---------------------------------------------------------------------------
  gpu_raw_results <- list()
  if (has_cuda) {
    cat("\n", strrep("=", 60), "\n", sep = "")
    cat("GPU raw prediction benchmark (MC Dropout timing per species)\n")
    cat(strrep("=", 60), "\n", sep = "")

    gpu_raw_results <- tryCatch({
      combos_gpu_raw <- list(
        list(n_species = 3L,  arch = "DNN_Medium"),
        list(n_species = 3L,  arch = "DNN_Large")
      )
      raw_results <- list()
      for (rc in seq_along(combos_gpu_raw)) {
        rcombo <- combos_gpu_raw[[rc]]
        rlabel <- sprintf("raw_%dsp_%s_GPU", rcombo$n_species, rcombo$arch)
        cat("  [GPU-raw", rc, "/", length(combos_gpu_raw), "]", rlabel, "\n")

        # Build a model with the same architecture
        niches <- generate_niches(rcombo$n_species, 6L, seed = 99L)
        sp_names <- paste0("Sp_", LETTERS[seq_len(rcombo$n_species)])
        all_occ <- do.call(rbind, lapply(seq_len(rcombo$n_species), function(s) {
          occ_df <- sample_occurrences(
            env_raster, env_vals, complete_cells,
            center = niches$centers[s, ],
            sigma = niches$sigma[s],
            n_points = 10000L,
            seed = 99L * 100L + s * 7L
          )
          occ_df$species <- sp_names[s]
          occ_df
        }))

        torch::cuda_synchronize(); gc(full = TRUE)

        t0 <- Sys.time()
        cm <- build_community_matrix(all_occ, env_raster, background_n = 3000L, seed = 42L)
        fit_gpu <- fit_dnn_multispecies_sdm(
          occ = all_occ,
          env_train_scaled = env_raster,
          background_n = 3000L,
          cv_folds = 0L,
          seed = 99L,
          n_cores = 1L,
          dnn_architecture = rcombo$arch,
          dnn_device = "cuda",
          n_seeds = 1L,
          use_fused_adam = "off",
          dnn_mixed_precision = "off",
          dnn_mixed_precision = "off",
          dnn_cuda_graphs = "off"
        )
        fit_t <- as.numeric(Sys.time() - t0)
        cat("    Fit:", sprintf("%.0f", fit_t), "s,",
            "AUC:", sprintf("%.4f", fit_gpu$cv$auc_mean %||% NA_real_), "\n")

        # MC Dropout inference timing per species
        if (is.list(fit_gpu$model)) {
          env_df <- as.data.frame(terra::values(env_raster))
          names(env_df) <- names(env_raster)
          complete_idx <- which(stats::complete.cases(env_df))
          x_pred <- as.matrix(env_df[complete_idx, , drop = FALSE])
          scaler <- fit_gpu$scaler
          x_scaled <- sweep(x_pred, 2, scaler$mean, "-")
          x_scaled <- sweep(x_scaled, 2, scaler$sd, "/")
          pred_df <- as.data.frame(x_scaled)
          names(pred_df) <- names(env_raster)
          torch_tensor_for_device <- function(x, dev) {
            torch::torch_tensor(as.matrix(x), device = dev, dtype = torch::torch_float32())
          }

          # Try MC Dropout: set train mode, run T=30, time it
          fit_gpu$model$net$train()
          x_t <- torch::torch_tensor(as.matrix(x_scaled), device = "cuda", dtype = torch::torch_float32())

          # Warmup
          for (w in 1:3) {
            p <- stats::predict(fit_gpu$model, newdata = pred_df, type = "response")
          }
          torch::cuda_synchronize()

          mc_times <- numeric(3)
          for (rep in 1:3) {
            gc(full = TRUE)
            torch::cuda_synchronize()
            t0 <- Sys.time()
            for (mc in 1:30) {
              fit_gpu$model$net$train()
              p <- stats::predict(fit_gpu$model, newdata = pred_df, type = "response")
            }
            torch::cuda_synchronize()
            mc_times[rep] <- as.numeric(Sys.time() - t0) / 30
          }
          fit_gpu$model$net$eval()

          mc_time_mean <- mean(mc_times)
          cat("    MC Dropout (T=30):", sprintf("%.4f", mc_time_mean), "s/sample,",
              sprintf("%.1f", mc_time_mean * rcombo$n_species * 30), "s total for all species\n")

          mem <- report_mem()
          if (is.list(mem)) {
            cat("    Peak GPU memory:", mem$peak_allocated_mb %||% mem$allocated_mb, "MiB\n")
          }

          raw_results[[rc]] <- list(
            label = rlabel,
            n_species = rcombo$n_species,
            arch = rcombo$arch,
            fit_time = fit_t,
            auc = fit_gpu$cv$auc_mean %||% NA_real_,
            mc_sample_time = mc_time_mean,
            mem_mb = mem$peak_allocated_mb %||% mem$allocated_mb %||% NA_real_
          )
        }
      }
      raw_results
    }, error = function(e) {
      cat("  GPU raw benchmark error:", conditionMessage(e), "\n")
      list()
    })

    # Cleanup GPU
    if (has_cuda) {
      gc(full = TRUE)
      torch::cuda_synchronize()
      torch::cuda_empty_cache()
    }
  }

  # ---------------------------------------------------------------------------
  # 6. Summary
  # ---------------------------------------------------------------------------
  cat("\n\n", strrep("=", 80), "\n", sep = "")
  cat("STRESS TEST SUMMARY\n")
  cat(strrep("=", 80), "\n", sep = "")

  cat(sprintf("\n%-7s %-5s %-8s %-6s %-6s %-6s %-6s %-8s %-8s %s\n",
    "Label", "Sp", "Arch", "Seeds", "Fit", "AUC", "Pred", "Raster", "Rich", "Notes"))
  cat(strrep("-", 80), "\n", sep = "")

  n_pass <- 0; n_fail <- 0; n_skip <- 0
  for (r in results) {
    # PASS if fit + prediction + raster writing + richness all succeeded
    # AUC is informational (may not be computed depending on pROC availability)
    pipeline_ok <- r$fit_ok && r$pred_ok && r$raster_ok
    passed <- isTRUE(pipeline_ok)
    if (passed) n_pass <- n_pass + 1 else n_fail <- n_fail + 1

    notes <- if (length(r$errors) > 0) {
      paste(r$errors[1], if (length(r$errors) > 1) paste0("(+", length(r$errors) - 1, " more)") else "")
    } else if (!passed) "check" else ""

    cat(sprintf("%-7s %-5d %-8s %-6d %-6s %-6s %-6s %-8s %-8s %s\n",
      r$label,
      r$n_species,
      r$arch,
      r$seeds,
      if (r$fit_ok) sprintf("%.0fs", r$fit_time) else "FAIL",
      if (isTRUE(r$auc_mean > 0)) sprintf("%.3f", r$auc_mean) else "-",
      if (r$pred_ok) sprintf("%.0fs", r$pred_time) else "FAIL",
      if (r$raster_ok) "OK" else if (r$pred_ok) "CHECK" else "-",
      if (r$richness_ok) "OK" else if (r$raster_ok) "CHECK" else "-",
      notes
    ))
  }

  # GPU raw summary
  if (length(gpu_raw_results) > 0) {
    cat("\n-- GPU Raw Prediction Benchmarks --\n")
    for (gr in gpu_raw_results) {
      cat(sprintf("  %s: Fit %.0fs AUC %.4f MC %.4fs/sample Mem %s MiB\n",
        gr$label, gr$fit_time, gr$auc, gr$mc_sample_time,
        if (is.na(gr$mem_mb)) "?" else as.character(gr$mem_mb)))
    }
  }

  cat(strrep("=", 80), "\n", sep = "")
  cat(sprintf("PASS: %d / %d\n", n_pass, length(results)))
  cat(sprintf("FAIL: %d / %d\n", n_fail, length(results)))

  # Cleanup terra temp
  unlink(local_tmp, recursive = TRUE, force = TRUE)

  invisible(list(pass = n_pass, fail = n_fail, total = length(results), results = results))
}

stress_main()
