#!/usr/bin/env Rscript
# scripts/batch_run.R — run multiple species SDM models in parallel via CLI.
#
# Usage:
#   Rscript scripts/batch_run.R --config batch_config.csv [--output batch_results/] [--cores 4] [--seed 42]
#
# Config CSV format (all columns optional except species + occurrences_csv):
#   species,occurrences_csv,model_id,biovars,use_elevation,use_soil,soil_vars,
#   soil_depths,use_uv,uv_vars,use_vegetation,veg_year,veg_products,use_lulc,
#   lulc_year,use_hfp,hfp_year,use_bioclim_season,use_drought,drought_periods,
#   worldclim_dir,background_n,include_quadratic,threshold,cv_folds,
#   aggregation_factor,vif_reduction,bias_method,future_projection,
#   future_worldclim_dir,seed
#
# Minimal CSV example:
#   species,occurrences_csv,biovars
#   Acacia mearnsii,data/acacia.csv,"1,4,6,12,15,18"
#   Opuntia stricta,data/opuntia.csv,"1,4,6,12,15,18"
#
# Comma-separated fields: biovars, soil_vars, soil_depths, uv_vars, veg_products,
#   drought_periods

suppressPackageStartupMessages({
  library(optparse)
})

option_list <- list(
  make_option(c("-c", "--config"), type = "character", default = NULL,
              help = "CSV file with per-species batch config [required]"),
  make_option(c("-o", "--output"), type = "character", default = "batch_results/",
              help = "Output directory for per-species .rds files [default: %default]"),
  make_option(c("-n", "--cores"), type = "integer", default = NULL,
              help = "Number of parallel workers [default: detectCores() - 1]"),
  make_option(c("-s", "--seed"), type = "integer", default = 42,
              help = "Random seed for reproducibility [default: %default]"),
  make_option(c("-t", "--targets"), action = "store_true", default = FALSE,
              help = "Use targets pipeline instead of future_lapply [default: %default]"),
  make_option(c("--cluster"), type = "character", default = "local",
              help = "Cluster backend: local, slurm, sge, pbs, aws [default: %default]")
)

parser <- OptionParser(
  usage = "%prog --config <batch_config.csv> [--output results/] [--cores 4] [--seed 42]",
  option_list = option_list,
  description = "\nParallel batch SDM runner. Loads all SDM modules, parses a per-species\nCSV config, and runs run_fast_sdm() in parallel across species using the\nfuture/future.apply framework.\n\nConfig CSV columns (any or all optional; species + occurrences_csv required):\n  species, occurrences_csv, model_id, biovars, use_elevation, elevation_demtype,\n  use_soil, soil_vars, soil_depths, use_uv, uv_vars, use_vegetation,\n  veg_year, veg_products, use_lulc, lulc_year, use_hfp, hfp_year,\n  use_bioclim_season, use_drought, drought_periods, worldclim_dir,\n  background_n, include_quadratic, threshold, cv_folds, aggregation_factor,\n  vif_reduction, bias_method, future_projection, future_worldclim_dir, seed\n\nComma-separated list fields: biovars, soil_vars, soil_depths, uv_vars,\n  veg_products, drought_periods.\n  Example: biovars='1,4,6,12,15,18'"
)

args <- parse_args(parser, positional_arguments = 0)
opts <- args$options

if (is.null(opts$config)) {
  print_help(parser)
  message("\nError: --config is required")
  quit(status = 1)
}

if (!file.exists(opts$config)) {
  message("Error: config file not found: ", opts$config)
  quit(status = 1)
}

message("========================================")
message("SDM Batch Runner")
message("========================================")
message("Config: ", opts$config)
message("Output: ", opts$output)
message("Cores:  ", if (is.null(opts$cores)) "auto (detectCores - 1)" else opts$cores)
message("Seed:   ", opts$seed)
message("========================================")

# Load SDM modules (same as optimized_sdm.R path — load.R sources everything)
script_dir <- Sys.getenv("SDM_SCRIPT_DIR",
                         if (file.exists("scripts/batch_run.R")) "." else file.path(getwd(), "scripts"))
project_root_candidates <- c(".", "..", file.path("..", ".."))
project_root <- project_root_candidates[vapply(project_root_candidates,
                                               function(p) file.exists(file.path(p, "R", "load.R")), logical(1))][1]
if (is.na(project_root)) {
  stop("Could not find project root (R/load.R not found in ancestor dirs)", call. = FALSE)
}

source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "load.R"))

# Parse CSV into species_configs list
message("\nParsing config: ", opts$config)
species_configs <- parse_batch_config(opts$config)
message("Loaded ", length(species_configs), " species config(s)")

if (is.null(opts$cores)) {
  n_cores_detected <- normalize_core_count(NULL, reserve_one = TRUE)
  message("Auto-detected cores (reserve 1): ", n_cores_detected)
  opts$cores <- n_cores_detected
}

message("\nStarting batch run...\n")

if (opts$targets) {
  if (opts$cluster != "local") {
    Sys.setenv(SDM_CLUSTER_BACKEND = opts$cluster)
    if (!is.null(opts$cores)) Sys.setenv(SDM_CLUSTER_WORKERS = as.character(opts$cores))
  }
  batch_run_targets(
    config_csv = opts$config,
    output_dir = opts$output,
    workers = opts$cores,
    seed = opts$seed
  )
  message("\n========================================")
  message("SDM Batch Complete (targets pipeline)")
  message("========================================")
  message("Output dir: ", normalizePath(opts$output))
  message("See tar_progress() for per-species status")
  message("========================================")
  quit(status = 0)
}

results <- batch_run_parallel(
  species_configs = species_configs,
  n_cores = opts$cores,
  output_dir = opts$output,
  seed = opts$seed
)

n_success <- sum(!sapply(results, is.null))
n_error <- length(results) - n_success
message("\n========================================")
message("SDM Batch Complete")
message("========================================")
message("Total species: ", length(results))
message("Successful:   ", n_success)
message("Errors:       ", n_error)
message("Output dir:   ", normalizePath(opts$output))
if (n_error > 0) {
  message("\nError logs saved in: ", opts$output)
  message("(Error details in *_<species>_ERROR.log files)")
}
message("========================================")

quit(status = if (n_error > 0) 1 else 0)
