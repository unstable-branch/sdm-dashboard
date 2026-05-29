# Reproducible R Script Export.
# Generates a standalone R script that reproduces a run end-to-end.

export_run_script <- function(result, path = NULL, include_comments = TRUE,
                               format = c("r", "targets")) {
  format <- match.arg(format)

  if (identical(format, "targets")) {
    return(export_run_script_targets(result, path))
  }

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
      "# For Random Forest backend:",
      "# install.packages('ranger')",
      "# For ESM (rare species) backend:",
      "# install.packages(c('ecospat', 'biomod2'))",
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
  if (!is.null(result$model_id)) {
    lines <- c(lines, paste0("model_id <- '", result$model_id, "'"))
  }
  if (!is.null(result$manifest$data$occurrence_hash_sha256)) {
    lines <- c(lines, paste0("expected_occurrence_hash <- '", result$manifest$data$occurrence_hash_sha256, "'"))
  }

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
  if (!is.null(config$climate_source)) {
    lines <- c(lines, paste0("climate_source <- '", config$climate_source, "'"))
  }
  # Model-specific parameters
  model_id <- result$model_id
  if (model_id %in% c("esm_glm", "esm_maxnet")) {
    esm_cfg <- result$esm_config
    if (!is.null(esm_cfg)) {
      lines <- c(lines, paste0("esm_algorithm <- '", esm_cfg$algorithm, "'"))
      lines <- c(lines, paste0("esm_min_auc <- ", esm_cfg$min_auc))
      lines <- c(lines, paste0("esm_power <- ", esm_cfg$power))
      lines <- c(lines, paste0("esm_n_runs <- ", esm_cfg$n_runs))
      lines <- c(lines, paste0("esm_split <- ", esm_cfg$data_split))
    }
  }
  if (identical(model_id, "multi_ensemble")) {
    if (!is.null(config$multi_ensemble_models)) {
      lines <- c(lines, paste0("multi_ensemble_models <- c('", paste(config$multi_ensemble_models, collapse = "', '"), "')"))
    }
    if (!is.null(config$multi_ensemble_weighting)) {
      lines <- c(lines, paste0("multi_ensemble_weighting <- '", config$multi_ensemble_weighting, "'"))
    }
    if (!is.null(config$multi_ensemble_power)) {
      lines <- c(lines, paste0("multi_ensemble_power <- ", config$multi_ensemble_power))
    }
  }
  if (identical(model_id, "maxnet")) {
    if (!is.null(config$maxnet_features)) {
      lines <- c(lines, paste0("maxnet_features <- '", config$maxnet_features, "'"))
    }
    if (!is.null(config$maxnet_regmult)) {
      lines <- c(lines, paste0("maxnet_regmult <- ", config$maxnet_regmult))
    }
  }
  if (identical(model_id, "rf")) {
    lines <- c(lines, "# RF parameters (ranger)")
    lines <- c(lines, "# num_trees <- 500")
    lines <- c(lines, "# mtry <- NULL  # auto: sqrt(n_covariates)")
    lines <- c(lines, "# min_node_size <- 10")
  }
  if (!is.null(config$cv_strategy)) {
    lines <- c(lines, paste0("cv_strategy <- '", config$cv_strategy, "'"))
  }
  if (!is.null(config$bias_method)) {
    lines <- c(lines, paste0("bias_method <- '", config$bias_method, "'"))
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
  if (!is.null(result$manifest$data$occurrence_hash_sha256)) {
    lines <- c(lines, paste0("# Expected occurrence file SHA256: ", result$manifest$data$occurrence_hash_sha256))
    lines <- c(lines, "# To verify your input file matches:")
    lines <- c(lines, "# if (requireNamespace('digest', quietly = TRUE)) {")
    lines <- c(lines, "#   actual_hash <- digest::digest(occ_file, algo = 'sha256', file = TRUE)")
    lines <- c(lines, "#   if (actual_hash != expected_occurrence_hash) {")
    lines <- c(lines, "#     warning('Occurrence file hash mismatch. Results may differ from the original run.')")
    lines <- c(lines, "#   }")
    lines <- c(lines, "# }")
  }
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
  lines <- c(lines, "#   aggregation_factor = aggregation_factor,")
  lines <- c(lines, "#   source = climate_source,")
  lines <- c(lines, "#   cv_strategy = cv_strategy,")
  lines <- c(lines, "#   bias_method = bias_method")
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

#' Export a reproducible targets pipeline instead of a flat R script.
#' Writes a directory containing config.csv + _targets.R.
#' @inheritParams export_run_script
#' @param path Directory path for the exported pipeline. Default: {species}_targets/
#' @return Invisible path to the exported directory.
export_run_script_targets <- function(result, path = NULL) {
  config <- result$config %||% list()
  species_slug <- safe_slug(config$species %||% "species")

  if (is.null(path)) {
    path <- paste0(species_slug, "_targets")
  }
  dir.create(path, recursive = TRUE, showWarnings = FALSE)

  # Write config CSV (single row — this run's parameters)
  csv_path <- file.path(path, "config.csv")
  row <- data.frame(
    species = config$species %||% "Unknown",
    occurrences_csv = config$occurrence_file %||% "",
    model_id = result$model_id %||% "glm",
    biovars = paste(config$selected_biovars %||% c(1,4,6,12,15,18), collapse = ","),
    projection_extent = paste(config$projection_extent %||% c(112,154,-44,-10), collapse = ","),
    threshold = config$threshold %||% "max_tss",
    cv_folds = config$cv_folds %||% 5,
    cv_strategy = config$cv_strategy %||% "random",
    seed = config$seed %||% 42,
    stringsAsFactors = FALSE
  )
  write.csv(row, csv_path, row.names = FALSE)

  # Write _targets.R
  targets_lines <- c(
    "# Auto-generated reproducible targets pipeline",
    paste0("# Original run: ", config$species, " / ", result$model_id),
    paste0("# Generated: ", Sys.time()),
    "",
    "library(targets)",
    "library(tarchetypes)",
    "library(geotargets)",
    "",
    "tar_option_set(",
    '  store = "outputs/_targets",',
    '  packages = c("terra", "sf")',
    ")",
    "",
    "# Point this to your sdm-dashboard source directory",
    'source("R/core/bootstrap.R")',
    'sdm_set_project_root(getwd())',
    'source("R/engine_load.R")',
    "",
    "list(",
    '  tar_target(config_path, "config.csv", format = "file"),',
    "  tar_target(config_rows, {",
    "    df <- read.csv(config_path, stringsAsFactors = FALSE, check.names = FALSE)",
    "    split(df, seq_len(nrow(df)))",
    "  }),",
    "  tar_target(cfg, build_config_from_row(config_rows),",
    "    pattern = map(config_rows)),",
    "  tar_target(occ_clean, sdm_stage_clean(cfg), pattern = map(cfg)),",
    "  tar_target(env, sdm_stage_covariates(cfg, occ_clean$occ),",
    "    pattern = map(cfg)),",
    "  tar_target(fit, sdm_stage_fit(cfg, occ_clean$occ, env),",
    "    pattern = map(cfg)),",
    "  tar_target(suit_tif, {",
    '    tif <- file.path("outputs", paste0(cfg$species, "_suit.tif"))',
    "    dir.create(dirname(tif), recursive = TRUE, showWarnings = FALSE)",
    "    sdm_stage_predict(cfg, fit$fit, env, tif)",
    "    tif",
    "  }, pattern = map(fit), format = \"file\"),",
    "  tar_target(post, sdm_stage_postprocess(",
    "    cfg, fit$fit, terra::rast(suit_tif), env),",
    "    pattern = map(suit_tif))",
    ")",
    "",
    "# Run: tar_make()",
    "# Inspect: tar_visnetwork()"
  )
  writeLines(targets_lines, file.path(path, "_targets.R"))

  message("[export] targets pipeline written to: ", normalizePath(path))
  message("[export]   tar_make()  — run the pipeline")
  message("[export]   tar_visnetwork() — view dependency graph")

  invisible(normalizePath(path))
}
