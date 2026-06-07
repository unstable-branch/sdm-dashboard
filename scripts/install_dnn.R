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
force_gpu <- isTRUE(as.logical(args[1]))

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
} else {
  cat("  Mode: CPU\n")
}
cat(sprintf("  Started at: %s\n\n", format(start_time, "%Y-%m-%d %H:%M:%S")))

repos <- "https://cloud.r-project.org"
os <- tolower(Sys.info()["sysname"])
cat(sprintf("  OS: %s\n\n", os))

# ── Step 1: torch (first, so cito's dependency is already satisfied) ──────
log_step("Installing torch...")
cat("  R automatically selects binary package when available,\n")
cat("  otherwise compiles from source. Compiler output is shown below.\n\n")

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
install.packages("cito", repos = repos, Ncpus = n_cores, quiet = TRUE, dependencies = NA)
elapsed <- difftime(Sys.time(), t2, units = "mins")
cat(sprintf("  ✓ cito installed (%.1f min)\n\n", elapsed))

# ── Step 3: libtorch binaries ─────────────────────────────────────────────
log_step("Downloading and installing libtorch binaries (~1 GB)")
suppressPackageStartupMessages(library(torch))

# Enable live download progress bar (R >= 4.2 shows percentage)
options(download.file.method = "libcurl")

has_curl <- nzchar(Sys.which("curl"))
if (has_curl) {
  cat("  Using system curl for live progress: % Total | Speed | ETA\n")
} else {
  cat("  Download progress will show as a text progress bar.\n")
}
cat("  This may take 5–30 minutes depending on your internet connection.\n\n")

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
cat("  Verify:\n")
cat("    Rscript -e 'library(torch); cat(\"libtorch:\", torch::torch_is_installed(), \"\\n\")'\n")
cat("    Rscript -e 'cat(\"dnn available:\", requireNamespace(\"cito\", quietly=TRUE) && requireNamespace(\"torch\", quietly=TRUE), \"\\n\")'\n")
