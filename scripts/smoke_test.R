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
if (!identical(sdm_default_extent_preset, "aus_full")) stop("The app should default to an Australia-wide projection for the bundled dashboard demo.", call. = FALSE)
if (!identical(validate_sdm_model_id(NULL), sdm_default_model_id)) stop("Default model validation failed.", call. = FALSE)
if (!identical(validate_sdm_model_id("glm"), "glm")) stop("GLM model validation failed.", call. = FALSE)
if (!"glm" %in% unname(sdm_model_choices())) stop("GLM backend missing from model registry.", call. = FALSE)
if (!"multi_ensemble" %in% unname(sdm_model_choices())) stop("multi_ensemble backend missing from model registry.", call. = FALSE)

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

test_multi_ensemble_smoke <- function() {
  cat("[multi_ensemble smoke] starting...\n")
  if (!requireNamespace("maxnet", quietly = TRUE)) {
    cat("[multi_ensemble smoke] skipped: maxnet not installed\n")
    return(invisible(NULL))
  }
  if (!"maxnet" %in% unname(sdm_model_choices())) {
    cat("[multi_ensemble smoke] skipped: maxnet not in model registry\n")
    return(invisible(NULL))
  }
  tmp_occ <- tempfile(fileext = ".csv")
  utils::write.csv(smoke_occ, tmp_occ, row.names = FALSE)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  set.seed(42)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = tmp_env,
    selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22),
    training_extent = c(139.5, 142.5, -24.5, -21.5),
    background_n = 80,
    min_source_records = 5,
    merge_small_sources = TRUE,
    thin_by_cell = FALSE,
    model_id = "multi_ensemble",
    include_quadratic = FALSE,
    threshold = 0.5,
    aggregation_factor = 1,
    cv_folds = 2,
    n_cores = 1,
    allow_download = FALSE,
    worldclim_res = 0.5,
    future_projection = FALSE,
    future_worldclim_dir = "/nonexistent/future/path",
    multi_ensemble_models = c("glm", "rangebag"),
    multi_ensemble_weighting = "equal",
    multi_ensemble_min_auc = 0.4,
    output_dir = out_dir,
    seed = 42
  )
  if (is.null(result)) stop("multi_ensemble smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("multi_ensemble smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) {
    stop("multi_ensemble smoke test missing cv$auc_mean", call. = FALSE)
  }
  if (result$cv$auc_mean <= 0.5) stop("multi_ensemble smoke test auc_mean <= 0.5", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) {
    stop("multi_ensemble smoke test suitability raster not written", call. = FALSE)
  }
  cat("[multi_ensemble smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_esm_smoke <- function() {
  cat("[esm_glm smoke] starting...\n")
  if (!requireNamespace("ecospat", quietly = TRUE) || !requireNamespace("biomod2", quietly = TRUE)) {
    cat("[esm_glm smoke] skipped: ecospat or biomod2 not installed\n")
    return(invisible(NULL))
  }
  if (!"esm_glm" %in% unname(sdm_model_choices())) {
    cat("[esm_glm smoke] skipped: esm_glm not in model registry\n")
    return(invisible(NULL))
  }
  esm_test_occ <- data.frame(
    species = "Demo species",
    decimalLongitude = c(c(140.2, 140.8, 141.3, 141.8, 142.2, 139.8), c(140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 155, 160, 161)),
    decimalLatitude = c(c(-22.0, -22.5, -23.0, -23.5, -24.0, -24.3), c(-39, -38, -37, -36, -35, -34, -33, -32, -31, -30, -29, -28, -27, -26)),
    institutionCode = c(rep("Museum A", 6), rep("Museum B", 14)),
    countryCode = "AU",
    stringsAsFactors = FALSE
  )
  tmp_occ <- tempfile(fileext = ".csv")
  utils::write.csv(esm_test_occ, tmp_occ, row.names = FALSE)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[esm_glm smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  set.seed(99)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = "Worldclim",
    selected_biovars = c(1, 4),
    projection_extent = c(140, 142, -24, -22),
    training_extent = c(139.5, 142.5, -24.5, -21.5),
    background_n = 80,
    min_source_records = 5,
    merge_small_sources = TRUE,
    thin_by_cell = FALSE,
    model_id = "esm_glm",
    include_quadratic = FALSE,
    threshold = 0.5,
    aggregation_factor = 1,
    cv_folds = 2,
    n_cores = 1,
    allow_download = FALSE,
    worldclim_res = 0.5,
    future_projection = FALSE,
    future_worldclim_dir = "/nonexistent/future/path",
    esm_n_runs = 3,
    esm_split = 0.7,
    esm_min_auc = 0.4,
    esm_biovars = c(1, 4),
    output_dir = out_dir,
    seed = 99
  )
  if (is.null(result)) stop("esm_glm smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("esm_glm smoke test returned non-list", call. = FALSE)
  if (is.null(result$esm_config)) stop("esm_glm smoke test missing esm_config", call. = FALSE)
  if (!is.list(result$esm_config)) stop("esm_glm smoke test esm_config not a list", call. = FALSE)
  if (is.null(result$esm_config$n_pairs_used) || result$esm_config$n_pairs_used <= 0) {
    stop("esm_glm smoke test n_pairs_used not > 0: ", result$esm_config$n_pairs_used, call. = FALSE)
  }
  cat("[esm_glm smoke] passed (n_pairs_used=", result$esm_config$n_pairs_used, ")\n", sep = "")
}

test_multi_ensemble_smoke()
test_esm_smoke()

test_batch_runner_smoke <- function() {
  cat("[batch_runner smoke] starting...\n")
  if (!requireNamespace("terra", quietly = TRUE)) {
    cat("[batch_runner smoke] skipped: terra not installed\n")
    return(invisible(NULL))
  }

  demo_csv <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  if (!file.exists(demo_csv)) {
    stop("[batch_runner smoke] demo CSV not found at ", demo_csv, call. = FALSE)
  }

  tmp_occ <- tempfile(fileext = ".csv")
  file.copy(demo_csv, tmp_occ, overwrite = TRUE)
  tmp_dir <- tempfile()
  dir.create(tmp_dir, showWarnings = FALSE)
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)

  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(tmp_dir, recursive = TRUE, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })

  wc_dir <- normalizePath(file.path(project_root, "Worldclim"))
  if (!dir.exists(wc_dir)) {
    cat("[batch_runner smoke] skipped: Worldclim dir not found\n")
    return(invisible(NULL))
  }

  configs <- list(list(
    species = "Test species",
    occurrences_csv = tmp_occ,
    model_id = "glm",
    biovars = "1,4,12",
    cv_folds = "3",
    aggregation_factor = "4",
    background_n = "200",
    worldclim_dir = wc_dir,
    thinning_distance_km = "20"
  ))

  set.seed(42)
  result <- tryCatch(
    batch_run_parallel(configs, n_cores = 1, output_dir = out_dir, seed = 42L),
    error = function(e) {
      message("[batch_runner smoke] caught error: ", conditionMessage(e))
      NULL
    }
  )

  if (is.null(result)) {
    stop("[batch_runner smoke] batch_run_parallel returned NULL", call. = FALSE)
  }
  if (!is.list(result) || length(result) == 0) {
    stop("[batch_runner smoke] batch_run_parallel returned empty result", call. = FALSE)
  }
  if (is.null(result[[1]])) {
    stop("[batch_runner smoke] first species result is NULL", call. = FALSE)
  }
  if (is.null(result[[1]]$cv) || is.null(result[[1]]$cv$auc_mean)) {
    stop("[batch_runner smoke] missing cv$auc_mean in result", call. = FALSE)
  }
  if (result[[1]]$cv$auc_mean <= 0.5) {
    stop("[batch_runner smoke] auc_mean <= 0.5: ", result[[1]]$cv$auc_mean, call. = FALSE)
  }

  cat("[batch_runner smoke] passed (auc_mean=", round(result[[1]]$cv$auc_mean, 3), ")\n", sep = "")
}

test_batch_runner_smoke()

cat("All smoke tests passed.\n")
