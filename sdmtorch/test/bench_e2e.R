# E2E benchmark: multi-species DNN across architectures (Small + Large).
# Tests C++ Adam kernel on CPU/GPU, GPU AMP, CUDA Graphs, MC Dropout, gradient accumulation.
# Benchmarks training throughput and inference.

library(torch)

# Load C++ extensions
so_adam <- file.path(getwd(), "sdmtorch", "train_step_adam.so")
so_cuda_graph <- file.path(getwd(), "sdmtorch", "cuda_graph.so")
if (file.exists(so_adam)) dyn.load(so_adam)
has_cuda_graphs <- FALSE
if (file.exists(so_cuda_graph) && cuda_is_available()) {
  tryCatch({ dyn.load(so_cuda_graph); has_cuda_graphs <- is.loaded("cuda_graph_begin", PACKAGE = "") }, error = function(e) NULL)
}

ARCHS <- list(
  Small = list(hidden = c(64L),          lr = 0.01, epochs = 20L, dropout = 0.4, lambda = 0.01),
  Large = list(hidden = c(200L, 200L, 100L), lr = 0.05, epochs = 30L, dropout = 0.2, lambda = 0.0005)
)

run_benchmark <- function(label, expr, reps = 3) {
  times <- numeric(reps)
  result <- NULL
  for (r in seq_len(reps)) {
    gc(full = TRUE)
    if (cuda_is_available()) cuda_synchronize()
    t0 <- Sys.time()
    result <- suppressWarnings(force(expr))
    if (cuda_is_available()) cuda_synchronize()
    times[r] <- as.numeric(Sys.time() - t0)
  }
  list(label = label, losses = result, time_mean = mean(times), time_sd = sd(times))
}

report_mem <- function() {
  if (!cuda_is_available()) return(NA_integer_)
  tryCatch({
    stats <- cuda_memory_stats()
    allocated <- stats$allocated_bytes$all$current %/% (1024L * 1024L)
    reserved <- stats$reserved_bytes$all$current %/% (1024L * 1024L)
    list(allocated_mb = allocated, reserved_mb = reserved)
  }, error = function(e) NA_integer_)
}

zero_grad_safe <- function(params) {
  for (p in params) {
    if (!is.null(p$grad)) tryCatch(p$grad$zero_(), error = function(e) NULL)
  }
}

run_architecture <- function(name, arch) {
  cat("\n", strrep("=", 70), "\n", sep = "")
  cat("Architecture:", name, "\n")
  cat(strrep("=", 70), "\n", sep = "")

  n_species <- 20; n_sites <- 1000; n_covariates <- 19
  batch_size <- 512L
  hidden <- arch$hidden; lr <- arch$lr; epochs <- arch$epochs
  dropout <- arch$dropout; lambda <- arch$lambda

  cat(sprintf("  Hidden: %s, LR: %.3f, Epochs: %d, Dropout: %.1f, Lambda: %.4f\n",
    paste(hidden, collapse = "→"), lr, epochs, dropout, lambda))

  # Synthetic data
  set.seed(42)
  x <- matrix(rnorm(n_sites * n_covariates), n_sites, n_covariates)
  prefs <- matrix(rnorm(n_species * n_covariates), n_species, n_covariates)
  logits <- x %*% t(prefs)
  y <- matrix(0, n_sites, n_species)
  for (s in seq_len(n_species)) y[, s] <- rbinom(n_sites, 1, plogis(logits[, s]))
  xt <- torch_tensor(x); yt <- torch_tensor(y)

  build_model <- function(dev = "cpu") {
    layers <- list()
    in_features <- n_covariates
    for (h in hidden) {
      layers <- c(layers, nn_linear(in_features, h), nn_relu(), nn_dropout(dropout))
      in_features <- h
    }
    layers <- c(layers, nn_linear(in_features, n_species))
    nn_sequential(!!!layers)$to(device = dev)
  }

  loss_fkt <- function(pred, target) nnf_binary_cross_entropy_with_logits(pred, target)

  # --- 1. CPU baseline ---
  train_cpu_std <- function(ep) {
    m <- build_model("cpu")
    opt <- optim_adam(m$parameters, lr = lr, weight_decay = lambda)
    losses <- numeric(ep)
    for (epoch in seq_len(ep)) {
      perm <- sample(n_sites)
      el <- 0; nb <- 0
      for (i in seq(1, n_sites, batch_size)) {
        idx <- perm[i:min(i + batch_size - 1, n_sites)]
        opt$zero_grad()
        out <- m(xt[idx, ])
        l <- loss_fkt(out, yt[idx, ])
        l$backward()
        opt$step()
        el <- el + as.numeric(l$item()); nb <- nb + 1
      }
      losses[epoch] <- el / nb
    }
    losses
  }

  # --- 2. C++ Adam ---
  train_cxx_adam <- function(ep, device = "cpu") {
    fn <- if (is.loaded("adam_step_direct", PACKAGE = "")) "adam_step_direct"
          else stop("No C++ Adam extension loaded")
    m <- build_model(device)
    p <- m$parameters
    if (device == "cuda" && cuda_is_available()) {
      xd <- torch_tensor(x, device = "cuda"); yd <- torch_tensor(y, device = "cuda")
    } else {
      device <- "cpu"; xd <- xt; yd <- yt
    }
    os <- list(
      params = p, lr = lr, b1 = 0.9, b2 = 0.999, eps = 1e-8, weight_decay = lambda,
      exp_avgs = lapply(p, function(pp) torch_zeros_like(pp)),
      exp_avg_sqs = lapply(p, function(pp) torch_zeros_like(pp)),
      state_steps = lapply(p, function(pp) torch_tensor(0L, dtype = torch_int64()))
    )
    losses <- numeric(ep)
    for (epoch in seq_len(ep)) {
      perm <- sample(n_sites)
      el <- 0; nb <- 0
      for (i in seq(1, n_sites, batch_size)) {
        idx <- perm[i:min(i + batch_size - 1, n_sites)]
        zero_grad_safe(p)
        out <- m(xd[idx, ])
        l <- loss_fkt(out, yd[idx, ])
        l$backward()
        for (j in seq_along(os$state_steps)) os$state_steps[[j]]$add_(1L)
        .Call(fn, p, lapply(p, function(pp) pp$grad),
          os$exp_avgs, os$exp_avg_sqs, os$state_steps,
          lr, 0.9, 0.999, 1e-8, lambda)
        el <- el + as.numeric(l$item()); nb <- nb + 1
      }
      losses[epoch] <- el / nb
    }
    losses
  }

  # --- 3. GPU AMP ---
  train_gpu_amp <- function(ep) {
    if (!cuda_is_available()) stop("No CUDA")
    m <- build_model("cuda")
    opt <- optim_adam(m$parameters, lr = lr, weight_decay = lambda)
    scaler <- cuda_amp_grad_scaler()
    xd <- torch_tensor(x, device = "cuda"); yd <- torch_tensor(y, device = "cuda")
    losses <- numeric(ep)
    for (epoch in seq_len(ep)) {
      perm <- sample(n_sites)
      el <- 0; nb <- 0
      for (i in seq(1, n_sites, batch_size)) {
        idx <- perm[i:min(i + batch_size - 1, n_sites)]
        opt$zero_grad()
        with_autocast(device_type = "cuda", {
          out <- m(xd[idx, ])
          l <- loss_fkt(out, yd[idx, ])
        })
        scaler$scale(l)$backward()
        scaler$step(opt)
        scaler$update()
        el <- el + as.numeric(l$item()); nb <- nb + 1
      }
      losses[epoch] <- el / nb
    }
    losses
  }

  # Run
  results <- list()
  cat("  Benchmark 1: CPU (std Adam)...\n"); gc()
  results[[1]] <- run_benchmark("CPU (std Adam)", train_cpu_std(epochs))

  cat("  Benchmark 2: CPU (C++ Adam)...\n"); gc()
  results[[2]] <- run_benchmark("CPU (C++ Adam)", train_cxx_adam(epochs, "cpu"))

  if (cuda_is_available()) {
    cat("  Benchmark 3: GPU (C++ Adam)...\n"); gc()
    results[[3]] <- run_benchmark("GPU (C++ Adam)", train_cxx_adam(epochs, "cuda"))
    cat("  Benchmark 4: GPU AMP (std Adam)...\n"); gc()
    results[[4]] <- run_benchmark("GPU AMP", train_gpu_amp(epochs))
  }

  # Report
  cat("\n--- Results:", name, "---\n")
  cat(sprintf("%-25s %10s %10s\n", "Configuration", "Time/ep", "Final loss"))
  cat(strrep("-", 50), "\n", sep = "")
  cpu_time <- results[[1]]$time_mean
  for (r in results) {
    speedup <- cpu_time / r$time_mean
    cat(sprintf("%-25s %6.2fs ±%.2f %8.4f  %5.1fx\n",
      r$label, r$time_mean, r$time_sd,
      r$losses[length(r$losses)], speedup))
  }

  # Loss table
  epochs_shown <- unique(round(seq(1, epochs, length.out = 6)))
  cat("\nLoss convergence:\n")
  cat(sprintf("%-25s %s\n", "Config", paste(sprintf("Ep%2d", epochs_shown), collapse = " ")))
  cat(strrep("-", 70), "\n", sep = "")
  for (r in results) {
    idx <- epochs_shown[epochs_shown <= length(r$losses)]
    if (length(idx) < length(epochs_shown)) idx <- c(idx, length(r$losses))
    vals <- sprintf("%7.4f", r$losses[idx])
    cat(sprintf("%-25s %s\n", r$label, paste(vals, collapse = " ")))
  }

  # Numerical diff
  if (length(results) >= 2) {
    d <- abs(results[[1]]$losses[length(results[[1]]$losses)] -
             results[[2]]$losses[length(results[[2]]$losses)])
    cat(sprintf("\nCPU std vs C++ diff: %.6f %s\n", d,
      if (d < 0.05) "✓" else "⚠"))
  }

  # --- 5. MC Dropout inference timing (GPU) ---
  if (cuda_is_available()) {
    cat("  Benchmark 5: MC Dropout CPU (T=30)...\n"); gc()
    m_cpu <- build_model("cpu")
    xt_cpu <- xt
    t0 <- Sys.time()
    for (t in seq_len(30)) {
      m_cpu$train()
      out <- m_cpu(xt_cpu)
      l <- loss_fkt(out, yt)
    }
    mc_time <- as.numeric(Sys.time() - t0) / 30
    cat(sprintf("  MC Dropout CPU: %.4f s/sample, %.1f s total\n", mc_time, mc_time * 30))

    cat("  Benchmark 6: MC Dropout GPU (T=30, FP16)...\n"); gc()
    m_gpu <- build_model("cuda")
    xd <- torch_tensor(x, device = "cuda")
    yd <- torch_tensor(y, device = "cuda")
    t0 <- Sys.time()
    for (t in seq_len(30)) {
      m_gpu$train()
      with_autocast(device_type = "cuda", {
        out <- m_gpu(xd)
        l <- loss_fkt(out, yd)
      })
    }
    mc_gpu_time <- as.numeric(Sys.time() - t0) / 30
    cat(sprintf("  MC Dropout GPU (FP16): %.4f s/sample, %.1f s total (%.1fx vs CPU)\n",
      mc_gpu_time, mc_gpu_time * 30, mc_time / mc_gpu_time))
  }

  # --- 6. Gradient accumulation benchmark ---
  if (cuda_is_available() && is.loaded("adam_step_direct", PACKAGE = "")) {
    cat("  Benchmark 7: GPU C++ Adam (acc_steps=4)...\n"); gc()
    train_gpu_acc4 <- function(ep) {
      fn <- "adam_step_direct"
      m <- build_model("cuda"); p <- m$parameters
      xd <- torch_tensor(x, device = "cuda"); yd <- torch_tensor(y, device = "cuda")
      os <- list(params = p, lr = lr, b1 = 0.9, b2 = 0.999, eps = 1e-8, weight_decay = lambda,
        exp_avgs = lapply(p, function(pp) torch_zeros_like(pp)),
        exp_avg_sqs = lapply(p, function(pp) torch_zeros_like(pp)),
        state_steps = lapply(p, function(pp) torch_tensor(0L, dtype = torch_int64())))
      acc_steps <- 4L; losses <- numeric(ep)
      for (epoch in seq_len(ep)) {
        perm <- sample(n_sites); el <- 0; nb <- 0
        for (i in seq(1, n_sites, batch_size)) {
          idx <- perm[i:min(i + batch_size - 1, n_sites)]
          zero_grad_safe(p)
          out <- m(xd[idx, ]); l <- loss_fkt(out, yd[idx, ])
          (l / acc_steps)$backward()
          if (nb %% acc_steps == 0) {
            for (j in seq_along(os$state_steps)) os$state_steps[[j]]$add_(1L)
            .Call(fn, p, lapply(p, function(pp) pp$grad),
              os$exp_avgs, os$exp_avg_sqs, os$state_steps, lr, 0.9, 0.999, 1e-8, lambda)
          }
          el <- el + as.numeric(l$item()); nb <- nb + 1
        }
        losses[epoch] <- el / nb
      }
      losses
    }
    results[[length(results) + 1]] <- run_benchmark("GPU C++ Adam (acc=4)", train_gpu_acc4(epochs))
  }

  # --- 7. Memory snapshot ---
  if (cuda_is_available()) {
    gc(); cuda_synchronize()
    mem <- report_mem()
    if (is.list(mem)) cat(sprintf("\n  Peak GPU memory: %d MiB allocated, %d MiB reserved\n",
      mem$allocated_mb, mem$reserved_mb))
  }

  results
}

# Run both architectures
all_results <- list()
for (nm in names(ARCHS)) {
  all_results[[nm]] <- run_architecture(nm, ARCHS[[nm]])
}

cat("\n", strrep("=", 70), "\n", sep = "")
cat("All benchmarks complete.\n")
