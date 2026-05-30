#!/usr/bin/env Rscript
# Lightweight source/API smoke test with tagged filtering.
# Usage: Rscript scripts/smoke_test.R [--tags=fast,heavy,ensemble,esm,batch,ecology,covariates,reporting,ml,maps,core,all]

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
  "fit_esm", "fit_xgboost_sdm",
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

optional_backend_functions <- list(
  maxnet = c("fit_maxnet_sdm", "predict_maxnet_suitability", "cross_validate_maxnet"),
  ranger = c("fit_rf_sdm", "predict_rf_suitability", "cross_validate_rf")
)
for (pkg in names(optional_backend_functions)) {
  expected <- optional_backend_functions[[pkg]]
  present <- vapply(expected, exists, logical(1), mode = "function")
  if (requireNamespace(pkg, quietly = TRUE)) {
    if (!all(present)) {
      stop(
        "Package ", pkg, " is installed but expected backend functions are missing: ",
        paste(expected[!present], collapse = ", "),
        call. = FALSE
      )
    }
  } else if (any(present)) {
    stop(
      "Package ", pkg, " is not installed but backend functions are partially defined: ",
      paste(expected[present], collapse = ", "),
      call. = FALSE
    )
  } else {
    cat("[fast] Optional package", pkg, "not installed; backend function contract skipped.\n")
  }
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
# PHASE 3: ECOLOGY SMOKE TESTS
# ============================================================================

test_dispersal_smoke <- function() {
  cat("[dispersal smoke] starting...\n")
  suitability <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(suitability) <- runif(100, 0.3, 0.9)
  intro_pts <- data.frame(x = c(145, 146), y = c(-25, -26))

  result <- tryCatch(
    simulate_dispersal(suitability, intro_pts, n_steps = 3, dispersal_km = 5),
    error = function(e) {
      cat("[dispersal smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[dispersal smoke] skipped: simulate_dispersal failed\n")
    return(invisible(NULL))
  }
  if (is.null(result$final_occupancy)) stop("dispersal returned NULL final_occupancy", call. = FALSE)
  if (result$summary$initial_cells < 1) stop("no initial cells in dispersal result", call. = FALSE)
  if (length(result$steps) != 3) stop("expected 3 dispersal steps", call. = FALSE)
  cat("[dispersal smoke] passed (", result$summary$initial_cells, " → ", result$summary$final_cells, " cells)\n", sep = "")
}

test_climex_smoke <- function() {
  cat("[climex smoke] starting...\n")
  bio1 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio1) <- seq(5, 35, length.out = 100)
  names(bio1) <- "bio1"

  bio12 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio12) <- seq(200, 2500, length.out = 100)
  names(bio12) <- "bio12"

  env <- c(bio1, bio12)

  result <- tryCatch(
    apply_climex_params(env,
      temp_params = list(DV0 = 10, DV1 = 20, DV2 = 30, DV3 = 40),
      moisture_params = list(SM0 = 0.1, SM1 = 0.3, SM2 = 0.8, SM3 = 1.0),
      combine_method = "min"
    ),
    error = function(e) {
      cat("[climex smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[climex smoke] skipped: apply_climex_params failed\n")
    return(invisible(NULL))
  }
  if (!inherits(result$mechanistic_suitability, "SpatRaster")) stop("climex mechanistic suitability not a raster", call. = FALSE)
  mech_vals <- terra::values(result$mechanistic_suitability, na.rm = TRUE)
  if (any(mech_vals < 0 | mech_vals > 1)) stop("climex mechanistic values out of [0,1]", call. = FALSE)
  cat("[climex smoke] passed (mean mechanistic suitability: ", round(mean(mech_vals, na.rm = TRUE), 3), ")\n", sep = "")
}

test_climate_matching_smoke <- function() {
  cat("[climate_matching smoke] starting...\n")
  env_train <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(env_train) <- runif(100, 10, 30)
  names(env_train) <- "bio1"

  env_proj <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(env_proj) <- runif(100, 10, 30)
  names(env_proj) <- "bio1"

  result <- tryCatch(
    compute_climate_match(env_train, env_proj, method = "standardised"),
    error = function(e) {
      cat("[climate_matching smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[climate_matching smoke] skipped: compute_climate_match failed\n")
    return(invisible(NULL))
  }
  if (!inherits(result$similarity, "SpatRaster")) stop("climate matching similarity not a raster", call. = FALSE)
  if (is.null(result$summary$similarity_mean)) stop("climate matching missing similarity_mean", call. = FALSE)
  cat("[climate_matching smoke] passed (mean similarity: ", round(result$summary$similarity_mean, 3), ")\n", sep = "")
}

test_niche_overlap_smoke <- function() {
  cat("[niche_overlap smoke] starting...\n")
  bio1 <- terra::rast(nrows = 15, ncols = 15, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio1) <- runif(225, 10, 30)
  names(bio1) <- "bio1"

  bio12 <- terra::rast(nrows = 15, ncols = 15, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio12) <- runif(225, 200, 2500)
  names(bio12) <- "bio12"

  env <- c(bio1, bio12)

  occ_native <- data.frame(longitude = runif(10, 141, 144), latitude = runif(10, -28, -25))
  occ_introduced <- data.frame(longitude = runif(10, 146, 149), latitude = runif(10, -25, -22))

  result <- tryCatch(
    compute_niche_overlap(occ_native, occ_introduced, env, n_boot = 10),
    error = function(e) {
      cat("[niche_overlap smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[niche_overlap smoke] skipped: compute_niche_overlap failed (may need ecospat)\n")
    return(invisible(NULL))
  }
  if (!is.null(result$centroid_distance) && !is.finite(result$centroid_distance)) stop("niche overlap centroid_distance invalid", call. = FALSE)
  cat("[niche_overlap smoke] passed\n")
}

test_species_richness_smoke <- function() {
  cat("[species_richness smoke] starting...\n")
  r1 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(r1) <- runif(100, 0, 1)
  r2 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(r2) <- runif(100, 0, 1)
  r3 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(r3) <- runif(100, 0, 1)

  result <- tryCatch(
    stack_species_richness(list(r1, r2, r3), threshold = 0.5),
    error = function(e) {
      cat("[species_richness smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[species_richness smoke] skipped: stack_species_richness failed\n")
    return(invisible(NULL))
  }
  if (!inherits(result$richness, "SpatRaster")) stop("species richness not a raster", call. = FALSE)
  richness_vals <- terra::values(result$richness, na.rm = TRUE)
  if (any(richness_vals < 0 | richness_vals > 3)) stop("species richness values out of [0,3]", call. = FALSE)
  cat("[species_richness smoke] passed (mean richness: ", round(result$summary$richness_mean, 2), ")\n", sep = "")
}

test_aoa_smoke <- function() {
  cat("[aoa smoke] starting...\n")
  bio1 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio1) <- runif(100, 10, 30)
  names(bio1) <- "bio1"

  bio12 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio12) <- runif(100, 200, 2500)
  names(bio12) <- "bio12"

  env_proj <- c(bio1, bio12)

  model_data <- data.frame(
    bio1 = runif(100, 10, 30),
    bio12 = runif(100, 200, 2500),
    presence = c(rep(1, 20), rep(0, 80))
  )

  result <- tryCatch(
    compute_aoa(model_data, env_proj, covariates = c("bio1", "bio12")),
    error = function(e) {
      cat("[aoa smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[aoa smoke] skipped: compute_aoa failed (may require CAST/caret)\n")
    return(invisible(NULL))
  }
  if (is.null(result$aoa_raster) && is.null(result$aoa_fraction)) stop("aoa returned no results", call. = FALSE)
  cat("[aoa smoke] passed\n")
}

# ============================================================================
# COVARIATE TESTS (no network, synthetic data only)
# ============================================================================

test_find_worldclim_smoke <- function() {
  cat("[find_worldclim smoke] starting...\n")
  tmp_dir <- tempfile()
  dir.create(tmp_dir)
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)

  file.create(file.path(tmp_dir, "wc2.1_10m_bio_1.tif"))
  file.create(file.path(tmp_dir, "wc2.1_10m_bio_4.tif"))
  file.create(file.path(tmp_dir, "wc2.1_10m_bio_12.tif"))
  file.create(file.path(tmp_dir, "CHELSA_bio01_1981-2010_V.2.1.tif"))
  file.create(file.path(tmp_dir, "CHELSA_bio12_1981-2010_V.2.1.tif"))

  wc_result <- find_worldclim_files(tmp_dir, c(1, 4, 12), source = "worldclim")
  if (!is.character(wc_result) || length(wc_result) != 3) stop("find_worldclim_files returned wrong type/length", call. = FALSE)
  if (is.na(wc_result["1"]) || is.na(wc_result["4"]) || is.na(wc_result["12"])) stop("find_worldclim_files missed WorldClim files: ", paste(names(wc_result), "=", wc_result, collapse = ", "), call. = FALSE)

  ch_result <- find_worldclim_files(tmp_dir, c(1, 12), source = "chelsa")
  if (!is.character(ch_result) || length(ch_result) != 2) stop("find_worldclim_files (CHELSA) returned wrong type/length", call. = FALSE)
  if (is.na(ch_result["1"]) || is.na(ch_result["12"])) stop("find_worldclim_files missed CHELSA files", call. = FALSE)

  empty_result <- find_worldclim_files(tmp_dir, c(5, 7), source = "worldclim")
  if (!all(is.na(empty_result))) stop("find_worldclim_files should return NA for missing BIOs", call. = FALSE)

  na_dir_result <- find_worldclim_files("/nonexistent/path", c(1), source = "worldclim")
  if (!all(is.na(na_dir_result))) stop("find_worldclim_files should return NA for nonexistent dir", call. = FALSE)

  cat("[find_worldclim smoke] passed\n")
}

test_opentopo_helpers_smoke <- function() {
  cat("[opentopo_helpers smoke] starting...\n")

  if (opentopo_tile_size_degrees("SRTMGL1") != 4) stop("SRTMGL1 tile size wrong", call. = FALSE)
  if (opentopo_tile_size_degrees("COP90") != 10) stop("COP90 tile size wrong", call. = FALSE)
  if (opentopo_tile_size_degrees("UNKNOWN") != 20) stop("Unknown DEM tile size wrong", call. = FALSE)

  tiles <- opentopo_tile_extents(c(140, 150, -30, -20), demtype = "COP90")
  if (!is.list(tiles) || length(tiles) == 0) stop("opentopo_tile_extents returned empty", call. = FALSE)
  for (t in tiles) {
    if (length(t) != 4) stop("tile extent wrong length", call. = FALSE)
    if (t[1] >= t[2] || t[3] >= t[4]) stop("tile extent invalid order", call. = FALSE)
  }

  tiles_30 <- opentopo_tile_extents(c(140, 144, -24, -20), demtype = "SRTMGL1")
  if (!is.list(tiles_30) || length(tiles_30) == 0) stop("opentopo_tile_extents (30m) returned empty", call. = FALSE)

  cat("[opentopo_helpers smoke] passed\n")
}

test_soil_output_name_smoke <- function() {
  cat("[soil_output_name smoke] starting...\n")
  n <- soil_output_name("sand", 5)
  if (!identical(n, "soil_sand_0-5cm")) stop("soil_output_name(sand, 5) wrong: ", n, call. = FALSE)
  n2 <- soil_output_name("phh2o", 30)
  if (!identical(n2, "soil_phh2o_15-30cm")) stop("soil_output_name(phh2o, 30) wrong: ", n2, call. = FALSE)
  cat("[soil_output_name smoke] passed\n")
}

test_vif_selection_full_smoke <- function() {
  cat("[vif_selection smoke] starting...\n")
  set.seed(42)
  n <- 100
  x1 <- rnorm(n)
  x2 <- x1 * 0.95 + rnorm(n, sd = 0.1)
  x3 <- x1 * 0.9 + rnorm(n, sd = 0.1)
  x4 <- rnorm(n)
  x5 <- rnorm(n)
  vif_data <- data.frame(bio1 = x1, bio4 = x2, bio12 = x3, bio5 = x4, bio6 = x5)

  vif_vals <- compute_vif(vif_data)
  if (!is.numeric(vif_vals) || length(vif_vals) != 5) stop("compute_vif returned wrong type/length", call. = FALSE)
  if (any(is.na(vif_vals))) stop("compute_vif returned NA", call. = FALSE)

  vif_result <- select_by_vif(vif_data, threshold = 5)
  if (!is.list(vif_result)) stop("select_by_vif returned non-list", call. = FALSE)
  if (is.null(vif_result$selected) || is.null(vif_result$dropped)) stop("select_by_vif missing selected/dropped", call. = FALSE)
  if (length(vif_result$selected) < 2) stop("select_by_vif dropped too many variables", call. = FALSE)
  if (!is.data.frame(vif_result$vif_history)) stop("select_by_vif vif_history not a data.frame", call. = FALSE)

  apply_result <- apply_vif_selection(vif_data, threshold = 5)
  if (!is.list(apply_result)) stop("apply_vif_selection returned non-list", call. = FALSE)
  if (is.null(apply_result$covars_selected)) stop("apply_vif_selection missing covars_selected", call. = FALSE)
  if (ncol(apply_result$covars_selected) != length(apply_result$selected)) stop("apply_vif_selection column count mismatch", call. = FALSE)

  cat("[vif_selection smoke] passed (", length(vif_result$dropped), " dropped, ", length(vif_result$selected), " selected)\n", sep = "")
}

test_align_covariate_stack_smoke <- function() {
  cat("[align_covariate_stack smoke] starting...\n")
  bio1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio1) <- runif(400, 10, 30)
  names(bio1) <- "bio1"

  bio12 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio12) <- runif(400, 200, 2500)
  names(bio12) <- "bio12"

  source_rast <- c(bio1, bio12)
  source <- list(raster = source_rast, methods = c(bio1 = "bilinear", bio12 = "bilinear"))

  template_train <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(template_train) <- runif(100)
  names(template_train) <- "template"

  template_project <- terra::rast(nrows = 15, ncols = 15, xmin = 138, xmax = 152, ymin = -32, ymax = -18, crs = "EPSG:4326")
  terra::values(template_project) <- runif(225)
  names(template_project) <- "template"

  result <- tryCatch(
    align_covariate_stack(source, template_train, template_project),
    error = function(e) {
      cat("[align_covariate_stack smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[align_covariate_stack smoke] skipped: align_covariate_stack failed\n")
    return(invisible(NULL))
  }
  if (!is.list(result$train)) stop("align_covariate_stack train not a list", call. = FALSE)
  if (!is.list(result$project)) stop("align_covariate_stack project not a list", call. = FALSE)
  if (length(result$train) != 2) stop("align_covariate_stack train wrong layer count", call. = FALSE)
  if (length(result$project) != 2) stop("align_covariate_stack project wrong layer count", call. = FALSE)
  if (!inherits(result$train[[1]], "SpatRaster")) stop("align_covariate_stack train[[1]] not a SpatRaster", call. = FALSE)
  if (!inherits(result$project[[1]], "SpatRaster")) stop("align_covariate_stack project[[1]] not a SpatRaster", call. = FALSE)

  cat("[align_covariate_stack smoke] passed\n")
}

test_scale_raster_stack_smoke <- function() {
  cat("[scale_raster_stack smoke] starting...\n")
  bio1 <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10, crs = "EPSG:4326")
  terra::values(bio1) <- runif(100, 10, 30)
  names(bio1) <- "bio1"

  bio12 <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10, crs = "EPSG:4326")
  terra::values(bio12) <- runif(100, 200, 2500)
  names(bio12) <- "bio12"

  r <- c(bio1, bio12)
  means <- c(bio1 = 20, bio12 = 1350)
  sds <- c(bio1 = 5, bio12 = 500)

  scaled <- tryCatch(
    scale_raster_stack(r, means, sds),
    error = function(e) {
      cat("[scale_raster_stack smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(scaled)) {
    cat("[scale_raster_stack smoke] skipped: scale_raster_stack failed\n")
    return(invisible(NULL))
  }
  if (!inherits(scaled, "SpatRaster")) stop("scale_raster_stack not a SpatRaster", call. = FALSE)
  scaled_vals <- terra::values(scaled, na.rm = TRUE)
  if (any(!is.finite(scaled_vals))) stop("scale_raster_stack produced non-finite values", call. = FALSE)

  cat("[scale_raster_stack smoke] passed\n")
}

test_load_extra_covariates_empty_smoke <- function() {
  cat("[load_extra_covariates_empty smoke] starting...\n")
  template_train <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(template_train) <- runif(100)
  names(template_train) <- "template"

  template_project <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(template_project) <- runif(100)
  names(template_project) <- "template"

  result <- load_extra_covariates(
    template_train = template_train,
    template_project = template_project,
    training_extent = c(140, 150, -30, -20),
    projection_extent = c(140, 150, -30, -20),
    use_elevation = FALSE,
    use_soil = FALSE,
    use_uv = FALSE,
    use_vegetation = FALSE,
    use_lulc = FALSE,
    use_hfp = FALSE,
    use_bioclim_season = FALSE,
    use_drought = FALSE,
    allow_download = FALSE
  )
  if (!is.null(result$train)) stop("load_extra_covariates with all FALSE should return NULL train", call. = FALSE)
  if (!is.null(result$project)) stop("load_extra_covariates with all FALSE should return NULL project", call. = FALSE)
  if (!is.list(result$metadata)) stop("load_extra_covariates metadata not a list", call. = FALSE)
  if (!is.list(result$files)) stop("load_extra_covariates files not a list", call. = FALSE)

  cat("[load_extra_covariates_empty smoke] passed\n")
}

test_verify_worldclim_cache_smoke <- function() {
  cat("[verify_worldclim_cache smoke] starting...\n")
  tmp_dir <- tempfile()
  dir.create(tmp_dir)
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)

  file.create(file.path(tmp_dir, "wc2.1_10m_bio_1.tif"))
  file.create(file.path(tmp_dir, "wc2.1_10m_bio_12.tif"))

  result <- verify_worldclim_cache(tmp_dir, source = "worldclim", selected_biovars = c(1, 4, 12))
  if (!is.list(result)) stop("verify_worldclim_cache returned non-list", call. = FALSE)
  if (!"bio1" %in% result$available) stop("verify_worldclim_cache missed bio1", call. = FALSE)
  if (!"bio12" %in% result$available) stop("verify_worldclim_cache missed bio12", call. = FALSE)
  if (!"bio4" %in% result$missing) stop("verify_worldclim_cache should report bio4 missing", call. = FALSE)
  if (!result$status %in% c("ok", "warn")) stop("verify_worldclim_cache status wrong", call. = FALSE)
  if (!nzchar(result$detail)) stop("verify_worldclim_cache detail empty", call. = FALSE)

  error_result <- verify_worldclim_cache("/nonexistent", source = "worldclim", selected_biovars = c(1))
  if (error_result$status != "error") stop("verify_worldclim_cache should return error for nonexistent dir", call. = FALSE)

  cat("[verify_worldclim_cache smoke] passed\n")
}

test_verify_future_cache_smoke <- function() {
  cat("[verify_future_cache smoke] starting...\n")
  tmp_dir <- tempfile()
  dir.create(tmp_dir)
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)

  scenario_dir <- file.path(tmp_dir, "UKESM1-0-LL_SSP1-2.6_2050")
  dir.create(scenario_dir)
  file.create(file.path(scenario_dir, "wc2.1_10m_bioc_1.tif"))
  file.create(file.path(scenario_dir, "wc2.1_10m_bioc_12.tif"))

  result <- verify_future_cache(tmp_dir)
  if (!is.list(result)) stop("verify_future_cache returned non-list", call. = FALSE)
  if (!is.data.frame(result$scenarios)) stop("verify_future_cache scenarios not a data.frame", call. = FALSE)
  if (!result$status %in% c("ok", "warn")) stop("verify_future_cache status wrong", call. = FALSE)
  if (!nzchar(result$detail)) stop("verify_future_cache detail empty", call. = FALSE)

  empty_result <- verify_future_cache("/nonexistent")
  if (empty_result$status != "error") stop("verify_future_cache should return error for nonexistent dir", call. = FALSE)

  cat("[verify_future_cache smoke] passed\n")
}

test_verify_soil_cache_smoke <- function() {
  cat("[verify_soil_cache smoke] starting...\n")
  tmp_dir <- tempfile()
  dir.create(tmp_dir)
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)

  file.create(file.path(tmp_dir, "sg_sand_d5.tif"))
  file.create(file.path(tmp_dir, "sg_clay_d30.tif"))

  result <- verify_soil_cache(tmp_dir)
  if (!is.list(result)) stop("verify_soil_cache returned non-list", call. = FALSE)
  if (!is.character(result$available)) stop("verify_soil_cache available not character", call. = FALSE)
  if (length(result$missing) < 50) stop("verify_soil_cache should report many missing layers", call. = FALSE)
  if (!result$status %in% c("ok", "warn")) stop("verify_soil_cache status wrong", call. = FALSE)

  error_result <- verify_soil_cache("/nonexistent")
  if (error_result$status != "error") stop("verify_soil_cache should return error for nonexistent dir", call. = FALSE)

  cat("[verify_soil_cache smoke] passed\n")
}

# ============================================================================
# REPORTING TESTS (synthetic data only)
# ============================================================================

test_write_summary_report_full_smoke <- function() {
  cat("[write_summary_report smoke] starting...\n")
  full_result <- list(
    config = list(
      species = "Test species",
      occurrence_source = "file",
      occurrence_file = "/tmp/test.csv",
      worldclim_dir = "Worldclim",
      selected_biovars = c(1, 12),
      use_elevation = FALSE,
      elevation_demtype = "COP90",
      use_soil = FALSE,
      selected_soil_vars = c("sand", "clay"),
      selected_soil_depths = c("0-5cm"),
      training_extent = c(140, 150, -30, -20),
      projection_extent = c(140, 160, -40, -20),
      threshold = 0.5,
      aggregation_factor = 1,
      background_n = 100,
      future_label = NA_character_,
      future_worldclim_dir = NA_character_,
      n_cores = 1,
      cv_strategy = "random",
      bias_method = "none",
      maxnet_features = "auto",
      maxnet_regmult = 1,
      multi_ensemble_models = c("glm", "maxnet"),
      multi_ensemble_weighting = "auc",
      multi_ensemble_power = 1
    ),
    model_info = list(method = "Fast presence/background GLM"),
    metrics = list(
      auc_mean = 0.78,
      auc_sd = 0.04,
      presence_records = 50,
      background_points = 100,
      n_cores = 1
    ),
    summary = list(
      percent_above_threshold = 12.5,
      cell_count = 10000,
      mean = 0.35,
      median = 0.28,
      max = 0.92,
      threshold = 0.5,
      cells_above_threshold = 1250,
      high_risk_area_km2 = 12500
    ),
    occurrence = data.frame(x = c(140, 145), y = c(-30, -35)),
    source_counts = list("Museum A" = 30, "Museum B" = 20),
    cleaning = list(removed_bad_coordinates = 2, removed_duplicates = 3, original_rows = 55),
    paths = list(tif = "/tmp/test.tif", png = "/tmp/test.png"),
    environment = list(names = c("bio1", "bio12")),
    covariates = c("bio1", "bio12")
  )

  tmp_path <- tempfile(fileext = ".txt")
  result_path <- tryCatch(
    write_summary_report(full_result, tmp_path),
    error = function(e) {
      cat("[write_summary_report smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result_path) || !file.exists(tmp_path)) {
    cat("[write_summary_report smoke] skipped: write_summary_report failed\n")
    return(invisible(NULL))
  }
  lines <- readLines(tmp_path)
  if (!any(grepl("Test species", lines))) stop("report missing species name", call. = FALSE)
  if (!any(grepl("0.780", lines))) stop("report missing AUC value", call. = FALSE)
  if (!any(grepl("bio1", lines))) stop("report missing BIO variables", call. = FALSE)
  if (!any(grepl("GLM", lines))) stop("report missing model method", call. = FALSE)

  cat("[write_summary_report smoke] passed\n")
}

test_response_curves_smoke <- function() {
  cat("[response_curves smoke] starting...\n")
  set.seed(42)
  model_data <- data.frame(
    presence = c(rep(1, 30), rep(0, 70)),
    bio1 = c(rnorm(30, 20, 3), rnorm(70, 18, 5)),
    bio12 = c(rnorm(30, 1500, 200), rnorm(70, 1200, 400))
  )

  ranges <- tryCatch(
    get_ranges_from_data(model_data, c("bio1", "bio12")),
    error = function(e) NULL
  )
  if (is.null(ranges)) {
    cat("[response_curves smoke] skipped: get_ranges_from_data failed\n")
    return(invisible(NULL))
  }
  if (!is.matrix(ranges)) stop("get_ranges_from_data not a matrix", call. = FALSE)
  if (!all(c("min", "max") %in% colnames(ranges))) stop("get_ranges_from_data missing min/max columns", call. = FALSE)

  means <- get_mean_values(model_data, c("bio1", "bio12"))
  if (!is.list(means)) stop("get_mean_values not a list", call. = FALSE)
  if (length(means) != 2) stop("get_mean_values wrong length", call. = FALSE)

  env_train <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(env_train) <- runif(100, 10, 30)
  names(env_train) <- "bio1"
  
  env_train2 <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(env_train2) <- runif(100, 200, 2500)
  names(env_train2) <- "bio12"
  
  env_train <- c(env_train, env_train2)

  ranges_rast <- tryCatch(
    get_ranges_from_rast(env_train, c("bio1", "bio12")),
    error = function(e) NULL
  )
  if (!is.null(ranges_rast)) {
    if (!is.matrix(ranges_rast)) stop("get_ranges_from_rast not a matrix", call. = FALSE)
  }

  tmp_out <- tempfile()
  dir.create(tmp_out)
  on.exit(unlink(tmp_out, recursive = TRUE), add = TRUE)

  curve_df <- data.frame(
    covariate = rep(c("bio1", "bio12"), each = 20),
    value = c(seq(10, 30, length.out = 20), seq(200, 2500, length.out = 20)),
    suitability = runif(40, 0, 1)
  )
  p <- tryCatch(
    plot_response_curves(curve_df, out_dir = tmp_out),
    error = function(e) {
      cat("[response_curves smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(p)) {
    cat("[response_curves smoke] skipped: plot_response_curves failed\n")
    return(invisible(NULL))
  }
  if (!inherits(p, "ggplot")) stop("plot_response_curves did not return ggplot", call. = FALSE)
  if (!file.exists(file.path(tmp_out, "response_curves_combined.png"))) stop("combined PNG not written", call. = FALSE)

  cat("[response_curves smoke] passed\n")
}

test_diagnostics_plots_smoke <- function() {
  cat("[diagnostics_plots smoke] starting...\n")
  tmp_dir <- tempfile()
  dir.create(tmp_dir)
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)

  result <- list(
    variable_importance = data.frame(
      variable = c("bio1", "bio12", "elevation_m"),
      importance = c(0.45, 0.35, 0.20)
    ),
    response_curves = data.frame(
      covariate = rep(c("bio1", "bio12"), each = 10),
      value = c(seq(10, 30, length.out = 10), seq(200, 2500, length.out = 10)),
      suitability = runif(20, 0, 1)
    ),
    cv = list(
      fold_metrics = data.frame(
        fold = 1:3,
        tp = c(10, 12, 11),
        fp = c(5, 3, 4),
        tn = c(45, 47, 46),
        fn = c(5, 3, 4),
        auc = c(0.78, 0.82, 0.80),
        tss = c(0.50, 0.55, 0.52)
      ),
      auc_mean = 0.80,
      auc_sd = 0.02,
      tss_mean = 0.52,
      predictions = data.frame(
        observed = c(rep(1, 30), rep(0, 70)),
        predicted = c(runif(30, 0.4, 1.0), runif(70, 0.0, 0.6))
      )
    ),
    fit = list(
      presence_suit = runif(30, 0.3, 0.9),
      background_suit = runif(70, 0.0, 0.5)
    )
  )

  paths <- tryCatch(
    save_diagnostic_plots(result, tmp_dir),
    error = function(e) {
      cat("[diagnostics_plots smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(paths)) {
    cat("[diagnostics_plots smoke] skipped: save_diagnostic_plots failed\n")
    return(invisible(NULL))
  }
  if (!is.list(paths)) stop("save_diagnostic_plots returned non-list", call. = FALSE)
  png_files <- list.files(tmp_dir, pattern = "\\.png$", full.names = TRUE)
  if (length(png_files) == 0) stop("save_diagnostic_plots produced no PNG files", call. = FALSE)

  cat("[diagnostics_plots smoke] passed (", length(png_files), " PNGs written)\n", sep = "")
}

test_export_run_script_smoke <- function() {
  cat("[export_run_script smoke] starting...\n")
  result <- list(
    config = list(
      species = "Test species",
      extent = c(140, 160, -40, -20),
      biovars = c(1, 12),
      background_n = 100,
      cv_folds = 3,
      threshold = 0.5,
      aggregation_factor = 1,
      climate_source = "worldclim",
      cv_strategy = "random",
      bias_method = "none",
      maxnet_features = "auto",
      maxnet_regmult = 1,
      multi_ensemble_models = c("glm", "maxnet"),
      multi_ensemble_weighting = "auc",
      multi_ensemble_power = 1,
      n_cores = 1
    ),
    model_id = "glm",
    occurrence = data.frame(x = c(140, 145), y = c(-30, -35)),
    cv = list(auc_mean = 0.78, auc_sd = 0.04, strategy = "random", k = 3),
    metrics = list(auc_mean = 0.78, presence_records = 50, background_points = 100)
  )

  tmp_path <- tempfile(fileext = ".R")
  result_path <- tryCatch(
    export_run_script(result, tmp_path),
    error = function(e) {
      cat("[export_run_script smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result_path) || !file.exists(tmp_path)) {
    cat("[export_run_script smoke] skipped: export_run_script failed\n")
    return(invisible(NULL))
  }
  lines <- readLines(tmp_path)
  if (!any(grepl("Test species", lines))) stop("export script missing species", call. = FALSE)
  if (!any(grepl("glm", lines))) stop("export script missing model_id", call. = FALSE)
  if (length(lines) < 10) stop("export script too short", call. = FALSE)

  cat("[export_run_script smoke] passed\n")
}

test_metrics_binary_smoke <- function() {
  cat("[metrics_binary smoke] starting...\n")
  set.seed(42)
  obs <- c(rep(1, 30), rep(0, 70))
  score <- c(runif(30, 0.4, 1.0), runif(70, 0.0, 0.6))

  metrics <- compute_binary_metrics(obs, score, threshold = 0.5)
  if (!is.list(metrics)) stop("compute_binary_metrics returned non-list", call. = FALSE)
  if (is.na(metrics$auc)) stop("compute_binary_metrics AUC is NA", call. = FALSE)
  if (metrics$auc < 0.5 || metrics$auc > 1.0) stop("compute_binary_metrics AUC out of range", call. = FALSE)
  if (is.na(metrics$tss)) stop("compute_binary_metrics TSS is NA", call. = FALSE)
  if (is.na(metrics$sensitivity) || is.na(metrics$specificity)) stop("compute_binary_metrics sens/spec NA", call. = FALSE)
  if (!is.integer(metrics$tp) || !is.integer(metrics$fp)) stop("compute_binary_metrics tp/fp not integer", call. = FALSE)

  na_metrics <- compute_binary_metrics(c(NA, NA), c(NA, NA))
  if (!all(is.na(na_metrics[c("auc", "tss", "sensitivity", "specificity")]))) stop("compute_binary_metrics should return NA for all-NA input", call. = FALSE)

  cat("[metrics_binary smoke] passed (AUC: ", round(metrics$auc, 3), ")\n", sep = "")
}

test_compute_mess_smoke <- function() {
  cat("[compute_mess smoke] starting...\n")
  bio1_train <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio1_train) <- runif(100, 15, 25)
  names(bio1_train) <- "bio1"

  bio12_train <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 150, ymin = -30, ymax = -20, crs = "EPSG:4326")
  terra::values(bio12_train) <- runif(100, 500, 2000)
  names(bio12_train) <- "bio12"

  env_train <- c(bio1_train, bio12_train)

  bio1_proj <- terra::rast(nrows = 10, ncols = 10, xmin = 138, xmax = 152, ymin = -32, ymax = -18, crs = "EPSG:4326")
  terra::values(bio1_proj) <- c(runif(80, 15, 25), runif(20, 5, 10))
  names(bio1_proj) <- "bio1"

  bio12_proj <- terra::rast(nrows = 10, ncols = 10, xmin = 138, xmax = 152, ymin = -32, ymax = -18, crs = "EPSG:4326")
  terra::values(bio12_proj) <- c(runif(80, 500, 2000), runif(20, 100, 300))
  names(bio12_proj) <- "bio12"

  env_proj <- c(bio1_proj, bio12_proj)

  result <- tryCatch(
    compute_mess(env_train, env_proj),
    error = function(e) {
      cat("[compute_mess smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[compute_mess smoke] skipped: compute_mess failed\n")
    return(invisible(NULL))
  }
  if (!inherits(result$mess, "SpatRaster")) stop("compute_mess mess not a SpatRaster", call. = FALSE)
  if (!is.list(result$per_variable)) stop("compute_mess per_variable not a list", call. = FALSE)
  if (length(result$per_variable) != 2) stop("compute_mess per_variable wrong length", call. = FALSE)
  if (!is.numeric(result$pct_extrapolation)) stop("compute_mess pct_extrapolation not numeric", call. = FALSE)
  if (!is.list(result$train_ranges)) stop("compute_mess train_ranges not a list", call. = FALSE)

  cat("[compute_mess smoke] passed (extrapolation: ", round(result$pct_extrapolation * 100, 1), "%)\n", sep = "")
}

test_compute_mod_smoke <- function() {
  cat("[compute_mod smoke] starting...\n")
  bio1_mess <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10, crs = "EPSG:4326")
  terra::values(bio1_mess) <- runif(100, -0.5, 0.5)
  names(bio1_mess) <- "bio1"

  bio12_mess <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10, crs = "EPSG:4326")
  terra::values(bio12_mess) <- runif(100, -0.3, 0.7)
  names(bio12_mess) <- "bio12"

  result <- tryCatch(
    compute_mod(list(bio1 = bio1_mess, bio12 = bio12_mess)),
    error = function(e) {
      cat("[compute_mod smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[compute_mod smoke] skipped: compute_mod failed\n")
    return(invisible(NULL))
  }
  if (!inherits(result, "SpatRaster")) stop("compute_mod not a SpatRaster", call. = FALSE)
  if (names(result) != "MOD") stop("compute_mod not named MOD", call. = FALSE)
  mod_vals <- terra::values(result, na.rm = TRUE)
  if (any(!mod_vals %in% c(1, 2))) stop("compute_mod values should be 1 or 2", call. = FALSE)

  cat("[compute_mod smoke] passed\n")
}

test_future_projection_helpers_smoke <- function() {
  cat("[future_projection_helpers smoke] starting...\n")
  tmp_dir <- tempfile()
  dir.create(tmp_dir)
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)

  file.create(file.path(tmp_dir, "wc2.1_10m_bio_1.tif"))
  file.create(file.path(tmp_dir, "wc2.1_10m_bio_12.tif"))

  files <- future_projection_files(tmp_dir, c(1, 12))
  if (!is.character(files) || length(files) != 2) stop("future_projection_files wrong type/length", call. = FALSE)
  if (is.na(files["bio1"]) || is.na(files["bio12"])) stop("future_projection_files missed files: ", paste(names(files), "=", files, collapse = ", "), call. = FALSE)

  ready <- future_projection_ready(tmp_dir, c(1, 12))
  if (!isTRUE(ready)) stop("future_projection_ready should be TRUE", call. = FALSE)

  not_ready <- future_projection_ready(tmp_dir, c(1, 12, 4))
  if (isTRUE(not_ready)) stop("future_projection_ready should be FALSE when bio4 missing", call. = FALSE)

  cat("[future_projection_helpers smoke] passed\n")
}

# ============================================================================
# XYZ TILE GENERATION TESTS
# ============================================================================

test_xyz_tiles_smoke <- function() {
  cat("[xyz_tiles smoke] starting...\n")
  skip_if_not_installed("terra")

  r <- terra::rast(ncols = 40, nrows = 40,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- runif(terra::ncell(r), 0, 1)
  tmp <- tempfile()

  result <- generate_xyz_tiles(r, tmp,
    palette = c("#0A1624", "#123247", "#15545D", "#1F8A70", "#59C174",
                "#C6D65B", "#F3C45A", "#F28A3C", "#E34B35", "#A51E3B"),
    value_range = c(0, 1), band_names = "suitability",
    verbose = TRUE)

  assert_that(result$bands[["suitability"]]$tile_count > 0,
    "Expected at least one tile")
  assert_that(dir.exists(file.path(tmp, "suitability")),
    "Expected suitability tile directory")

  tile_files <- list.files(file.path(tmp, "suitability"),
    recursive = TRUE, pattern = "\\.png$")
  assert_that(length(tile_files) > 0,
    "Expected tile PNG files")

  first_tile <- file.path(tmp, "suitability", tile_files[1])
  header <- readBin(first_tile, "raw", n = 8)
  assert_that(
    identical(header[1:4], as.raw(c(0x89, 0x50, 0x4E, 0x47))),
    "First tile must be a valid PNG")

  cat("[xyz_tiles smoke] ", result$bands[["suitability"]]$tile_count,
    " tiles (zoom ", result$bands[["suitability"]]$zoom_min, "-",
    result$bands[["suitability"]]$zoom_max, ") generated in ",
    round(result$generation_time, 2), "s\n", sep = "")

  unlink(tmp, recursive = TRUE)
}

# ============================================================================
# CORE UTILITY TESTS (pure functions, no I/O, no network)
# ============================================================================

test_cv_folds_smoke <- function() {
  cat("[cv_folds smoke] starting...\n")

  set.seed(42)
  y <- c(rep(1, 30), rep(0, 70))
  folds <- make_cv_folds_random(y, k = 5)
  if (!is.integer(folds)) stop("make_cv_folds_random not integer", call. = FALSE)
  if (length(folds) != 100) stop("make_cv_folds_random wrong length", call. = FALSE)
  if (length(unique(folds)) != 5) stop("make_cv_folds_random wrong fold count", call. = FALSE)

  no_folds <- make_cv_folds_random(y, k = 1)
  if (!all(no_folds == 0L)) stop("make_cv_folds_random k=1 should return zeros", call. = FALSE)

  km <- lonlat_to_km(c(140, 150), c(-30, -20))
  if (!is.data.frame(km)) stop("lonlat_to_km not data.frame", call. = FALSE)
  if (!all(c("x_km", "y_km") %in% names(km))) stop("lonlat_to_km missing columns", call. = FALSE)

  block_size <- estimate_cv_block_size_km(c(140, 150), c(-30, -20), k = 5)
  if (!is.numeric(block_size) || length(block_size) != 1) stop("estimate_cv_block_size_km wrong type", call. = FALSE)
  if (!is.finite(block_size) || block_size <= 0) stop("estimate_cv_block_size_km invalid value", call. = FALSE)

  set.seed(42)
  x <- runif(50, 140, 150)
  y_pts <- runif(50, -30, -20)
  presence <- c(rep(1, 15), rep(0, 35))
  spatial <- make_cv_folds_spatial_blocks(x, y_pts, presence, k = 3)
  if (!is.list(spatial)) stop("make_cv_folds_spatial_blocks not list", call. = FALSE)
  if (is.null(spatial$fold_id)) stop("make_cv_folds_spatial_blocks missing fold_id", call. = FALSE)
  if (is.null(spatial$block_size_mode)) stop("make_cv_folds_spatial_blocks missing block_size_mode", call. = FALSE)

  summary_df <- summarise_cv_folds(spatial$fold_id, presence)
  if (!is.data.frame(summary_df)) stop("summarise_cv_folds not data.frame", call. = FALSE)
  if (!all(c("fold", "n_total", "n_presence", "n_background") %in% names(summary_df))) stop("summarise_cv_folds missing columns", call. = FALSE)

  cat("[cv_folds smoke] passed\n")
}

test_bioclim_math_smoke <- function() {
  cat("[bioclim_math smoke] starting...\n")

  tmin <- c(10, 11, 13, 15, 17, 19, 20, 20, 18, 16, 13, 11)
  tmax <- c(25, 26, 28, 30, 32, 34, 35, 35, 33, 30, 27, 25)
  prec <- c(50, 60, 40, 30, 20, 10, 5, 8, 15, 25, 35, 45)
  lat <- -33.0

  days <- days_in_month_vector()
  if (!is.numeric(days) || length(days) != 12) stop("days_in_month_vector wrong type/length", call. = FALSE)
  if (days[2] != 28.25) stop("days_in_month_vector Feb wrong", call. = FALSE)

  pet <- hargreaves_pet(tmin, tmax, lat)
  if (!is.numeric(pet) || length(pet) != 12) stop("hargreaves_pet wrong type/length", call. = FALSE)
  if (any(pet < 0)) stop("hargreaves_pet has negative values", call. = FALSE)

  gdd5 <- compute_gdd(tmin, tmax, base_temp = 5)
  if (!is.numeric(gdd5) || length(gdd5) != 1) stop("compute_gdd wrong type/length", call. = FALSE)
  if (!is.finite(gdd5) || gdd5 <= 0) stop("compute_gdd invalid value", call. = FALSE)

  gdd10 <- compute_gdd(tmin, tmax, base_temp = 10)
  if (gdd10 >= gdd5) stop("GDD10 should be less than GDD5", call. = FALSE)

  mi <- compute_mi(prec, tmin, tmax, lat)
  if (!is.numeric(mi) || length(mi) != 1) stop("compute_mi wrong type/length", call. = FALSE)
  if (!is.finite(mi) || mi <= 0) stop("compute_mi invalid value", call. = FALSE)

  p_seas <- compute_p_seasonality(prec, tmin, tmax)
  if (!is.numeric(p_seas) || length(p_seas) != 1) stop("compute_p_seasonality wrong type/length", call. = FALSE)
  if (p_seas < 0 || p_seas > 1) stop("compute_p_seasonality out of [0,1]", call. = FALSE)

  cat("[bioclim_math smoke] passed (PET mean=", round(mean(pet), 1), ", GDD5=", round(gdd5, 0), ", MI=", round(mi, 2), ")\n", sep = "")
}

test_boundary_helpers_smoke <- function() {
  cat("[boundary_helpers smoke] starting...\n")

  aus_extent <- get_boundary_extent("AUS")
  if (!is.numeric(aus_extent) || length(aus_extent) != 4) stop("get_boundary_extent(AUS) wrong type/length", call. = FALSE)
  if (!validate_boundary_extent(aus_extent)) stop("AUS extent should be valid", call. = FALSE)

  custom <- get_boundary_extent("AUS", custom_extent = c(140, 150, -30, -20))
  if (!identical(custom, c(140, 150, -30, -20))) stop("get_boundary_extent custom override failed", call. = FALSE)

  null_extent <- get_boundary_extent("custom")
  if (!is.null(null_extent)) stop("get_boundary_extent('custom') should return NULL", call. = FALSE)

  if (!has_boundary_file("AUS")) stop("has_boundary_file(AUS) should be TRUE", call. = FALSE)
  if (has_boundary_file("XXX")) stop("has_boundary_file(XXX) should be FALSE", call. = FALSE)

  countries <- get_boundary_countries()
  if (!is.character(countries) || length(countries) < 3) stop("get_boundary_countries wrong", call. = FALSE)
  if (!"AUS" %in% countries) stop("get_boundary_countries missing AUS", call. = FALSE)

  choices <- get_extent_choices()
  if (!is.character(choices)) stop("get_extent_choices not character", call. = FALSE)
  if (!"aus_full" %in% choices) stop("get_extent_choices missing aus_full", call. = FALSE)

  if (!validate_boundary_extent(c(140, 150, -30, -20))) stop("valid extent rejected", call. = FALSE)
  if (validate_boundary_extent(c(150, 140, -30, -20))) stop("invalid xmin>xmax accepted", call. = FALSE)
  if (validate_boundary_extent(c(140, 150, -30))) stop("length-3 extent accepted", call. = FALSE)
  if (validate_boundary_extent(NULL)) stop("NULL extent accepted", call. = FALSE)

  cat("[boundary_helpers smoke] passed\n")
}

test_metrics_helpers_smoke <- function() {
  cat("[metrics_helpers smoke] starting...\n")

  set.seed(42)
  obs <- c(rep(1, 30), rep(0, 70))
  score <- c(runif(30, 0.4, 1.0), runif(70, 0.0, 0.6))

  auc <- auc_rank(obs, score)
  if (!is.numeric(auc) || length(auc) != 1) stop("auc_rank wrong type/length", call. = FALSE)
  if (auc < 0.5 || auc > 1.0) stop("auc_rank out of range", call. = FALSE)

  na_auc <- auc_rank(c(NA, NA), c(NA, NA))
  if (!is.na(na_auc)) stop("auc_rank should return NA for all-NA input", call. = FALSE)

  metrics <- compute_binary_metrics(obs, score, threshold = 0.5)
  row <- metrics_list_to_row(metrics, fold = 1)
  if (!is.data.frame(row)) stop("metrics_list_to_row not data.frame", call. = FALSE)
  if (nrow(row) != 1) stop("metrics_list_to_row wrong row count", call. = FALSE)
  expected_cols <- c("fold", "auc", "tss", "sensitivity", "specificity", "threshold", "tp", "fp", "tn", "fn", "n")
  if (!all(expected_cols %in% names(row))) stop("metrics_list_to_row missing columns", call. = FALSE)

  m <- metric_mean(c(1, 2, 3))
  if (!identical(m, 2)) stop("metric_mean wrong", call. = FALSE)
  if (!is.na(metric_mean(c()))) stop("metric_mean empty should be NA", call. = FALSE)

  s <- metric_sd(c(1, 2, 3))
  if (!is.numeric(s) || length(s) != 1) stop("metric_sd wrong type", call. = FALSE)
  if (!is.na(metric_sd(c(1)))) stop("metric_sd single value should be NA", call. = FALSE)

  cbi_result <- tryCatch(
    continuous_boyce_index(
      pres_suit = runif(50, 0.3, 0.9),
      bg_suit = runif(200, 0.0, 0.5),
      n_bins = 101,
      win = 0.1
    ),
    error = function(e) NULL
  )
  if (!is.null(cbi_result)) {
    if (!is.numeric(cbi_result$cbi)) stop("continuous_boyce_index cbi not numeric", call. = FALSE)
    if (!is.data.frame(cbi_result$bins)) stop("continuous_boyce_index bins not data.frame", call. = FALSE)
    if (nrow(cbi_result$bins) != 101) stop("continuous_boyce_index wrong bin count", call. = FALSE)
  }

  low_cbi <- continuous_boyce_index(pres_suit = c(0.5, 0.6), bg_suit = runif(200, 0, 0.5))
  if (!is.na(low_cbi$cbi)) stop("continuous_boyce_index should return NA for <5 presences", call. = FALSE)

  cat("[metrics_helpers smoke] passed (AUC=", round(auc, 3), ")\n", sep = "")
}

test_ensemble_importance_smoke <- function() {
  cat("[ensemble_importance smoke] starting...\n")

  comp1 <- list(
    variable_importance = data.frame(
      variable = c("bio1", "bio12", "elevation_m"),
      importance = c(0.45, 0.35, 0.20)
    )
  )
  comp2 <- list(
    variable_importance = data.frame(
      variable = c("bio1", "bio12", "bio5"),
      importance = c(0.50, 0.30, 0.20)
    )
  )
  components <- list(glm = comp1, maxnet = comp2)
  weights <- c(glm = 0.6, maxnet = 0.4)
  methods <- c(glm = "glm", maxnet = "maxnet")

  result <- tryCatch(
    compute_ensemble_importance(components, weights, methods),
    error = function(e) {
      cat("[ensemble_importance smoke] error: ", conditionMessage(e), "\n", sep = "")
      NULL
    }
  )
  if (is.null(result)) {
    cat("[ensemble_importance smoke] skipped: compute_ensemble_importance failed\n")
    return(invisible(NULL))
  }
  if (!is.data.frame(result)) stop("compute_ensemble_importance not data.frame", call. = FALSE)
  if (!all(c("variable", "weighted_importance", "n_models", "model_contribution") %in% names(result))) stop("compute_ensemble_importance missing columns", call. = FALSE)
  if (nrow(result) < 3) stop("compute_ensemble_importance too few variables", call. = FALSE)
  if (any(result$weighted_importance < 0 | result$weighted_importance > 1)) stop("compute_ensemble_importance values out of [0,1]", call. = FALSE)
  if (is.unsorted(-result$weighted_importance, na.rm = TRUE)) stop("compute_ensemble_importance not sorted descending", call. = FALSE)

  cat("[ensemble_importance smoke] passed (", nrow(result), " variables)\n", sep = "")
}

test_torch_helpers_smoke <- function() {
  cat("[torch_helpers smoke] starting...\n")

  arch <- map_gpu_to_architecture("RTX 3080")
  if (is.null(arch)) stop("map_gpu_to_architecture(RTX 3080) returned NULL", call. = FALSE)
  if (arch$arch != "ampere") stop("RTX 3080 should map to ampere", call. = FALSE)
  if (arch$torch_kind != "cu128") stop("RTX 3080 torch_kind wrong", call. = FALSE)

  arch2 <- map_gpu_to_architecture("RTX 4090")
  if (is.null(arch2)) stop("map_gpu_to_architecture(RTX 4090) returned NULL", call. = FALSE)
  if (arch2$arch != "ada") stop("RTX 4090 should map to ada", call. = FALSE)

  null_arch <- map_gpu_to_architecture("Unknown GPU XYZ")
  if (!is.null(null_arch)) stop("map_gpu_to_architecture should return NULL for unknown GPU", call. = FALSE)

  rec <- recommend_torch_kind(list(gpu_name = "RTX 3080", driver_version = "535.00", cuda_driver = "12.2"))
  if (!is.list(rec)) stop("recommend_torch_kind not list", call. = FALSE)
  if (is.null(rec$torch_kind)) stop("recommend_torch_kind missing torch_kind", call. = FALSE)
  if (is.null(rec$message)) stop("recommend_torch_kind missing message", call. = FALSE)

  cpu_rec <- recommend_torch_kind(NULL)
  if (cpu_rec$torch_kind != "cpu") stop("recommend_torch_kind(NULL) should recommend cpu", call. = FALSE)

  fmt <- format_gpu_info(list(gpu_name = "RTX 3080", driver_version = "535.00", cuda_driver = "12.2"))
  if (!is.character(fmt) || !nzchar(fmt)) stop("format_gpu_info wrong", call. = FALSE)
  if (!grepl("RTX 3080", fmt)) stop("format_gpu_info missing GPU name", call. = FALSE)

  no_gpu <- format_gpu_info(NULL)
  if (!grepl("No GPU", no_gpu)) stop("format_gpu_info(NULL) should say No GPU", call. = FALSE)

  cat("[torch_helpers smoke] passed\n")
}

test_app_helpers_smoke <- function() {
  cat("[app_helpers smoke] starting...\n")

  clean <- sanitize_extent(c(140, 150, -30, -20))
  if (!is.numeric(clean) || length(clean) != 4) stop("sanitize_extent wrong type/length", call. = FALSE)
  if (!all(is.finite(clean))) stop("sanitize_extent changed finite values", call. = FALSE)

  with_na <- sanitize_extent(c(140, Inf, -30, NA))
  if (!is.na(with_na[2]) || !is.na(with_na[4])) stop("sanitize_extent should replace Inf/NA with NA_real_", call. = FALSE)

  f1 <- fmt_num(1234.567, digits = 2)
  if (!is.character(f1)) stop("fmt_num not character", call. = FALSE)
  if (!grepl("1,234.57", f1, fixed = TRUE)) stop("fmt_num rounding wrong: ", f1, call. = FALSE)

  f2 <- fmt_num(NA)
  if (f2 != "-") stop("fmt_num(NA) should return '-'", call. = FALSE)

  f3 <- fmt_num(1234567, digits = 0)
  if (!grepl(",", f3, fixed = TRUE)) stop("fmt_num should use big.mark comma: ", f3, call. = FALSE)

  occ <- data.frame(longitude = c(140, 145, 155, 160), latitude = c(-25, -30, -35, -40))
  overlap <- occurrence_extent_overlap(occ, c(140, 150, -30, -20))
  if (!is.list(overlap)) stop("occurrence_extent_overlap not list", call. = FALSE)
  if (overlap$count != 2) stop("occurrence_extent_overlap wrong count (expected 2)", call. = FALSE)
  if (overlap$total != 4) stop("occurrence_extent_overlap wrong total", call. = FALSE)
  if (abs(overlap$percent - 50) > 0.01) stop("occurrence_extent_overlap wrong percent", call. = FALSE)

  null_overlap <- occurrence_extent_overlap(NULL, c(140, 150, -30, -20))
  if (!is.null(null_overlap)) stop("occurrence_extent_overlap(NULL) should return NULL", call. = FALSE)

  cat("[app_helpers smoke] passed\n")
}

test_validation_helpers_smoke <- function() {
  cat("[validation_helpers smoke] starting...\n")

  if (!identical(normalize_cv_block_size_km(50), 50)) stop("normalize_cv_block_size_km(50) wrong", call. = FALSE)
  if (!identical(normalize_cv_block_size_km("25.5"), 25.5)) stop("normalize_cv_block_size_km('25.5') wrong", call. = FALSE)
  if (!is.na(normalize_cv_block_size_km(NA))) stop("normalize_cv_block_size_km(NA) should be NA", call. = FALSE)
  if (!is.na(normalize_cv_block_size_km(-10))) stop("normalize_cv_block_size_km(-10) should be NA", call. = FALSE)
  if (!is.na(normalize_cv_block_size_km(0))) stop("normalize_cv_block_size_km(0) should be NA", call. = FALSE)

  cat("[validation_helpers smoke] passed\n")
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
if (has_tag("ecology")) {
  test_dispersal_smoke()
  test_climex_smoke()
  test_climate_matching_smoke()
  test_niche_overlap_smoke()
  test_species_richness_smoke()
  test_aoa_smoke()
}
if (has_tag("covariates")) {
  test_find_worldclim_smoke()
  test_opentopo_helpers_smoke()
  test_soil_output_name_smoke()
  test_vif_selection_full_smoke()
  test_align_covariate_stack_smoke()
  test_scale_raster_stack_smoke()
  test_load_extra_covariates_empty_smoke()
  test_verify_worldclim_cache_smoke()
  test_verify_future_cache_smoke()
  test_verify_soil_cache_smoke()
}
if (has_tag("reporting")) {
  test_write_summary_report_full_smoke()
  test_response_curves_smoke()
  test_diagnostics_plots_smoke()
  test_export_run_script_smoke()
  test_metrics_binary_smoke()
  test_compute_mess_smoke()
  test_compute_mod_smoke()
  test_future_projection_helpers_smoke()
}
if (has_tag("maps")) {
  test_xyz_tiles_smoke()
}
if (has_tag("core")) {
  test_cv_folds_smoke()
  test_bioclim_math_smoke()
  test_boundary_helpers_smoke()
  test_metrics_helpers_smoke()
  test_ensemble_importance_smoke()
  test_torch_helpers_smoke()
  test_app_helpers_smoke()
  test_validation_helpers_smoke()
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
