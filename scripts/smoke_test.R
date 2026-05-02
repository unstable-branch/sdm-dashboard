#!/usr/bin/env Rscript
# Lightweight source/API smoke test. Does not download data or fit a model.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
script_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath(file.path("scripts", "smoke_test.R"), winslash = "/", mustWork = FALSE)
project_root <- dirname(dirname(script_path))
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)

r_files <- list.files("R", pattern = "\\.R$", full.names = TRUE)
parse_errors <- vapply(r_files, function(path) inherits(try(parse(path), silent = TRUE), "try-error"), logical(1))
if (any(parse_errors)) stop("Failed to parse R module(s): ", paste(r_files[parse_errors], collapse = ", "), call. = FALSE)

source(file.path("R", "optimized_sdm.R"))

required_functions <- c(
  "run_fast_sdm", "load_environment", "download_worldclim_layers",
  "opentopo_globaldem_url", "load_soil_covariate", "plot_suitability_map",
  "write_summary_report", "detect_available_cores", "validate_extent",
  "normalize_threshold", "safe_slug", "detect_column", "read_occurrence_file", "infer_species_label",
  "clean_occurrences", "make_training_extent", "make_sdm_formula",
  "sdm_model_choices", "validate_sdm_model_id", "get_sdm_model", "fit_sdm_model", "predict_sdm_model",
  "future_projection_files", "future_projection_ready", "project_future_suitability"
)
missing <- required_functions[!vapply(required_functions, exists, logical(1), mode = "function")]
if (length(missing) > 0) {
  stop("Missing expected functions: ", paste(missing, collapse = ", "), call. = FALSE)
}

invisible(validate_extent(sdm_default_projection_extent, "smoke extent"))
if (!identical(normalize_threshold(sdm_default_threshold), 0.5)) stop("Default threshold validation failed.", call. = FALSE)
if (!identical(validate_biovars(sdm_default_biovars), unique(as.integer(sdm_default_biovars)))) stop("Default BIO variables failed validation.", call. = FALSE)
if (!identical(safe_slug("Demo species / test"), "demo_species_test")) stop("Slug helper failed.", call. = FALSE)
if (!identical(sdm_default_extent_preset, "occurrence")) stop("The app should default to occurrence extent.", call. = FALSE)
if (!identical(validate_sdm_model_id(NULL), sdm_default_model_id)) stop("Default model validation failed.", call. = FALSE)
if (!identical(validate_sdm_model_id("glm"), "glm")) stop("GLM model validation failed.", call. = FALSE)
if (!"glm" %in% unname(sdm_model_choices())) stop("GLM backend missing from model registry.", call. = FALSE)

formula <- make_sdm_formula(c("bio1", "bio12", "elevation_m"), include_quadratic = TRUE)
if (!inherits(formula, "formula")) stop("Formula helper failed.", call. = FALSE)

smoke_occ <- data.frame(
  species = "Demo species",
  decimalLongitude = c(seq(140, 161), 200, 140),
  decimalLatitude = c(seq(-39, -18), -25, -39),
  institutionCode = c(rep("Museum A", 12), rep("Museum B", 10), "Bad", "Museum A"),
  countryCode = "AU",
  stringsAsFactors = FALSE
)
tmp_occ <- tempfile(fileext = ".csv")
utils::write.csv(smoke_occ, tmp_occ, row.names = FALSE)
cleaned <- clean_occurrences(tmp_occ, min_source_records = 5, merge_small_sources = TRUE)
if (nrow(cleaned$occ) != 22) stop("Synthetic occurrence cleaning returned the wrong row count.", call. = FALSE)
if (cleaned$removed_bad_coordinates != 1 || cleaned$removed_duplicates != 1) stop("Synthetic occurrence cleaning did not count removals correctly.", call. = FALSE)
if (!identical(cleaned$columns$longitude, "decimalLongitude") || !identical(cleaned$columns$latitude, "decimalLatitude")) stop("Occurrence column inference failed.", call. = FALSE)

cat("SDM smoke test passed. Modules source correctly.\n")
