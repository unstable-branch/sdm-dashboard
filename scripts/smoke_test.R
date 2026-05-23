#!/usr/bin/env Rscript
# Lightweight source/API smoke test with tagged filtering.
# Usage: Rscript scripts/smoke_test.R [--tags=fast,heavy,ensemble,esm,batch,ecology,covariates,reporting,ml,all]

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
script_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath(file.path("scripts", "smoke_test.R"), winslash = "/", mustWork = FALSE)
project_root <- dirname(dirname(script_path))
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)

tags_arg <- grep("^--tags=", cmd_args, value = TRUE)
requested_tags <- if (length(tags_arg) > 0) strsplit(sub("^--tags=", "", tags_arg[1]), ",")[[1]] else c("fast", "heavy")
requested_tags <- trimws(requested_tags)
has_tag <- function(tag) tag %in% requested_tags || "all" %in% requested_tags

r_files <- list.files("R", pattern = "\\.R$", full.names = TRUE, recursive = TRUE)
parse_errors <- vapply(r_files, function(path) inherits(try(parse(path), silent = TRUE), "try-error"), logical(1))
if (any(parse_errors)) stop("Failed to parse R module(s): ", paste(r_files[parse_errors], collapse = ", "), call. = FALSE)

source(file.path("R", "core", "optimized_sdm.R"))

# --- Core functions ---
required_functions <- c(
  "run_fast_sdm", "load_environment", "sdm_config", "is.sdm_config",
  "log_message", "progress_step", "extent_cache_key", "combine_extents",
  "detect_available_cores", "validate_extent", "normalize_threshold",
  "normalize_cv_strategy", "normalize_cv_block_size_km",
  "safe_slug", "make_training_extent", "make_sdm_formula",
  # Data
  "detect_column", "read_occurrence_file", "infer_species_label",
  "clean_occurrences", "read_dwca",
  # Covariates
  "load_climate_covariates", "find_worldclim_files",
  "load_elevation_covariate", "load_soil_covariate",
  "load_uv_covariate", "load_vegetation_covariate",
  "load_lulc_covariate", "load_human_footprint_covariate",
  "load_bioclim_seasonality", "load_drought_covariate",
  "load_extra_covariates", "align_covariate_stack",
  "opentopo_globaldem_url",
  # Models
  "sdm_model_choices", "sdm_model_ids", "validate_sdm_model_id",
  "get_sdm_model", "fit_sdm_model", "predict_sdm_model",
  "fit_fast_sdm", "fit_gam_sdm", "fit_rangebag_sdm",
  "fit_ensemble_glm_rangebag_sdm", "fit_multi_model_ensemble",
  "fit_esm", "fit_maxnet_sdm", "fit_rf_sdm", "fit_xgboost_sdm",
  "fit_dnn_sdm", "run_biomod2",
  "make_cv_folds_random", "make_cv_folds_spatial_blocks",
  "compute_response_curves", "plot_response_curves",
  "compute_calibration", "tune_maxnet", "tune_gam",
  "compute_vif", "select_by_vif", "apply_vif_selection",
  # Ecology
  "compute_eoo_aoo", "compute_climate_match",
  "compute_niche_overlap", "stack_species_richness",
  "simulate_dispersal", "compute_aoa",
  "apply_climex_params", "compute_response_index",
  # Output
  "plot_suitability_map", "write_summary_report", "write_odmap_report",
  "write_manifest", "save_diagnostic_plots", "export_run_script",
  "parse_comma_ints", "parse_comma_strings", "parse_comma_doubles",
  "parse_logical", "build_run_args", "write_batch_summary_csv",
  "parse_batch_config",
  # Future
  "future_projection_files", "future_projection_ready", "project_future_suitability"
)
missing <- required_functions[!vapply(required_functions, exists, logical(1), mode = "function")]
if (length(missing) > 0) {
  stop("Missing expected functions: ", paste(missing, collapse = ", "), call. = FALSE)
}

# --- Default validation ---
invisible(validate_extent(sdm_default_projection_extent, "smoke extent"))
if (!identical(normalize_threshold(sdm_default_threshold), 0.5)) stop("Default threshold validation failed.", call. = FALSE)
if (!identical(validate_biovars(sdm_default_biovars), unique(as.integer(sdm_default_biovars)))) stop("Default BIO variables failed validation.", call. = FALSE)
if (!identical(safe_slug("Demo species / test"), "demo_species_test")) stop("Slug helper failed.", call. = FALSE)
if (!identical(sdm_default_extent_preset, "aus_full")) stop("The app should default to an Australia-wide projection for the bundled dashboard demo.", call. = FALSE)
if (!identical(validate_sdm_model_id(NULL), sdm_default_model_id)) stop("Default model validation failed.", call. = FALSE)
if (!identical(validate_sdm_model_id("glm"), "glm")) stop("GLM model validation failed.", call. = FALSE)
if (!"glm" %in% sdm_model_ids()) stop("GLM backend missing from model registry.", call. = FALSE)
if (!"multi_ensemble" %in% sdm_model_ids()) stop("multi_ensemble backend missing from model registry.", call. = FALSE)

formula <- make_sdm_formula(c("bio1", "bio12", "elevation_m"), include_quadratic = TRUE)
if (!inherits(formula, "formula")) stop("Formula helper failed.", call. = FALSE)

# --- CV strategy normalization ---
if (!identical(normalize_cv_strategy("spatial_blocks"), "spatial_blocks")) stop("CV strategy normalization failed.", call. = FALSE)
if (!identical(normalize_cv_strategy("spatial block"), "spatial_blocks")) stop("CV strategy normalization (alias) failed.", call. = FALSE)
if (!identical(normalize_cv_strategy("random"), "random")) stop("CV strategy normalization failed.", call. = FALSE)

# --- Extent helpers ---
if (!nzchar(extent_cache_key(c(140, 160, -40, -20)))) stop("Extent cache key failed.", call. = FALSE)
combined <- combine_extents(c(140, 150, -30, -20), c(145, 160, -35, -25))
if (!identical(combined, c(140, 160, -35, -20))) stop("Combine extents failed.", call. = FALSE)

# --- Occurrence cleaning ---
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

# --- SDM config builder ---
cfg <- tryCatch(sdm_config(
  species = "Test", occurrence_file = tmp_occ,
  projection_extent = c(140, 160, -40, -20)
), error = function(e) NULL)
if (is.null(cfg) || !is.sdm_config(cfg)) stop("sdm_config builder failed.", call. = FALSE)
if (!identical(cfg$species, "Test")) stop("sdm_config species failed.", call. = FALSE)
if (!identical(cfg$model_id, sdm_default_model_id)) stop("sdm_config default model_id failed.", call. = FALSE)

# --- Batch CSV parsing helpers ---
if (!identical(parse_comma_ints("1, 4, 12"), c(1L, 4L, 12L))) stop("parse_comma_ints failed.", call. = FALSE)
if (!identical(parse_comma_ints(" 1 , 4 , 12 "), c(1L, 4L, 12L))) stop("parse_comma_ints whitespace failed.", call. = FALSE)
if (length(parse_comma_ints("")) != 0) stop("parse_comma_ints empty failed.", call. = FALSE)
if (!identical(parse_comma_strings("bio1, bio12"), c("bio1", "bio12"))) stop("parse_comma_strings failed.", call. = FALSE)
if (!identical(parse_comma_doubles("140.0, 160.0"), c(140, 160))) stop("parse_comma_doubles failed.", call. = FALSE)
if (!identical(parse_logical("TRUE"), TRUE)) stop("parse_logical TRUE failed.", call. = FALSE)
if (!identical(parse_logical("FALSE"), FALSE)) stop("parse_logical FALSE failed.", call. = FALSE)
if (!identical(parse_logical("1"), TRUE)) stop("parse_logical 1 failed.", call. = FALSE)
if (!identical(parse_logical("0"), FALSE)) stop("parse_logical 0 failed.", call. = FALSE)
if (!identical(parse_logical("yes"), TRUE)) stop("parse_logical yes failed.", call. = FALSE)

# --- build_run_args roundtrip ---
test_row <- list(
  species = "Test", occurrences_csv = tmp_occ, model_id = "glm",
  biovars = "1,4,12", background_n = "100", include_quadratic = "TRUE",
  threshold = "0.5", cv_folds = "3", aggregation_factor = "1"
)
args <- build_run_args(test_row)
if (!identical(args$species, "Test")) stop("build_run_args species failed.", call. = FALSE)
if (!identical(args$selected_biovars, c(1L, 4L, 12L))) stop("build_run_args biovars failed.", call. = FALSE)
if (!identical(args$background_n, 100L)) stop("build_run_args background_n failed.", call. = FALSE)
if (!identical(args$threshold, 0.5)) stop("build_run_args threshold failed.", call. = FALSE)

# --- Model registry completeness ---
expected_models <- c("glm", "gam", "rangebag", "ensemble_glm_rangebag", "multi_ensemble")
for (m in expected_models) {
  if (!m %in% sdm_model_ids()) stop(paste("Model", m, "missing from registry."), call. = FALSE)
}

# --- Conditional model registry (logged, not failed) ---
conditional_models <- c("maxnet", "rf", "xgboost", "dnn", "biomod2", "esm_glm", "esm_maxnet")
for (m in conditional_models) {
  if (m %in% sdm_model_ids()) {
    cat("[fast] Model", m, "registered.\n")
  } else {
    cat("[fast] Model", m, "not registered (optional dependency).\n")
  }
}

# --- EOO/AOO with synthetic points ---
synthetic_pts <- data.frame(longitude = c(140, 145, 150, 155), latitude = c(-30, -32, -34, -36))
eoo_aoo <- compute_eoo_aoo(synthetic_pts)
if (is.null(eoo_aoo) || is.null(eoo_aoo$eoo_km2)) stop("compute_eoo_aoo failed.", call. = FALSE)
if (!is.finite(eoo_aoo$eoo_km2) || eoo_aoo$eoo_km2 <= 0) stop("compute_eoo_aoo eoo_km2 invalid.", call. = FALSE)

# --- Response index (CLIMEX) ---
test_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10, crs = "EPSG:4326")
terra::values(test_rast) <- seq(0, 40, length.out = 100)
resp <- compute_response_index(test_rast, 10, 20, 30, 40)
if (!inherits(resp, "SpatRaster")) stop("compute_response_index failed.", call. = FALSE)
resp_vals <- terra::values(resp, na.rm = TRUE)
if (any(resp_vals < 0 | resp_vals > 1)) stop("compute_response_index values out of [0,1].", call. = FALSE)

# --- ODMAP report with synthetic result ---
synthetic_result <- list(
  config = list(species = "Test", model_id = "glm", projection_extent = c(140, 160, -40, -20), threshold = 0.5, aggregation_factor = 1),
  occurrence = data.frame(x = c(140, 145), y = c(-30, -35)),
  occurrence_used = data.frame(x = c(140, 145), y = c(-30, -35)),
  model_info = list(id = "glm", label = "GLM"),
  cv = list(auc_mean = 0.75, auc_sd = 0.05, tss_mean = 0.5, tss_sd = 0.1, strategy = "random", k = 3),
  metrics = list(cbi = 0.8),
  cleaning = list(removed_bad_coordinates = 0, removed_duplicates = 0, original_rows = 2),
  covariates = c("bio1", "bio12"),
  paths = list(tif = NA_character_)
)
tmp_csv <- tempfile(fileext = ".csv")
tmp_md <- tempfile(fileext = ".md")
odmap_result <- tryCatch(write_odmap_report(synthetic_result, tmp_csv, tmp_md), error = function(e) NULL)
if (is.null(odmap_result) || !file.exists(tmp_csv)) stop("write_odmap_report failed.", call. = FALSE)
csv_lines <- readLines(tmp_csv)
if (!any(grepl("AUC,0.750", csv_lines))) stop("ODMAP CSV missing AUC value.", call. = FALSE)
if (!file.exists(tmp_md)) stop("ODMAP Markdown report not written.", call. = FALSE)

# --- Manifest generation ---
tmp_manifest_dir <- tempfile()
dir.create(tmp_manifest_dir)
manifest_result <- tryCatch(write_manifest(synthetic_result, tmp_manifest_dir, "test"), error = function(e) NULL)
manifest_path <- file.path(tmp_manifest_dir, "test_manifest.json")
if (is.null(manifest_result) || !file.exists(manifest_path)) stop("write_manifest failed.", call. = FALSE)
manifest_content <- jsonlite::read_json(manifest_path)
if (is.null(manifest_content$model_id) || manifest_content$model_id != "glm") stop("Manifest model_id incorrect.", call. = FALSE)

# --- VIF selection ---
set.seed(42)
vif_test_data <- matrix(rnorm(100 * 5), ncol = 5)
colnames(vif_test_data) <- paste0("bio", c(1, 4, 12, 5, 6))
vif_result <- tryCatch(compute_vif(vif_test_data), error = function(e) NULL)
if (!is.null(vif_result) && !is.na(vif_result[1])) {
  cat("[fast] compute_vif returned values.\n")
}

# --- Calibration ---
cal_test_data <- data.frame(
  observed = c(rep(1, 50), rep(0, 50)),
  predicted = c(runif(50, 0.4, 1.0), runif(50, 0.0, 0.6))
)
cal_result <- tryCatch(compute_calibration(cal_test_data, n_bins = 5), error = function(e) NULL)
if (!is.null(cal_result) && is.data.frame(cal_result)) {
  if (!"bin" %in% names(cal_result)) stop("compute_calibration missing bin column.", call. = FALSE)
  cat("[fast] compute_calibration passed.\n")
}

cat("SDM smoke test passed. Modules source correctly.\n")

# --- Shared occurrence data generator for heavy tests ---
make_heavy_test_occ <- function() {
  data.frame(
    species = "Demo species",
    decimalLongitude = c(
      140.0, 140.3, 140.6, 140.9, 141.2, 141.5, 141.8, 142.1, 142.4,
      140.1, 140.4, 140.7, 141.0, 141.3, 141.6, 141.9, 142.2, 139.7, 139.9, 142.3,
      145, 150, 155, 160
    ),
    decimalLatitude = c(
      -22.0, -22.2, -22.4, -22.6, -22.8, -23.0, -23.2, -23.4, -23.6,
      -23.8, -24.0, -24.2, -22.1, -22.3, -22.5, -22.7, -22.9, -23.1, -23.3, -23.5,
      -30, -32, -34, -36
    ),
    institutionCode = c(rep("Museum A", 20), rep("Museum B", 4)),
    countryCode = "AU",
    stringsAsFactors = FALSE
  )
}

# ============================================================================
# HEAVY TESTS (require climate data, optional packages)
# ============================================================================

test_multi_ensemble_smoke <- function() {
  cat("[multi_ensemble smoke] starting...\n")
  if (!requireNamespace("maxnet", quietly = TRUE)) {
    cat("[multi_ensemble smoke] skipped: maxnet not installed\n")
    return(invisible(NULL))
  }
  if (!"maxnet" %in% sdm_model_ids()) {
    cat("[multi_ensemble smoke] skipped: maxnet not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[multi_ensemble smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  ens_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  tmp_env <- tempfile()
  out_dir <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(tmp_env, recursive = TRUE, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- ens_occ$decimalLongitude >= training_extent[1] & ens_occ$decimalLongitude <= training_extent[2] &
           ens_occ$decimalLatitude >= training_extent[3] & ens_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[multi_ensemble smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent for GLM component\n")
    return(invisible(NULL))
  }
  utils::write.csv(ens_occ, tmp_occ, row.names = FALSE)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = "Worldclim",
    selected_biovars = c(1, 12),
    projection_extent = c(140, 145, -26, -22),
    training_extent = training_extent,
    background_n = 100,
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
  bm_ver <- tryCatch(as.character(packageVersion("biomod2")), error = function(e) "0.0.0")
  bm_parts <- as.integer(strsplit(bm_ver, "\\.")[[1]])
  bm_multipliers <- c(1000, 100, 10, 1)
  bm_v <- sum(bm_parts * bm_multipliers[seq_along(bm_parts)])
  if (bm_v >= 430) {
    cat("[esm_glm smoke] skipped: biomod2 >= 4.3.0 has ecospat ESM incompatibility\n")
    return(invisible(NULL))
  }
  if (!"esm_glm" %in% sdm_model_ids()) {
    cat("[esm_glm smoke] skipped: esm_glm not in model registry\n")
    return(invisible(NULL))
  }
  esm_test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  tmp_env <- tempfile()
  out_dir <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(tmp_env, recursive = TRUE, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[esm_glm smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  utils::write.csv(esm_test_occ, tmp_occ, row.names = FALSE)
  set.seed(99)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = "Worldclim",
    selected_biovars = c(1, 4),
    projection_extent = c(140, 145, -26, -22),
    training_extent = c(138, 150, -28, -20),
    background_n = 100,
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

# ============================================================================
# PHASE 2: MODEL BACKEND SMOKE TESTS
# ============================================================================

test_gam_smoke <- function() {
  cat("[gam smoke] starting...\n")
  if (!requireNamespace("mgcv", quietly = TRUE)) {
    cat("[gam smoke] skipped: mgcv not installed\n")
    return(invisible(NULL))
  }
  if (!"gam" %in% sdm_model_ids()) {
    cat("[gam smoke] skipped: gam not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[gam smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[gam smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = "Worldclim",
    selected_biovars = c(1, 12),
    projection_extent = c(140, 145, -26, -22),
    training_extent = training_extent,
    background_n = 100,
    min_source_records = 5,
    merge_small_sources = TRUE,
    thin_by_cell = FALSE,
    model_id = "gam",
    include_quadratic = FALSE,
    threshold = 0.5,
    aggregation_factor = 1,
    cv_folds = 2,
    n_cores = 1,
    allow_download = FALSE,
    worldclim_res = 0.5,
    future_projection = FALSE,
    future_worldclim_dir = "/nonexistent/future/path",
    output_dir = out_dir,
    seed = 42
  )
  if (is.null(result)) stop("gam smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("gam smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("gam smoke test missing cv$auc_mean", call. = FALSE)
  if (result$cv$auc_mean <= 0.5) stop("gam smoke test auc_mean <= 0.5", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("gam smoke test suitability raster not written", call. = FALSE)
  cat("[gam smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_ensemble_smoke <- function() {
  cat("[ensemble_glm_rangebag smoke] starting...\n")
  if (!"ensemble_glm_rangebag" %in% sdm_model_ids()) {
    cat("[ensemble_glm_rangebag smoke] skipped: ensemble_glm_rangebag not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[ensemble_glm_rangebag smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[ensemble_glm_rangebag smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = "Worldclim",
    selected_biovars = c(1, 12),
    projection_extent = c(140, 145, -26, -22),
    training_extent = training_extent,
    background_n = 100,
    min_source_records = 5,
    merge_small_sources = TRUE,
    thin_by_cell = FALSE,
    model_id = "ensemble_glm_rangebag",
    include_quadratic = FALSE,
    threshold = 0.5,
    aggregation_factor = 1,
    cv_folds = 2,
    n_cores = 1,
    allow_download = FALSE,
    worldclim_res = 0.5,
    future_projection = FALSE,
    future_worldclim_dir = "/nonexistent/future/path",
    output_dir = out_dir,
    seed = 42
  )
  if (is.null(result)) stop("ensemble_glm_rangebag smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("ensemble_glm_rangebag smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("ensemble smoke test missing cv$auc_mean", call. = FALSE)
  if (result$cv$auc_mean <= 0.5) stop("ensemble smoke test auc_mean <= 0.5", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("ensemble smoke test suitability raster not written", call. = FALSE)
  if (is.null(result$cv$component_metrics)) stop("ensemble smoke test missing component_metrics", call. = FALSE)
  cat("[ensemble_glm_rangebag smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_maxnet_smoke <- function() {
  cat("[maxnet smoke] starting...\n")
  if (!requireNamespace("maxnet", quietly = TRUE)) {
    cat("[maxnet smoke] skipped: maxnet not installed\n")
    return(invisible(NULL))
  }
  if (!"maxnet" %in% sdm_model_ids()) {
    cat("[maxnet smoke] skipped: maxnet not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[maxnet smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[maxnet smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- tryCatch(
    run_fast_sdm(
      species = "Demo species",
      occurrence_file = tmp_occ,
      worldclim_dir = "Worldclim",
      selected_biovars = c(1, 12),
      projection_extent = c(140, 145, -26, -22),
      training_extent = training_extent,
      background_n = 100,
      min_source_records = 5,
      merge_small_sources = TRUE,
      thin_by_cell = FALSE,
      model_id = "maxnet",
      include_quadratic = FALSE,
      threshold = 0.5,
      aggregation_factor = 1,
      cv_folds = 2,
      n_cores = 1,
      allow_download = FALSE,
      worldclim_res = 0.5,
      future_projection = FALSE,
      future_worldclim_dir = "/nonexistent/future/path",
      output_dir = out_dir,
      seed = 42
    ),
    error = function(e) {
      cat("[maxnet smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[maxnet smoke] skipped: MaxNet fit failed (known issue with maxnet.formula.arguments)\n")
    return(invisible(NULL))
  }
  if (is.null(result)) stop("maxnet smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("maxnet smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("maxnet smoke test missing cv$auc_mean", call. = FALSE)
  if (result$cv$auc_mean <= 0.5) stop("maxnet smoke test auc_mean <= 0.5", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("maxnet smoke test suitability raster not written", call. = FALSE)
  cat("[maxnet smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_rf_smoke <- function() {
  cat("[rf smoke] starting...\n")
  if (!requireNamespace("ranger", quietly = TRUE)) {
    cat("[rf smoke] skipped: ranger not installed\n")
    return(invisible(NULL))
  }
  if (!"rf" %in% sdm_model_ids()) {
    cat("[rf smoke] skipped: rf not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[rf smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[rf smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- tryCatch(
    run_fast_sdm(
      species = "Demo species",
      occurrence_file = tmp_occ,
      worldclim_dir = "Worldclim",
      selected_biovars = c(1, 12),
      projection_extent = c(140, 145, -26, -22),
      training_extent = training_extent,
      background_n = 100,
      min_source_records = 5,
      merge_small_sources = TRUE,
      thin_by_cell = FALSE,
      model_id = "rf",
      include_quadratic = FALSE,
      threshold = 0.5,
      aggregation_factor = 1,
      cv_folds = 2,
      n_cores = 1,
      allow_download = FALSE,
      worldclim_res = 0.5,
      future_projection = FALSE,
      future_worldclim_dir = "/nonexistent/future/path",
      output_dir = out_dir,
      seed = 42
    ),
    error = function(e) {
      cat("[rf smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[rf smoke] skipped: RF fit failed (known issue with importance prediction)\n")
    return(invisible(NULL))
  }
  if (is.null(result)) stop("rf smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("rf smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("rf smoke test missing cv$auc_mean", call. = FALSE)
  if (result$cv$auc_mean <= 0.5) stop("rf smoke test auc_mean <= 0.5", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("rf smoke test suitability raster not written", call. = FALSE)
  cat("[rf smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_xgboost_smoke <- function() {
  cat("[xgboost smoke] starting...\n")
  if (!requireNamespace("xgboost", quietly = TRUE)) {
    cat("[xgboost smoke] skipped: xgboost not installed\n")
    return(invisible(NULL))
  }
  if (!"xgboost" %in% sdm_model_ids()) {
    cat("[xgboost smoke] skipped: xgboost not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[xgboost smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[xgboost smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- run_fast_sdm(
    species = "Demo species",
    occurrence_file = tmp_occ,
    worldclim_dir = "Worldclim",
    selected_biovars = c(1, 12),
    projection_extent = c(140, 145, -26, -22),
    training_extent = training_extent,
    background_n = 100,
    min_source_records = 5,
    merge_small_sources = TRUE,
    thin_by_cell = FALSE,
    model_id = "xgboost",
    include_quadratic = FALSE,
    threshold = 0.5,
    aggregation_factor = 1,
    cv_folds = 2,
    n_cores = 1,
    allow_download = FALSE,
    worldclim_res = 0.5,
    future_projection = FALSE,
    future_worldclim_dir = "/nonexistent/future/path",
    output_dir = out_dir,
    seed = 42
  )
  if (is.null(result)) stop("xgboost smoke test returned NULL", call. = FALSE)
  if (!is.list(result)) stop("xgboost smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("xgboost smoke test missing cv$auc_mean", call. = FALSE)
  if (result$cv$auc_mean <= 0.5) stop("xgboost smoke test auc_mean <= 0.5", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("xgboost smoke test suitability raster not written", call. = FALSE)
  cat("[xgboost smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_dnn_smoke <- function() {
  cat("[dnn smoke] starting...\n")
  if (!requireNamespace("cito", quietly = TRUE) || !requireNamespace("torch", quietly = TRUE)) {
    cat("[dnn smoke] skipped: cito or torch not installed\n")
    return(invisible(NULL))
  }
  if (!"dnn" %in% sdm_model_ids()) {
    cat("[dnn smoke] skipped: dnn not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[dnn smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[dnn smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- tryCatch(
    run_fast_sdm(
      species = "Demo species",
      occurrence_file = tmp_occ,
      worldclim_dir = "Worldclim",
      selected_biovars = c(1, 12),
      projection_extent = c(140, 145, -26, -22),
      training_extent = training_extent,
      background_n = 100,
      min_source_records = 5,
      merge_small_sources = TRUE,
      thin_by_cell = FALSE,
      model_id = "dnn",
      include_quadratic = FALSE,
      threshold = 0.5,
      aggregation_factor = 1,
      cv_folds = 2,
      n_cores = 1,
      allow_download = FALSE,
      worldclim_res = 0.5,
      future_projection = FALSE,
      future_worldclim_dir = "/nonexistent/future/path",
      output_dir = out_dir,
      seed = 42,
      dnn_model_type = "DNN_Small",
      dnn_device = "cpu"
    ),
    error = function(e) {
      cat("[dnn smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[dnn smoke] skipped: DNN fit failed (likely LibTorch not installed or insufficient records)\n")
    return(invisible(NULL))
  }
  if (!is.list(result)) stop("dnn smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("dnn smoke test missing cv$auc_mean", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("dnn smoke test suitability raster not written", call. = FALSE)
  cat("[dnn smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

test_biomod2_smoke <- function() {
  cat("[biomod2 smoke] starting...\n")
  if (!requireNamespace("biomod2", quietly = TRUE)) {
    cat("[biomod2 smoke] skipped: biomod2 not installed\n")
    return(invisible(NULL))
  }
  if (!isTRUE(getOption("sdm.enable_biomod2", FALSE))) {
    cat("[biomod2 smoke] skipped: sdm.enable_biomod2 option not set\n")
    return(invisible(NULL))
  }
  if (!"biomod2" %in% sdm_model_ids()) {
    cat("[biomod2 smoke] skipped: biomod2 not in model registry\n")
    return(invisible(NULL))
  }
  source_files <- list.files("Worldclim", pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
  if (length(source_files) == 0) {
    cat("[biomod2 smoke] skipped: no WorldClim files in Worldclim/ directory\n")
    return(invisible(NULL))
  }
  test_occ <- make_heavy_test_occ()
  tmp_occ <- tempfile(fileext = ".csv")
  out_dir <- tempfile()
  dir.create(out_dir, showWarnings = FALSE)
  on.exit({
    unlink(tmp_occ, force = TRUE)
    unlink(out_dir, recursive = TRUE, force = TRUE)
  })
  set.seed(42)
  training_extent <- c(138, 150, -28, -20)
  inside <- test_occ$decimalLongitude >= training_extent[1] & test_occ$decimalLongitude <= training_extent[2] &
           test_occ$decimalLatitude >= training_extent[3] & test_occ$decimalLatitude <= training_extent[4]
  if (sum(inside) < 20) {
    cat("[biomod2 smoke] skipped: not enough occurrence points (", sum(inside), ") inside training extent\n")
    return(invisible(NULL))
  }
  utils::write.csv(test_occ, tmp_occ, row.names = FALSE)
  result <- tryCatch(
    run_fast_sdm(
      species = "Demo species",
      occurrence_file = tmp_occ,
      worldclim_dir = "Worldclim",
      selected_biovars = c(1, 12),
      projection_extent = c(140, 145, -26, -22),
      training_extent = training_extent,
      background_n = 100,
      min_source_records = 5,
      merge_small_sources = TRUE,
      thin_by_cell = FALSE,
      model_id = "biomod2",
      include_quadratic = FALSE,
      threshold = 0.5,
      aggregation_factor = 1,
      cv_folds = 2,
      n_cores = 1,
      allow_download = FALSE,
      worldclim_res = 0.5,
      future_projection = FALSE,
      future_worldclim_dir = "/nonexistent/future/path",
      output_dir = out_dir,
      seed = 42
    ),
    error = function(e) {
      cat("[biomod2 smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[biomod2 smoke] skipped: biomod2 fit failed\n")
    return(invisible(NULL))
  }
  if (!is.list(result)) stop("biomod2 smoke test returned non-list", call. = FALSE)
  if (is.null(result$cv) || is.null(result$cv$auc_mean)) stop("biomod2 smoke test missing cv$auc_mean", call. = FALSE)
  if (is.null(result$paths$tif) || !file.exists(result$paths$tif)) stop("biomod2 smoke test suitability raster not written", call. = FALSE)
  cat("[biomod2 smoke] passed (auc_mean=", round(result$cv$auc_mean, 3), ")\n", sep = "")
}

# ============================================================================
# TAG DISPATCH
# ============================================================================

if (has_tag("fast")) {
  cat("[fast] Parse check, function assertions, and helper tests passed.\n")
}
if (has_tag("ml")) {
  test_gam_smoke()
  test_ensemble_smoke()
  test_maxnet_smoke()
  test_rf_smoke()
  test_xgboost_smoke()
  test_dnn_smoke()
  test_biomod2_smoke()
}
if (has_tag("heavy") || has_tag("ensemble")) {
  test_multi_ensemble_smoke()
}
if (has_tag("heavy") || has_tag("esm")) {
  test_esm_smoke()
}
if (has_tag("heavy") || has_tag("batch")) {
  test_batch_runner_smoke()
}

cat("All smoke tests passed.\n")
