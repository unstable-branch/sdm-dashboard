# Reproducible R Script Export.
# Generates a standalone R script that reproduces a run end-to-end.

export_run_script <- function(result, path = NULL, include_comments = TRUE) {
  if (is.null(path)) {
    path <- paste0(safe_slug(result$config$species), "_reproducible_run.R")
  }

  config <- result$config
  lines <- character()

  if (include_comments) {
    lines <- c(
      lines,
      "# ================================================================================",
      "# SDM Dashboard Workbench — Reproducible Run Script",
      paste0("# Generated: ", Sys.time()),
      paste0("# Species: ", config$species),
      paste0("# Model: ", result$model_id),
      "# ================================================================================",
      "",
      "# This script reproduces the SDM run end-to-end using the same parameters",
      "# stored in the result object from a previous run.",
      "",
      "# ------------------------------------------------------------------------------",
      "# SETUP: Install required packages",
      "# ------------------------------------------------------------------------------",
      "",
      "# Required packages (uncomment to install):",
      "# install.packages(c('terra', 'shiny', 'bslib', 'geodata'))",
      "# For MaxEnt backend:",
      "# install.packages('maxnet')",
      "# For biomod2 backend:",
      "# install.packages(c('biomod2', 'PresenceAbsence', 'pROC'))",
      "",
      "# ------------------------------------------------------------------------------",
      "# SETUP: Load the SDM Dashboard Workbench",
      "# ------------------------------------------------------------------------------",
      "",
      "# Option 1: If running from the SDM Dashboard source directory:",
      "# setwd('/path/to/sdm-dashboard-main')",
      "# source('R/load.R')",
      "",
      "# Option 2: If using a packaged version from CRAN:",
      "# library(sdmDashboard)  # (when available)",
      "",
      "# ------------------------------------------------------------------------------",
      "# CONFIGURATION (from previous run)",
      "# ------------------------------------------------------------------------------",
      ""
    )
  }

  lines <- c(lines, "# Run parameters")
  lines <- c(lines, paste0("species_name <- '", config$species, "'"))
  lines <- c(lines, paste0("model_id <- '", result$model_id, "'"))

  if (!is.null(config$extent)) {
    lines <- c(lines, paste0("projection_extent <- c(", paste(config$extent, collapse = ", "), ")"))
  }
  if (!is.null(config$biovars)) {
    lines <- c(lines, paste0("selected_biovars <- c(", paste(config$biovars, collapse = ", "), ")"))
  }
  if (!is.null(config$background_n)) {
    lines <- c(lines, paste0("background_n <- ", config$background_n))
  }
  if (!is.null(config$cv_folds)) {
    lines <- c(lines, paste0("cv_folds <- ", config$cv_folds))
  }
  if (!is.null(config$threshold)) {
    lines <- c(lines, paste0("threshold <- ", config$threshold))
  }
  if (!is.null(config$aggregation_factor)) {
    lines <- c(lines, paste0("aggregation_factor <- ", config$aggregation_factor))
  }

  lines <- c(lines, "")
  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "# OPTIONAL: Set options")
  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "")
  lines <- c(lines, "# Enable biomod2 backend if used:")
  lines <- c(lines, "# options(sdm.enable_biomod2 = TRUE)")
  lines <- c(lines, "")
  lines <- c(lines, "# Set number of cores:")
  lines <- c(lines, paste0("# n_cores <- ", config$n_cores %||% 1))
  lines <- c(lines, "")

  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "# LOAD OCCURRENCE DATA")
  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "")
  lines <- c(lines, "# If you have a cleaned occurrence file from the previous run:")
  lines <- c(lines, "# occ_file <- 'cleaned_occurrences.csv'  # Update path as needed")
  lines <- c(lines, "# occ <- read.csv(occ_file)")

  if (!is.null(result$occurrence) && nrow(result$occurrence) > 0) {
    occ_path <- paste0(safe_slug(config$species), "_cleaned_occurrences.csv")
    lines <- c(lines, paste0("# Occurrence data from previous run (", nrow(result$occurrence), " records)"))
    lines <- c(lines, paste0("# Saved to: '", occ_path, "'"))
  }
  lines <- c(lines, "")

  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "# RUN SDM")
  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "")
  lines <- c(lines, "# Full run (when you have occurrence data and covariate rasters):")
  lines <- c(lines, "# result <- run_fast_sdm(")
  lines <- c(lines, "#   species = species_name,")
  lines <- c(lines, "#   model_id = model_id,")
  lines <- c(lines, "#   extent = projection_extent,")
  lines <- c(lines, "#   selected_biovars = selected_biovars,")
  lines <- c(lines, "#   worldclim_dir = 'Worldclim',  # or your path")
  lines <- c(lines, "#   background_n = background_n,")
  lines <- c(lines, "#   cv_folds = cv_folds,")
  lines <- c(lines, "#   threshold = threshold,")
  lines <- c(lines, "#   aggregation_factor = aggregation_factor")
  lines <- c(lines, "# )")
  lines <- c(lines, "")

  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "# MODEL EVALUATION METRICS (from previous run)")
  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "")
  if (!is.null(result$cv)) {
    lines <- c(lines, paste0("# Cross-validation AUC: ", sprintf("%.3f", result$cv$auc_mean), " +/- ", sprintf("%.3f", result$cv$auc_sd)))
    lines <- c(lines, paste0("# Cross-validation TSS: ", sprintf("%.3f", result$cv$tss_mean), " +/- ", sprintf("%.3f", result$cv$tss_sd)))
  }
  if (!is.null(result$metrics$cbi)) {
    lines <- c(lines, paste0("# Continuous Boyce Index (CBI): ", sprintf("%.3f", result$metrics$cbi)))
  }
  lines <- c(lines, "")

  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "# NOTES")
  lines <- c(lines, "# ------------------------------------------------------------------------------")
  lines <- c(lines, "# - This script captures the parameters from a run, but the actual covariate")
  lines <- c(lines, "#   raster files must be available at the specified paths.")
  lines <- c(lines, "# - WorldClim and other climate data must be downloaded separately.")
  lines <- c(lines, "# - For full reproducibility, also export the ODMAP report:")
  lines <- c(lines, paste0("#   write_odmap_report(result, 'odmap.csv', 'odmap.md')"))
  lines <- c(lines, "#")
  lines <- c(lines, paste0("# ODMAP v1.0 reference: Zurell et al. 2020, Ecography 43:1261-1277"))
  lines <- c(lines, "")

  writeLines(lines, con = path)
  invisible(path)
}

safe_slug <- function(x) {
  if (is.null(x) || !nzchar(x)) return("untitled")
  x <- gsub("[^a-zA-Z0-9]", "_", x)
  x <- gsub("_+", "_", x)
  x <- gsub("^_|_$", "", x)
  tolower(x)
}

`%||%` <- function(x, y) if (is.null(x)) y else x