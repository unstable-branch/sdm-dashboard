#!/usr/bin/env Rscript
# SDM Dashboard — DNN/cito dependency installer
# Run: Rscript scripts/install_dnn.R
#
# Installs torch, cito, and the libtorch backend — one at a time.
# torch::install_torch() downloads ~1 GB of binaries.
# For GPU support, ensure CUDA 12.8+ is available before running.
# GPU will be auto-detected if torch::install_torch() detects CUDA.
#
# Usage:
#   Rscript scripts/install_dnn.R               # CPU only
#   Rscript scripts/install_dnn.R gpu           # GPU with CUDA

step <- 0
total_steps <- 4
start_time <- Sys.time()

log_step <- function(msg) {
  step <<- step + 1
  cat(sprintf("\n[%s] [%d/%d] %s\n", format(Sys.time(), "%H:%M:%S"), step, total_steps, msg))
  utils::flush.console()
}

args <- commandArgs(trailingOnly = TRUE)
force_gpu <- length(args) > 0 &&
  tolower(args[1]) %in% c("1", "true", "yes", "y", "gpu", "cuda")

gpu_available <- function() {
  nzchar(Sys.which("nvidia-smi")) &&
    length(system("nvidia-smi -L", intern = TRUE, ignore.stderr = TRUE)) > 0
}

torch_probe <- function(expr) {
  tryCatch(isTRUE(expr), error = function(e) {
    cat("  torch probe failed: ", conditionMessage(e), "\n", sep = "")
    FALSE
  })
}

torch_cuda_smoke <- function() {
  if (!torch_probe(torch::torch_is_installed())) return(FALSE)
  if (!torch_probe(torch::cuda_is_available())) return(FALSE)
  tryCatch({
    x <- torch::torch_tensor(c(1, 2, 3), device = "cuda")
    y <- x$sum()$cpu()$item()
    isTRUE(y == 6)
  }, error = function(e) {
    cat("  CUDA tensor smoke failed: ", conditionMessage(e), "\n", sep = "")
    FALSE
  })
}

torch_version_for_install <- function() {
  ap <- utils::available.packages(repos = "https://cloud.r-project.org")
  ap["torch", "Version"]
}

torch_repos <- function(kind = "cpu", version = NULL) {
  if (kind == "cpu") return("https://cloud.r-project.org")
  if (is.null(version)) version <- torch_version_for_install()
  c(
    torch = sprintf("https://torch-cdn.mlverse.org/packages/%s/%s/", kind, version),
    CRAN = "https://cloud.r-project.org"
  )
}

cat("═══════════════════════════════════════════════\n")
cat("  SDM Dashboard — DNN/cito Installer\n")
cat("═══════════════════════════════════════════════\n\n")

options(timeout = 900)
cat("  Download timeout: 900 seconds (15 min)\n")

n_cores <- tryCatch({
  max(1, as.integer(Sys.getenv("NCPUS", parallel::detectCores()))[1])
}, error = function(e) 4L)
cat(sprintf("  CPU cores for compilation: %d\n", n_cores))
if (force_gpu) {
  cat("  Mode: GPU (CUDA)\n")
  if (!gpu_available()) {
    stop("GPU mode requested, but nvidia-smi did not report an NVIDIA GPU.", call. = FALSE)
  }
} else {
  cat("  Mode: CPU\n")
}
cat(sprintf("  Started at: %s\n\n", format(start_time, "%Y-%m-%d %H:%M:%S")))

torch_kind <- if (force_gpu) "cu128" else "cpu"
torch_version <- torch_version_for_install()
repos <- torch_repos(torch_kind, torch_version)
os <- tolower(Sys.info()["sysname"])
cat(sprintf("  OS: %s\n\n", os))
if (force_gpu) {
  cat(sprintf("  Torch GPU package repo: %s\n", repos["torch"]))
  cat("  Using the cu128 prebuilt torch package so LibTorch and LibLantern match.\n\n")
}

# ── Step 1: torch (first, so cito's dependency is already satisfied) ──────
log_step("Installing torch...")
if (force_gpu) {
  cat("  Installing CUDA-enabled torch from the mlverse cu128 repository.\n\n")
} else {
  cat("  Installing CPU torch from CRAN.\n\n")
}

t1 <- Sys.time()
install.packages("torch", repos = repos, Ncpus = n_cores, quiet = FALSE)
if (!requireNamespace("torch", quietly = TRUE)) {
  stop("Failed to install torch.", call. = FALSE)
}
elapsed <- difftime(Sys.time(), t1, units = "mins")
cat(sprintf("  ✓ torch completed (%.1f min)\n\n", elapsed))

# ── Step 2: cito (no dependency resolution — torch already installed) ────
log_step("Installing cito...")
cat("  torch was already installed in step 1.\n")
cat("  Installing cito without re-resolving dependencies.\n\n")
t2 <- Sys.time()
install.packages("cito", repos = "https://cloud.r-project.org", Ncpus = n_cores, quiet = TRUE, dependencies = NA)
elapsed <- difftime(Sys.time(), t2, units = "mins")
cat(sprintf("  ✓ cito installed (%.1f min)\n\n", elapsed))

# ── Step 3: libtorch binaries ─────────────────────────────────────────────
log_step("Verifying LibTorch/LibLantern binaries")
suppressPackageStartupMessages(library(torch))

t3 <- Sys.time()
if (force_gpu) {
  cat("  GPU mode requested. Verifying CUDA tensor execution...\n")
  if (!torch_cuda_smoke()) {
    stop(
      "CUDA torch verification failed. Re-run after removing old torch/lantern files, ",
      "then install with: Rscript scripts/install_dnn.R gpu",
      call. = FALSE
    )
  }
  cat("  ✓ CUDA tensor smoke passed\n")
} else if (!torch_probe(torch::torch_is_installed())) {
  torch::install_torch()
}
elapsed <- difftime(Sys.time(), t3, units = "mins")
cat(sprintf("  ✓ LibTorch/LibLantern verification completed (%.1f min)\n\n", elapsed))

# ── Summary ───────────────────────────────────────────────────────────────
total_elapsed <- difftime(Sys.time(), start_time, units = "mins")
cat("═══════════════════════════════════════════════\n")
cat(sprintf("  Installation complete (%.1f min total)\n", total_elapsed))
cat("═══════════════════════════════════════════════\n\n")
cat("  Verify:\n")
cat("    Rscript -e 'library(torch); cat(\"libtorch:\", torch::torch_is_installed(), \"\\n\")'\n")
cat("    Rscript -e 'library(torch); cat(\"cuda:\", torch::cuda_is_available(), \"\\n\")'\n")
cat("    Rscript -e 'cat(\"dnn available:\", requireNamespace(\"cito\", quietly=TRUE) && requireNamespace(\"torch\", quietly=TRUE), \"\\n\")'\n")
