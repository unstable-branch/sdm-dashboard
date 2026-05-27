# SDM Dashboard Workbench — Package Installer
# Run: Rscript install_packages.R
#
# Installs all packages required for the SDM Dashboard.
# Core packages + SDM model backends + utilities.
# Optional packages (torch, rgee) are commented out — uncomment if needed.
#
# macOS note: terra requires GDAL/GEOS/PROJ. If binary not available,
# install via Homebrew first: brew install gdal geos proj
# then: install.packages('terra', type = 'source')
# Apple Silicon users: R must be the arm64 (Apple Silicon) build,
# not the x86_64 (Intel) build running under Rosetta.

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
  "shiny", "bslib", "leaflet", "mapview", "sf", "DT", "shinyjs",

  # Geodata / raster
  "terra", "geodata",

  # SDM model backends
  "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost", "ranger",

  # Model evaluation
  "biomod2", "PresenceAbsence", "pROC", "ecospat",
  "marginaleffects", "plotrix", "ggplot2",

  # Spatial analysis
  "CAST", "blockCV",

  # Utilities
  "httr", "jsonlite", "callr",

  # Occurrence handling
  "CoordinateCleaner", "rgbif", "finch",

  # Python bridge
  "arrow", "reticulate",

  # Parallel
  "future", "future.apply",

  # Testing / dev
  "testthat", "devtools",

  # Workflow pipelines (optional — for reproducible batch processing)
  "targets", "tarchetypes", "geotargets"
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
# Optional: INLA (Bayesian spatial) — special repo, not CRAN
# ---------------------------------------------------------------------------
# Uncomment the lines below if you need INLA spatial SDM support.
# INLA must be installed from its own repository.

# cat("\nInstalling INLA (optional — Bayesian spatial)...\n")
# install.packages("INLA", repos = c("https://inla.r-inla-download.org/R/stable", repos), dep = TRUE, Ncpus = n_cores, lib = .libPaths()[1])

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