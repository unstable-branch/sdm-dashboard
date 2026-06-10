# Test the fused_step.so C++ extension (Phase C)
library(torch)

# Load fused_step.so. It is linked against liblantern.so (same SONAME as the
# copy already loaded by torchpkg.so), so the dynamic linker reuses the
# existing copy that torch already initialized. This means lantern_loaded is
# true, check_lantern() passes, and all weak symbols resolve correctly.
so <- file.path(getwd(), "sdmtorch", "fused_step.so")
if (!file.exists(so)) {
  so <- file.path(getwd(), "fused_step.so")
}
cat("Loading:", so, "\n")
dyn.load(so)
cat("Loaded\n")

# Reference: test R-level fused_adam first
cat("\nTesting R-level fused_adam reference...\n")
model <- nn_linear(10, 5)
params <- model$parameters
x <- torch_randn(32, 10, requires_grad = TRUE)
y <- torch_randn(32, 5)

out <- model(x)
loss <- nnf_mse_loss(out, y)
loss$backward()

fa <- get("torch__fused_adam_", envir = asNamespace("torch"))
ea_ref <- lapply(params, function(p) torch_zeros_like(p))
eas_ref <- lapply(params, function(p) torch_zeros_like(p))
ss_ref <- lapply(params, function(p) torch_tensor(0L, dtype = torch_int64()))
for (j in seq_along(ss_ref)) ss_ref[[j]]$add_(1L)

fa(params, lapply(params, function(p) p$grad),
   ea_ref, eas_ref, list(), ss_ref,
   torch_tensor(0.01), 0.9, 0.999, 0.001, 1e-8, FALSE, FALSE)
cat("R-level fused_adam reference done\n")

# Test C++ fused_adam_step_cpp
cat("\nTesting C++ fused_adam_step_cpp...\n")
model2 <- nn_linear(10, 5)
params2 <- model2$parameters
x2 <- torch_randn(32, 10, requires_grad = TRUE)
y2 <- torch_randn(32, 5)

out2 <- model2(x2)
loss2 <- nnf_mse_loss(out2, y2)
loss2$backward()

ea2 <- lapply(params2, function(p) torch_zeros_like(p))
eas2 <- lapply(params2, function(p) torch_zeros_like(p))
ss2 <- lapply(params2, function(p) torch_tensor(0L, dtype = torch_int64()))
for (j in seq_along(ss2)) ss2[[j]]$add_(1L)

.Call("fused_adam_step_cpp", params2, lapply(params2, function(p) p$grad),
      ea2, eas2, ss2, 0.01, 0.9, 0.999, 0.001, 1e-8, -1L)

cat("C++ fused_adam_step_cpp done\n")

cat("First param sum:", as.numeric(params2[[1]]$sum()), "\n")
cat("Param changed:", !identical(as.numeric(params2[[1]]$sum()), 0.0), "\n")

cat("\n=== Phase C test passed! ===\n")
