# Benchmark: GPU utilization with fused Adam (libtorch direct vs R-level)
library(torch)

so <- file.path(getwd(), "sdmtorch", "train_step_libtorch.so")
if (file.exists(so)) dyn.load(so)

fa <- get("torch__fused_adam_", envir = asNamespace("torch"))

device <- if (cuda_is_available()) "cuda" else "cpu"
cat("Device:", device, "\n")

# Test model: nn_linear with 19 inputs, 4 outputs (matching DNN_Small)
model <- nn_linear(19, 4)$to(device = device)
params <- model$parameters

# Benchmark individual fused_adam_step calls
cat("\nBenchmark: single fused_adam_step\n")

# Warmup
for (i in 1:5) {
  x <- torch_randn(512, 19, requires_grad = TRUE, device = device)
  y <- torch_randn(512, 4, device = device)
  out <- model(x)
  loss <- nnf_mse_loss(out, y)
  loss$backward()
  if (device == "cuda") torch::cuda_synchronize()
  
  ea <- lapply(params, function(p) torch_zeros_like(p))
  eas <- lapply(params, function(p) torch_zeros_like(p))
  ss <- lapply(params, function(p) torch_tensor(0L, dtype = torch_int64(), device = device))
  for (j in seq_along(ss)) ss[[j]]$add_(1L)
  
  # R-level fused_adam
  lr_t <- torch_tensor(0.01, device = device)
  fa(params, lapply(params, function(p) p$grad),
     ea, eas, list(), ss, lr_t, 0.9, 0.999, 0.001, 1e-8, FALSE, FALSE)
  if (device == "cuda") torch::cuda_synchronize()
}

# Benchmark: R-level
n_iter <- 100
x <- torch_randn(512, 19, requires_grad = TRUE, device = device)
y <- torch_randn(512, 4, device = device)

times_r <- numeric(n_iter)
for (i in 1:n_iter) {
  out <- model(x)
  loss <- nnf_mse_loss(out, y)
  loss$backward()
  if (device == "cuda") torch::cuda_synchronize()
  
  ea <- lapply(params, function(p) torch_zeros_like(p))
  eas <- lapply(params, function(p) torch_zeros_like(p))
  ss <- lapply(params, function(p) torch_tensor(0L, dtype = torch_int64(), device = device))
  for (j in seq_along(ss)) ss[[j]]$add_(1L)
  
  t0 <- Sys.time()
  lr_t <- torch_tensor(0.01, device = device)
  fa(params, lapply(params, function(p) p$grad),
     ea, eas, list(), ss, lr_t, 0.9, 0.999, 0.001, 1e-8, FALSE, FALSE)
  if (device == "cuda") torch::cuda_synchronize()
  times_r[i] <- as.numeric(Sys.time() - t0)
}
cat("R-level torch__fused_adam_:\n")
cat("  mean:", sprintf("%.1f", mean(times_r) * 1000), "ms\n")
cat("  median:", sprintf("%.1f", median(times_r) * 1000), "ms\n")

# Benchmark: C++ direct (if .so loaded)
if (is.loaded("fused_adam_step_direct")) {
  times_cpp <- numeric(n_iter)
  for (i in 1:n_iter) {
    out <- model(x)
    loss <- nnf_mse_loss(out, y)
    loss$backward()
    if (device == "cuda") torch::cuda_synchronize()
    
    ea <- lapply(params, function(p) torch_zeros_like(p))
    eas <- lapply(params, function(p) torch_zeros_like(p))
    ss <- lapply(params, function(p) torch_tensor(0L, dtype = torch_int64(), device = device))
    for (j in seq_along(ss)) ss[[j]]$add_(1L)
    
    t0 <- Sys.time()
    .Call("fused_adam_step_direct",
          params, lapply(params, function(p) p$grad),
          ea, eas, ss, 0.01, 0.9, 0.999, 0.001, 1e-8,
          if (device == "cuda") 0L else -1L)
    if (device == "cuda") torch::cuda_synchronize()
    times_cpp[i] <- as.numeric(Sys.time() - t0)
  }
  cat("\nC++ direct fused_adam_step_direct:\n")
  cat("  mean:", sprintf("%.1f", mean(times_cpp) * 1000), "ms\n")
  cat("  median:", sprintf("%.1f", median(times_cpp) * 1000), "ms\n")
  
  speedup <- mean(times_r) / mean(times_cpp)
  cat(sprintf("\nSpeedup: %.2fx\n", speedup))
}

cat("\nDone.\n")
