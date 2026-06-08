#!/usr/bin/env Rscript
# Plumber container entrypoint — ensures CUDA libtorch is installed before starting.
# Docker builds don't have GPU access, so CUDA-enabled libtorch must be installed
# at runtime when GPUs are available.

`%||%` <- function(a, b) if (!is.null(a)) a else b

# Export CUDA library paths so torch can find libcudart and libnvrtc
Sys.setenv(
  PATH = paste("/usr/local/cuda-12.6/bin", Sys.getenv("PATH"), sep = ":"),
  TORCH_HOME = "/app/outputs/.torch",
  CUDA_HOME = "/usr/local/cuda-12.6",
  CUDA_PATH = "/usr/local/cuda-12.6",
  LD_LIBRARY_PATH = paste(
    "/usr/local/cuda-12.6/lib64",
    "/usr/lib/x86_64-linux-gnu",
    Sys.getenv("LD_LIBRARY_PATH"),
    sep = ":"
  )
)
dir.create("/app/outputs/.torch", recursive = TRUE, showWarnings = FALSE)

cat("=== Plumber entrypoint ===\n")
cat("Setting up CUDA environment...\n")

# Check if CUDA toolkit is available (nvcc installed from Dockerfile)
has_nvcc <- nzchar(Sys.which("nvcc"))
cat("CUDA toolkit (nvcc):", has_nvcc, "\n")
if (has_nvcc) {
  cat("CUDA version:", system("nvcc --version | grep release | sed 's/.*release //;s/,.*//'", intern = TRUE), "\n")
}

# Install CUDA-enabled libtorch if not already cached
torch_home <- Sys.getenv("TORCH_HOME", "/app/outputs/.torch")
libtorch_cached <- file.exists(file.path(torch_home, "libtorch"))
cat("libtorch cached:", libtorch_cached, "\n")

if (has_nvcc && !libtorch_cached && requireNamespace("torch", quietly = TRUE)) {
  cat("CUDA toolkit detected but no CUDA libtorch cached.\n")
  cat("Downloading CUDA-enabled libtorch (~2.8 GB) and rebuilding lantern from source.\n")
  cat("This happens once — subsequent starts will be fast.\n\n")
  tryCatch({
    torch::install_torch(reinstall = TRUE, rebuild = TRUE)
    cat("libtorch installation complete.\n")
    cat("CUDA:", tryCatch(torch::cuda_is_available(), error = function(e) "check_error"), "\n")
  }, error = function(e) {
    cat("libtorch install failed:", conditionMessage(e), "\n")
    cat("Falling back to CPU mode. DNN will still work, just slower.\n")
  })
} else {
  cat("GPU acceleration:", has_nvcc && libtorch_cached, "\n")
  if (has_nvcc && !libtorch_cached) cat("(torch R package not available — install skipped)\n")
}

cat("Starting Plumber server...\n")
source("/app/plumber/R/run_server.R")
