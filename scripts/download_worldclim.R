#!/usr/bin/env Rscript
# Download/recreate local WorldClim BIO raster files.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
script_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath(file.path("scripts", "download_worldclim.R"), winslash = "/", mustWork = FALSE)
project_root <- dirname(dirname(script_path))
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)
source("R/core/optimized_sdm.R")

args <- commandArgs(trailingOnly = TRUE)
res <- if (length(args) >= 1) as.numeric(args[[1]]) else sdm_default_worldclim_res
biovars <- if (length(args) >= 2) as.integer(strsplit(args[[2]], ",")[[1]]) else sdm_default_biovars
n_cores <- normalize_core_count(NULL, reserve_one = TRUE)

download_worldclim_layers(
  worldclim_dir = sdm_default_worldclim_dir,
  selected_biovars = biovars,
  res = res,
  n_cores = n_cores
)

cat("WorldClim layers checked/downloaded in ", sdm_default_worldclim_dir, "/\n", sep = "")
