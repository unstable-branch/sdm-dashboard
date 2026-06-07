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
#   Rscript scripts/install_dnn.R gpu           # GPU with CUDA

step <- 0
total_steps <- 3
start_time <- Sys.time()

log_step <- function(msg) {
  step <<- step + 1
  cat(sprintf("\n[%s] [%d/%d] %s\n", format(Sys.time(), "%H:%M:%S"), step, total_steps, msg))
  utils::flush.console()
}

heartbeat_pid <- NULL
start_heartbeat <- function(interval = 30) {
  heartbeat_pid <<- parallel::mcparallel({
    while (TRUE) {
      cat(".")
      utils::flush.console()
      Sys.sleep(interval)
    }
  })
}
stop_heartbeat <- function() {
  if (!is.null(heartbeat_pid)) {
    tryCatch(tools::pskill(heartbeat_pid), error = function(e) NULL)
    tryCatch(parallel::mccollect(heartbeat_pid, wait = FALSE), error = function(e) NULL)
    heartbeat_pid <<- NULL
    cat("\n")
  }
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

# Repos for cito (standard CRAN only)
cran_repos <- "https://cloud.r-project.org"

# Repos for torch: try Posit binary on Linux (faster), fall back to CRAN
os <- tolower(Sys.info()["sysname"])
torch_repos <- cran_repos
if (os == "linux") {
  os_release <- tryCatch(readLines("/etc/os-release", warn = FALSE), error = function(e) "")
  version_codename <- ""
  for (line in os_release) {
    if (grepl("^VERSION_CODENAME=", line)) {
      version_codename <- sub("^VERSION_CODENAME=", "", line)
      version_codename <- gsub('"', "", version_codename)
      break
    }
  }
  if (nzchar(version_codename)) {
    torch_repos <- c(
      sprintf("https://packagemanager.posit.co/cran/__linux__/%s/latest", version_codename),
      "https://cloud.r-project.org"
    )
  }
  cat("  OS: Linux\n")
} else {
  cat("  OS:", os, "\n")
}

# ── Step 1: cito ──────────────────────────────────────────────────────────
log_step("Installing cito...")
t1 <- Sys.time()
install.packages("cito", repos = cran_repos, Ncpus = n_cores, quiet = TRUE)
elapsed <- difftime(Sys.time(), t1, units = "mins")
cat(sprintf("  ✓ cito installed (%.1f min)\n", elapsed))

# ── Step 2: torch ─────────────────────────────────────────────────────────
log_step("Installing torch...")
cat("  Repos to try:\n")
for (r in torch_repos) cat("    -", r, "\n")
cat("\n")

if (os == "linux") {
  cat("  Attempting binary install from Posit Package Manager first...\n")
  cat("  If binary unavailable, falls back to source compile.\n")
  cat("  Source compilation takes 10-30 minutes and shows NO output.\n")
  cat("  A dot (.) every 30 seconds confirms it's still working.\n\n")
} else {
  cat("  Compiling from source — 10-30 minutes with no terminal output. Be patient.\n")
  cat("  A dot (.) every 30 seconds confirms it's still working.\n\n")
}

t2 <- Sys.time()

# Try binary first on Linux, fall back to source
installed <- FALSE
for (r in torch_repos) {
  if (installed) break
  cat(sprintf("  Trying repo: %s\n", r))
  start_heartbeat(30)
  tryCatch({
    if (os == "linux") {
      suppressWarnings(
        install.packages("torch", repos = r, Ncpus = n_cores, quiet = FALSE, type = "binary")
      )
    } else {
      install.packages("torch", repos = r, Ncpus = n_cores, quiet = FALSE)
    }
    # Check if actually installed
    if (requireNamespace("torch", quietly = TRUE)) {
      installed <- TRUE
      cat("  ✓ torch installed from:", r, "\n")
    }
  }, error = function(e) {
    cat(sprintf("  ✗ Failed: %s\n", conditionMessage(e)))
  }, finally = {
    stop_heartbeat()
  })
}

# Final fallback: source compile from CRAN
if (!installed) {
  cat("  Binary installs unavailable. Attempting source compile from CRAN...\n")
  cat("  This will take 10-30 minutes. Get a coffee.\n")
  start_heartbeat(30)
  tryCatch({
    install.packages("torch", repos = "https://cloud.r-project.org", Ncpus = n_cores, quiet = FALSE, type = "source")
    if (requireNamespace("torch", quietly = TRUE)) {
      installed <- TRUE
      cat("  ✓ torch installed from CRAN source\n")
    }
  }, error = function(e) {
    cat(sprintf("  ✗ Failed: %s\n", conditionMessage(e)))
  }, finally = {
    stop_heartbeat()
  })
}

if (!installed) {
  stop("Failed to install torch from any repository.", call. = FALSE)
}

elapsed <- difftime(Sys.time(), t2, units = "mins")
cat(sprintf("\n  ✓ torch installation completed (%.1f min)\n", elapsed))

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
cat(sprintf("  ✓ libtorch installed (%.1f min)\n", elapsed))

# ── Summary ───────────────────────────────────────────────────────────────
total_elapsed <- difftime(Sys.time(), start_time, units = "mins")
cat("\n═══════════════════════════════════════════════\n")
cat(sprintf("  Installation complete (%.1f min total)\n", total_elapsed))
cat("═══════════════════════════════════════════════\n\n")
cat("  Verify:\n")
cat("    Rscript -e 'library(torch); cat(\"libtorch:\", torch::torch_is_installed(), \"\\n\")'\n")
cat("    Rscript -e 'cat(\"dnn:\", requireNamespace(\"cito\", quietly=TRUE) && requireNamespace(\"torch\", quietly=TRUE), \"\\n\")'\n")
