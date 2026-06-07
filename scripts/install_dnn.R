#!/usr/bin/env Rscript
# SDM Dashboard — DNN/cito dependency installer
# Run: Rscript scripts/install_dnn.R
#
# Installs cito, torch, and the libtorch backend.
# torch::install_torch() downloads ~1 GB of binaries.
# For GPU support, ensure CUDA 12.8+ is available before running.
# GPU will be auto-detected if torch::install_torch() detects CUDA.
#
# Usage:
#   Rscript scripts/install_dnn.R               # CPU only
#   CUDA=12.8 Rscript scripts/install_dnn.R     # GPU with specific CUDA

step <- 0
total_steps <- 3
start_time <- Sys.time()

log_step <- function(msg) {
  step <<- step + 1
  cat(sprintf("[%s] [%d/%d] %s\n", format(Sys.time(), "%H:%M:%S"), step, total_steps, msg))
  utils::flush.console()
}

args <- commandArgs(trailingOnly = TRUE)
force_gpu <- isTRUE(as.logical(args[1]))

cat("═══════════════════════════════════════════════\n")
cat("  SDM Dashboard — DNN/cito Installer\n")
cat("═══════════════════════════════════════════════\n\n")

n_cores <- tryCatch({
  max(1, as.integer(Sys.getenv("NCPUS", parallel::detectCores()))[1])
}, error = function(e) 4L)
cat(sprintf("  CPU cores for compilation: %d\n", n_cores))
if (force_gpu) {
  cat("  Mode: GPU (CUDA)\n")
} else {
  cat("  Mode: CPU\n")
}
cat(sprintf("  Started at: %s\n\n", format(start_time, "%Y-%m-%d %H:%M:%S")))

repos <- "https://cloud.r-project.org"

# ── Step 1: cito ──────────────────────────────────────────────────────────
log_step("Installing cito...")
t1 <- Sys.time()
install.packages("cito", repos = repos, Ncpus = n_cores)
elapsed <- difftime(Sys.time(), t1, units = "mins")
cat(sprintf("  ✓ cito installed (%.1f min)\n\n", elapsed))

# ── Step 2: torch ─────────────────────────────────────────────────────────
log_step("Installing torch...")
cat("  This also installs torchvision as a dependency.\n")
t2 <- Sys.time()
install.packages("torch", repos = repos, Ncpus = n_cores)
elapsed <- difftime(Sys.time(), t2, units = "mins")
cat(sprintf("  ✓ torch installed (%.1f min)\n\n", elapsed))

# ── Step 3: libtorch binaries ─────────────────────────────────────────────
log_step("Downloading and installing libtorch binaries (~1 GB)")
cat("  This may take 5–30 minutes depending on your internet connection.\n")
cat("  Progress is shown as the download streams to disk.\n\n")

suppressPackageStartupMessages(library(torch))

t3 <- Sys.time()
if (force_gpu) {
  cat("  GPU mode requested. Attempting CUDA install...\n")
  tryCatch(
    torch::install_torch(reinstall = TRUE),
    error = function(e) {
      cat(sprintf("  GPU install failed: %s\n", conditionMessage(e)))
      cat("  Falling back to CPU install...\n")
      torch::install_torch()
    }
  )
} else {
  torch::install_torch()
}
elapsed <- difftime(Sys.time(), t3, units = "mins")
cat(sprintf("  ✓ libtorch installed (%.1f min)\n\n", elapsed))

# ── Summary ───────────────────────────────────────────────────────────────
total_elapsed <- difftime(Sys.time(), start_time, units = "mins")
cat("═══════════════════════════════════════════════\n")
cat(sprintf("  Installation complete (%.1f min total)\n", total_elapsed))
cat("═══════════════════════════════════════════════\n\n")
cat("  Verify with:\n")
cat("    Rscript -e 'library(torch); cat(\"libtorch installed:\", torch::torch_is_installed(), \"\\n\")'\n")
cat("    Rscript -e 'cat(\"dnn available:\", requireNamespace(\"cito\", quietly=TRUE) && requireNamespace(\"torch\", quietly=TRUE), \"\\n\")'\n")
