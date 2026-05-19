#!/usr/bin/env Rscript
# Command-line pipeline for the SDM Dashboard Workbench.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
pipeline_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath("pipeline.R", winslash = "/", mustWork = FALSE)
source(file.path(dirname(pipeline_path), "R", "core", "bootstrap.R"))
sdm_set_project_root(dirname(pipeline_path))

source("R/core/optimized_sdm.R")

n_cores <- normalize_core_count(NULL, reserve_one = TRUE)

occ_file <- if (file.exists(sdm_default_occurrence_file)) {
  sdm_default_occurrence_file
} else if (file.exists(sdm_demo_occurrence_file)) {
  sdm_demo_occurrence_file
} else {
  NA_character_
}
if (is.na(occ_file)) {
  stop("No occurrence file was found. Restore presence_data.csv or data/examples/synthetic_presence_data.csv.", call. = FALSE)
}

projection_extent <- sdm_default_projection_extent
if (identical(sdm_default_extent_preset, "occurrence")) {
  preview <- clean_occurrence_preview(occ_file)
  if (!is.null(preview$error)) stop("Could not derive occurrence extent: ", preview$error, call. = FALSE)
  projection_extent <- make_training_extent(preview$occ, buffer = 2)
}

cat("═══════════════════════════════════════════════════════════════\n")
cat("  Optimized SDM Pipeline\n")
cat("═══════════════════════════════════════════════════════════════\n\n")

result <- run_fast_sdm(
  species = default_species_label(occ_file),
  occurrence_file = occ_file,
  worldclim_dir = sdm_default_worldclim_dir,
  selected_biovars = sdm_default_biovars,
  projection_extent = projection_extent,
  background_n = sdm_default_background_n,
  min_source_records = sdm_default_min_source_records,
  merge_small_sources = TRUE,
  thin_by_cell = TRUE,
  include_quadratic = TRUE,
  threshold = sdm_default_threshold,
  aggregation_factor = sdm_default_aggregation_factor,
  cv_folds = sdm_default_cv_folds,
  n_cores = n_cores,
  allow_download = TRUE,
  worldclim_res = sdm_default_worldclim_res,
  output_dir = sdm_default_output_dir,
  seed = sdm_default_seed,
  occurrence_source = paste("Command-line observation records:", occ_file)
)

cat("\nRun complete.\n")
cat(sprintf("CPU cores used: %d\n", result$metrics$n_cores))
cat(sprintf("Records used: %s\n", format(result$metrics$presence_records, big.mark = ",")))
cat(sprintf("Cross-validation AUC: %.3f\n", result$metrics$auc_mean))
cat(sprintf("Mean suitability: %.3f\n", result$summary$mean))
cat(sprintf("Max suitability: %.3f\n", result$summary$max))
cat(sprintf("GeoTIFF: %s\n", result$paths$tif))
cat(sprintf("PNG map: %s\n", result$paths$png))
cat(sprintf("Report: %s\n", result$report_text))
