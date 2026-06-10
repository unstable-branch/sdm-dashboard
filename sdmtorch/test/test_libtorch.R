# Test C++ fused adam step
library(torch)
so <- file.path(getwd(), "sdmtorch", "train_step_libtorch.so")
dyn.load(so)
model <- nn_linear(10, 5)
params <- model$parameters
x <- torch_randn(32, 10, requires_grad = TRUE)
y <- torch_randn(32, 5)
out <- model(x)
loss <- nnf_mse_loss(out, y)
loss$backward()
ea <- lapply(params, function(p) torch_zeros_like(p))
eas <- lapply(params, function(p) torch_zeros_like(p))
ss <- lapply(params, function(p) torch_tensor(0L, dtype = torch_int64()))
for (j in seq_along(ss)) ss[[j]]$add_(1L)
.Call("fused_adam_step_direct",
  params, lapply(params, function(p) p$grad),
  ea, eas, ss, 0.01, 0.9, 0.999, 0.001, 1e-8)
cat("OK, param1 sum:", as.numeric(params[[1]]$sum()), "\n")
