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

args <- commandArgs(trailingOnly = TRUE)
force_gpu <- isTRUE(as.logical(args[1]))

cat("SDM Dashboard — DNN/cito Installer\n")
cat("==================================\n\n")

n_cores <- tryCatch({
  max(1, as.integer(Sys.getenv("NCPUS", parallel::detectCores()))[1])
}, error = function(e) 4L)

repos <- "https://cloud.r-project.org"

cat("Installing cito...\n")
install.packages("cito", repos = repos, Ncpus = n_cores)
cat("cito: OK\n\n")

cat("Installing torch...\n")
install.packages("torch", repos = repos, Ncpus = n_cores)
cat("torch: OK\n\n")

cat("Installing libtorch binaries (~1 GB)...\n")
suppressPackageStartupMessages(library(torch))

if (force_gpu) {
  cat("GPU mode requested. Installing with CUDA support.\n")
  tryCatch(
    torch::install_torch(reinstall = TRUE),
    error = function(e) {
      cat("GPU install failed:", conditionMessage(e), "\n")
      cat("Falling back to CPU install...\n")
      torch::install_torch()
    }
  )
} else {
  torch::install_torch()
}

cat("\nInstallation complete.\n")
cat("Verify with: Rscript -e 'library(torch); torch::torch_is_installed()'\n")
