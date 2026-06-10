# Rapid test: custom Adam step via ATen ops (CPU + GPU)
library(torch)
so <- file.path(getwd(), "sdmtorch", "train_step_adam.so")
if (!file.exists(so)) stop("Build first: make -C sdmtorch adam")
dyn.load(so)

cat("=== CPU test ===\n")
torch_manual_seed(42)
model <- nn_linear(19, 4)
params <- model$parameters
x <- torch_randn(512, 19, requires_grad = TRUE)
y <- torch_randn(512, 4)
out <- model(x); loss <- nnf_mse_loss(out, y); loss$backward()
ea <- lapply(params, function(p) torch_zeros_like(p))
eas <- lapply(params, function(p) torch_zeros_like(p))
ss <- lapply(params, function(p) torch_tensor(0L, dtype = torch_int64()))
for (j in seq_along(ss)) ss[[j]]$add_(1L)
.Call("adam_step_direct", params, lapply(params, function(p) p$grad),
  ea, eas, ss, 0.01, 0.9, 0.999, 0.001, 1e-8)
cpu_sum <- as.numeric(params[[1]]$sum())
cat("CPU param sum:", cpu_sum, "\n")

# Compare with standard Adam
torch_manual_seed(42)
model2 <- nn_linear(19, 4)
params2 <- model2$parameters
x2 <- torch_randn(512, 19, requires_grad = TRUE)
y2 <- torch_randn(512, 4)
out2 <- model2(x2); loss2 <- nnf_mse_loss(out2, y2); loss2$backward()
opt <- optim_adam(params2, lr = 0.01, weight_decay = 0.001)
opt$step()
cpu_std_sum <- as.numeric(params2[[1]]$sum())
cat("CPU std Adam sum:", cpu_std_sum, "\n")
cat("CPU diff:", abs(cpu_sum - cpu_std_sum), "\n")

if (cuda_is_available()) {
  cat("\n=== GPU test ===\n")
  torch_manual_seed(42)
  model3 <- nn_linear(19, 4)$to(device = "cuda")
  params3 <- model3$parameters
  x3 <- torch_randn(512, 19, requires_grad = TRUE, device = "cuda")
  y3 <- torch_randn(512, 4, device = "cuda")
  out3 <- model3(x3); loss3 <- nnf_mse_loss(out3, y3); loss3$backward()
  ea3 <- lapply(params3, function(p) torch_zeros_like(p))
  eas3 <- lapply(params3, function(p) torch_zeros_like(p))
  ss3 <- lapply(params3, function(p) torch_tensor(0L, dtype = torch_int64(), device = "cuda"))
  for (j in seq_along(ss3)) ss3[[j]]$add_(1L)
  .Call("adam_step_direct", params3, lapply(params3, function(p) p$grad),
    ea3, eas3, ss3, 0.01, 0.9, 0.999, 0.001, 1e-8)
  gpu_sum <- as.numeric(params3[[1]]$cpu()$sum())
  cat("GPU param sum:", gpu_sum, "\n")
  cat("GPU NaN:", is.nan(gpu_sum), "\n")
  
  if (!is.nan(gpu_sum)) {
    cat("✓ GPU Adam step works (no NaN!)\n")
    cat("CPU/GPU diff:", abs(cpu_sum - gpu_sum), "\n")
  } else {
    cat("✗ GPU Adam step is NaN\n")
  }
}
