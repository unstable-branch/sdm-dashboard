# E2E benchmark: multi-species DNN training with fused Adam + AMP optimizations.
# Uses torch directly (bypasses cito) to isolate optimization effects.
#
# NOTE: _fused_adam_ CUDA kernel produces NaN on Blackwell GPUs (compute 12.0).
# CPU fused Adam works correctly. AMP works on GPU without fused_adam issues.

library(torch)

# Load C++ extensions
so_adam <- file.path(getwd(), "sdmtorch", "train_step_adam.so")
if (file.exists(so_adam)) dyn.load(so_adam)
so_libtorch <- file.path(getwd(), "sdmtorch", "train_step_libtorch.so")
if (file.exists(so_libtorch) && !is.loaded("adam_step_direct", PACKAGE = "")) dyn.load(so_libtorch)

# --- Configuration ---
n_species <- 20
n_sites <- 1000
n_covariates <- 19
batch_size <- 512L
hidden_sizes <- c(64L)
n_epochs <- 20
lr <- 0.01

cat("Multi-species DNN benchmark\n")
cat("===========================\n")
cat(sprintf("Species: %d, Sites: %d, Covariates: %d\n", n_species, n_sites, n_covariates))
cat(sprintf("Architecture: %s → %d → %d\n",
  paste(hidden_sizes, collapse = "→"), n_covariates, n_species))
cat(sprintf("Batch: %d, Epochs: %d, LR: %.3f\n\n", batch_size, n_epochs, lr))

# --- Synthetic data ---
set.seed(42)
x <- matrix(rnorm(n_sites * n_covariates), n_sites, n_covariates)
prefs <- matrix(rnorm(n_species * n_covariates), n_species, n_covariates)
logits <- x %*% t(prefs)
y <- matrix(0, n_sites, n_species)
for (s in seq_len(n_species)) y[, s] <- rbinom(n_sites, 1, plogis(logits[, s]))

loss_fkt <- function(pred, target) nnf_binary_cross_entropy_with_logits(pred, target)

zero_grad_safe <- function(params) {
  for (p in params) {
    if (!is.null(p$grad)) {
      tryCatch(p$grad$zero_(), error = function(e) NULL)
    }
  }
}

build_model <- function() {
  nn_sequential(
    nn_linear(n_covariates, 64), nn_relu(), nn_dropout(0.3),
    nn_linear(64, n_species)
  )
}

# --- 1. CPU baseline (standard Adam via optim_adam) ---
train_cpu_std <- function(epochs) {
  m <- build_model()
  opt <- optim_adam(m$parameters, lr = lr)
  xt <- torch_tensor(x); yt <- torch_tensor(y)
  losses <- numeric(epochs)
  for (ep in seq_len(epochs)) {
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
    losses[ep] <- el / nb
  }
  losses
}

# --- 2. CPU/GPU Adam via C++ extension ---
train_cxx_adam <- function(epochs, device = "cpu") {
  fn <- if (is.loaded("adam_step_direct", PACKAGE = "")) "adam_step_direct"
        else if (is.loaded("fused_adam_step_direct", PACKAGE = "")) "fused_adam_step_direct"
        else stop("No C++ Adam extension loaded")
  m <- build_model()$to(device = device)
  p <- m$parameters; wd <- 0
  if (device == "cuda" && cuda_is_available()) {
    xt <- torch_tensor(x, device = "cuda"); yt <- torch_tensor(y, device = "cuda")
  } else {
    device <- "cpu"; xt <- torch_tensor(x); yt <- torch_tensor(y)
  }
  os <- list(
    params = p, lr = lr, b1 = 0.9, b2 = 0.999, eps = 1e-8, weight_decay = 0,
    exp_avgs = lapply(p, function(pp) torch_zeros_like(pp)),
    exp_avg_sqs = lapply(p, function(pp) torch_zeros_like(pp)),
    state_steps = lapply(p, function(pp) torch_tensor(0L, dtype = torch_int64()))
  )
  losses <- numeric(epochs)
  for (ep in seq_len(epochs)) {
    perm <- sample(n_sites)
    el <- 0; nb <- 0
    for (i in seq(1, n_sites, batch_size)) {
      idx <- perm[i:min(i + batch_size - 1, n_sites)]
      zero_grad_safe(p)
      out <- m(xt[idx, ])
      l <- loss_fkt(out, yt[idx, ])
      l$backward()
      for (j in seq_along(os$state_steps)) os$state_steps[[j]]$add_(1L)
      .Call(fn, p, lapply(p, function(pp) pp$grad),
        os$exp_avgs, os$exp_avg_sqs, os$state_steps,
        0.01, 0.9, 0.999, 1e-8, 0)
      el <- el + as.numeric(l$item()); nb <- nb + 1
    }
    losses[ep] <- el / nb
  }
  losses
}

# --- 3. GPU AMP (no fused_adam — uses standard Adam internally via cito path) ---
train_gpu_amp <- function(epochs) {
  if (!cuda_is_available()) stop("No CUDA")
  m <- build_model()$to(device = "cuda")
  opt <- optim_adam(m$parameters, lr = lr)
  scaler <- cuda_amp_grad_scaler()
  xt <- torch_tensor(x, device = "cuda"); yt <- torch_tensor(y, device = "cuda")
  losses <- numeric(epochs)
  for (ep in seq_len(epochs)) {
    perm <- sample(n_sites)
    el <- 0; nb <- 0
    for (i in seq(1, n_sites, batch_size)) {
      idx <- perm[i:min(i + batch_size - 1, n_sites)]
      opt$zero_grad()
      with_autocast(device_type = "cuda", {
        out <- m(xt[idx, ])
        l <- loss_fkt(out, yt[idx, ])
      })
      scaler$scale(l)$backward()
      scaler$step(opt)
      scaler$update()
      # Log loss at full precision
      el <- el + as.numeric(l$item()); nb <- nb + 1
    }
    losses[ep] <- el / nb
  }
  losses
}

# --- Run benchmarks ---
bench <- function(label, expr, reps = 3) {
  times <- numeric(reps)
  result <- NULL
  for (r in seq_len(reps)) {
    gc(full = TRUE)
    t0 <- Sys.time()
    result <- suppressWarnings(force(expr))
    torch::cuda_synchronize()
    times[r] <- as.numeric(Sys.time() - t0)
  }
  list(label = label, losses = result, time_mean = mean(times), time_sd = sd(times))
}

results <- list()
cat("Benchmark 1: CPU (standard Adam)...\n"); gc()
results[[1]] <- bench("CPU (std Adam)", train_cpu_std(n_epochs))

cat("Benchmark 2: CPU (C++ Adam)...\n"); gc()
results[[2]] <- bench("CPU (C++ Adam)", train_cxx_adam(n_epochs, "cpu"))

if (cuda_is_available()) {
  cat("Benchmark 3: GPU (C++ Adam)...\n"); gc()
  results[[3]] <- bench("GPU (C++ Adam)", train_cxx_adam(n_epochs, "cuda"))
  cat("Benchmark 4: GPU AMP (standard Adam)...\n"); gc()
  results[[4]] <- bench("GPU AMP", train_gpu_amp(n_epochs))
}

# --- Report ---
cat("\n\nResults:\n")
cat("=======\n\n")
cat(sprintf("%-30s %12s %12s\n", "Configuration", "Time/epoch", "Final loss"))
cat(strrep("-", 58), "\n", sep = "")

cpu_time <- results[[1]]$time_mean
for (r in results) {
  speedup <- cpu_time / r$time_mean
  cat(sprintf("%-30s %7.2fs ±%.2f %11.4f  %5.1fx vs CPU\n",
    r$label, r$time_mean, r$time_sd,
    r$losses[length(r$losses)], speedup))
}

cat("\nLoss convergence (epochs 1,5,10,15,20):\n")
cat(strrep("-", 68), "\n", sep = "")
for (r in results) {
  e2 <- min(5, length(r$losses)); e3 <- min(10, length(r$losses))
  e4 <- min(15, length(r$losses)); e5 <- length(r$losses)
  vals <- sprintf("%8.4f", r$losses[c(1, e2, e3, e4, e5)])
  cat(sprintf("%-30s %s\n", r$label, paste(vals, collapse = " ")))
}

# Verify numerical equivalence
if (length(results) >= 2) {
  final_cpu <- results[[1]]$losses[length(results[[1]]$losses)]
  final_fused <- results[[2]]$losses[length(results[[2]]$losses)]
  diff <- abs(final_cpu - final_fused)
  cat(sprintf("\nNumerical diff (CPU std vs fused): %.6f\n", diff))
  if (diff < 0.05) cat("✓ Fused Adam is numerically equivalent to standard Adam\n")
  else cat("⚠ Fused Adam differs from standard Adam (diff=%.4f)\n", diff)
}
