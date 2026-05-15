# SDM Dashboard Workbench — Package Installer
# Run: Rscript install_packages.R
#
# Installs all packages required for the SDM Dashboard.
# Core packages + SDM model backends + utilities.
# Optional packages (torch, rgee) are commented out — uncomment if needed.

cat("SDM Dashboard Package Installer\n")
cat("===============================\n\n")

n_cores <- tryCatch({
  max(1, as.integer(Sys.getenv("NCPUS", parallel::detectCores()))[1])
}, error = function(e) 4L)

cat("Using", n_cores, "CPU cores for compilation.\n\n")

repos <- "https://cloud.r-project.org"

# ---------------------------------------------------------------------------
# Core packages (always installed)
# ---------------------------------------------------------------------------

core_packages <- c(
  # UI
  "shiny", "bslib", "leaflet", "mapview", "sf", "DT",

  # Geodata / raster
  "terra", "geodata", "ncdf4",

  # SDM model backends
  "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost",

  # Model evaluation
  "biomod2", "PresenceAbsence", "pROC", "ecospat",
  "marginaleffects", "plotrix",

  # Utilities
  "httr", "jsonlite", "callr", "glue", "magrittr", "R.utils",
  "parallel", "foreach", "doParallel",

  # Occurrence handling
  "CoordinateCleaner", "rgbif", "finch",

  # Parallel / progress
  "future", "future.apply", "progressr",

  # Testing
  "testthat"
)

cat("Installing core packages (", length(core_packages), "):\n  ", paste(core_packages, collapse = ", "), "\n\n", sep = "")

missing_core <- core_packages[!vapply(core_packages, requireNamespace, logical(1), quietly = TRUE)]

if (length(missing_core) > 0) {
  cat("Installing", length(missing_core), "missing package(s)...\n")
  install.packages(missing_core, repos = repos, Ncpus = n_cores, lib = .libPaths()[1],
                  quiet = FALSE, verbose = FALSE)
} else {
  cat("All core packages already installed.\n")
}

# ---------------------------------------------------------------------------
# Optional: Deep learning (torch / cito)
# ---------------------------------------------------------------------------
# Uncomment the lines below if you need DNN model support.
# NOTE: torch requires interactive installation of libtorch binaries.
# After running this script, in an interactive R session do:
#   torch::install_torch()

# cat("\nInstalling torch + cito (optional)...\n")
# install.packages(c("torch", "reticulate", "cito"), repos = repos, Ncpus = n_cores, lib = .libPaths()[1])
# In an interactive R session, run: torch::install_torch()

# ---------------------------------------------------------------------------
# Optional: Google Earth Engine (rgee)
# ---------------------------------------------------------------------------
# Uncomment the lines below if you need GEE integration.
# Requires: GEE account + authentication (run rgee::rgee_configure())

# cat("\nInstalling rgee (optional)...\n")
# install.packages(c("rgee", "reticulate"), repos = repos, Ncpus = n_cores, lib = .libPaths()[1])

# ---------------------------------------------------------------------------
# Verify installation
# ---------------------------------------------------------------------------
cat("\nVerification:\n")

verify_pkg <- function(pkg) {
  installed <- requireNamespace(pkg, quietly = TRUE)
  status <- if (installed) "\u2713" else "\u2717 MISSING"
  cat("  ", status, " ", pkg, "\n", sep = "")
  invisible(installed)
}

cat("\nCore packages:\n")
core_ok <- vapply(core_packages, verify_pkg, logical(1))

cat("\nOptional packages (may need extra setup):\n")
optional <- c("torch", "cito", "rgee", "biomod2", "ecospat")
vapply(optional, verify_pkg, logical(1))

cat("\nDone.\n")