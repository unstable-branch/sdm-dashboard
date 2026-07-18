#!/usr/bin/env Rscript
# Background model run script.
# Called by callr::r_bg via Plumber's POST /api/v1/models/run.
# Reads job config from <job_dir>/meta.json and writes results back.
# Prevents closure serialization issues with callr by running as a
# standalone script that sources all required SDM modules.

# Set resource limits early — these must be set inside the child process
# (callr's r_env option may not be reliably passed)
Sys.setenv(OMP_THREAD_LIMIT = getOption("sdm.omp_thread_limit", as.character(min(4, tryCatch(parallel::detectCores(), error = function(e) 4L)))))
Sys.setenv(PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True,max_split_size_mb:512")
Sys.setenv(CUBLAS_WORKSPACE_CONFIG = ":4096:8")
# R_MAX_VSIZE is set after app_dir is resolved below (shared vsize.R helper)

# Clean up stale crash dumps from previous runs that may fill temp space
unlink(file.path(tempdir(), "sdm_crash_dump.rda"), force = TRUE)

# Support both: callr::r_bg with direct arguments (script, job_dir, app_dir)
# and CLI invocation via Rscript (commandArgs trailingOnly)
`%||%` <- function(a, b) if (!is.null(a)) a else b

if (!exists("job_dir", inherits = FALSE) || is.null(job_dir) || length(job_dir) != 1L ||
    is.na(job_dir) || !nzchar(job_dir)) {
  job_dir <- commandArgs(trailingOnly = TRUE)[1L]
}
if (!exists("app_dir", inherits = FALSE) || is.null(app_dir) || length(app_dir) != 1L ||
    is.na(app_dir) || !nzchar(app_dir)) {
  app_dir <- commandArgs(trailingOnly = TRUE)[2L]
}
if (is.na(job_dir) || !nzchar(job_dir)) stop("job_dir is required")
if (is.na(app_dir) || !nzchar(app_dir)) stop("app_dir is required")

# Set terra temp dir to job dir to avoid cross-device link errors from
# writeRaster's internal file.rename (Docker /tmp is often a separate tmpfs mount).
# Also used by callr path via TMPDIR env var set before process start.
tmp_dir <- file.path(job_dir, ".tmp")
dir.create(tmp_dir, recursive = TRUE, showWarnings = FALSE)

# Set R_MAX_VSIZE now that app_dir is known (shared helper in vsize.R)
source(file.path(app_dir, "plumber", "R", "helpers", "vsize.R"))
Sys.setenv(R_MAX_VSIZE = sdm_detect_vsize())

# Load Redis cancel check for periodic cancellation polling
source(file.path(app_dir, "plumber", "R", "redis.R"))

# Bootstrap must load before write_meta (which uses sdm_safe_rename)
source(file.path(app_dir, "R", "core", "bootstrap.R"))
sdm_set_project_root(app_dir)

meta_file <- file.path(job_dir, "meta.json")
progress_file <- file.path(job_dir, "progress.log")
heartbeat_file <- file.path(job_dir, "heartbeat.log")

write_heartbeat <- function(stage) {
  ts <- format(Sys.time(), "%Y-%m-%dT%H:%M:%S")
  cat(ts, "|", stage, "\n", sep = "", file = heartbeat_file, append = TRUE)
}

log_fun <- function(...) {
  msg <- paste0(format(Sys.time(), "%H:%M:%S"), " ", ...)
  cat(msg, "\n")
  cat(msg, "\n", file = progress_file, append = TRUE)
}

progress_fun <- function(x) {
  pct <- if (is.list(x)) x$value else x
  detail <- if (is.list(x)) x$detail else NULL
  pct_num <- as.numeric(pct)
  if (!is.finite(pct_num)) pct_num <- 0
  log_line <- paste0(format(Sys.time(), "%H:%M:%S"), " [", sprintf("%.0f", pct_num * 100), "%] ", detail %||% "")
  cat(log_line, "\n")
  cat(log_line, "\n", file = progress_file, append = TRUE)
  # Write structured progress.json entry (consumed by Plumber status endpoint as progress_json)
  # Format: append-only JSON-lines (one JSON object per line) — the Plumber reader parses
  # each line independently, so no outer array wrapper is needed.
  progress_json_path <- file.path(job_dir, "progress.json")
  inferred_stage <- if (!is.null(detail) && nchar(detail) > 0) {
    d <- tolower(detail)
    if (grepl("climate|worldclim|chelsa", d)) "climate_download"
    else if (grepl("clean", d)) "clean" else if (grepl("load|scal|covariate", d)) "covariates"
    else if (grepl("thin", d)) "thinning" else if (grepl("vif", d)) "vif"
    else if (grepl("fit|model", d)) "fit" else if (grepl("predict|projection", d)) "predict"
    else if (grepl("tile", d)) "tiles" else if (grepl("output|artifact|report", d)) "output"
    else if (grepl("future", d)) "future" else if (grepl("summaris", d)) "summarize" else "unknown"
  } else "unknown"
  metadata <- if (is.list(x)) x[setdiff(names(x), c("value", "detail"))] else list()
  entry <- c(list(
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    percent = pct_num,
    detail = detail %||% "",
    stage = metadata$stage %||% inferred_stage
  ), metadata[setdiff(names(metadata), "stage")])
  cat(jsonlite::toJSON(entry, auto_unbox = TRUE), "\n", file = progress_json_path, append = TRUE)
  # Rotate progress.json if it exceeds 5 MB (prevent unbounded growth)
  if (file.size(progress_json_path) > 5 * 1024 * 1024) {
    tryCatch({
      file.rename(progress_json_path, paste0(progress_json_path, ".bak"))
    }, error = function(e) NULL)
  }
}

read_meta <- function() {
  jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
}

write_meta <- function(meta) {
  tmp_path <- paste0(meta_file, ".tmp")
  writeLines(jsonlite::toJSON(meta, null = "null", auto_unbox = TRUE, pretty = TRUE), tmp_path)
  sdm_safe_rename(tmp_path, meta_file)
}

# Write initial status before module loading (catches OOM during source)
meta <- read_meta()
meta$status <- "loading"
write_meta(meta)
write_heartbeat("loading_start")

progress_fun(list(value = 0.0, detail = "Initialising background process"))

log_fun("Loading project initialization modules...")
progress_fun(list(value = 0.01, detail = "Loading project bootstrap"))
write_heartbeat("bootstrap_done")

# Source error codes for classification
progress_fun(list(value = 0.02, detail = "Loading error classification"))
source(file.path(app_dir, "plumber", "R", "error_codes.R"), local = TRUE)

log_fun("Loading compute modules (~130 modules)...")
progress_fun(list(value = 0.03, detail = "Loading compute modules"))
Sys.setenv(SDM_HEARTBEAT_FILE = heartbeat_file)
source(file.path(app_dir, "R", "load_compute.R"))
  terra::terraOptions(tempdir = tmp_dir)
write_heartbeat("compute_modules_done")
log_fun("All modules loaded successfully")

# Periodic cancellation check helper
# Sets the global option so internal check_cancelled() in run_fast_sdm() can detect it,
# then writes the cancellation to meta.json and quits.
check_cancel_background <- function(job_id, log_fun) {
  if (!exists("sdm_redis_cancel_check", inherits = TRUE)) return(FALSE)
  if (sdm_redis_cancel_check(job_id)) {
    options(sdm_cancelled = TRUE)
    m <- read_meta()
    m$status <- "cancelled"
    m$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    m$error <- "Cancelled by user"
    write_meta(m)
    log_fun("Model run cancelled by user")
    quit(save = "no", status = 0, runLast = TRUE)
  }
  FALSE
}

job_id <- basename(job_dir)
meta <- read_meta()
meta$status <- "running"
write_meta(meta)

# Wrap main execution in tryCatch so failures set meta.json to "failed"
tryCatch({
  config <- meta$config %||% list()
  config <- sdm_normalize_model_payload(config)

  # Parse biovars and projection_extent from config (stored as strings by the handler)
  biovars <- as.integer(unlist(strsplit(as.character(config$biovars %||% "1,4,6,12,15,18"), ",")))
  projection_extent <- as.numeric(unlist(strsplit(as.character(config$projection_extent %||% "112,154,-44,-10"), ",")))
  if (length(projection_extent) != 4L || any(!is.finite(projection_extent))) {
    stop("projection_extent must have 4 numeric values: xmin, xmax, ymin, ymax")
  }
  if (projection_extent[1] >= projection_extent[2] || projection_extent[3] >= projection_extent[4]) {
    stop("projection_extent has invalid ordering: xmin must be < xmax, ymin must be < ymax")
  }
  if (projection_extent[1] < -180 || projection_extent[2] > 180 || projection_extent[3] < -90 || projection_extent[4] > 90) {
    stop("projection_extent is outside valid coordinate bounds (±180, ±90)")
  }

  cleaned_occurrence <- NULL
  if (is.character(config$cleaned_file_id) && length(config$cleaned_file_id) == 1 && nzchar(config$cleaned_file_id) && file.exists(config$cleaned_file_id)) {
    tmp_clean <- tempfile()
    on.exit(unlink(tmp_clean), add = TRUE)
    decrypt_file(config$cleaned_file_id, tmp_clean)
    cleaned_df <- utils::read.csv(tmp_clean, stringsAsFactors = FALSE)
    src_col <- if ("source" %in% names(cleaned_df)) cleaned_df$source else rep("Unknown", nrow(cleaned_df))
    src_counts <- sort(table(src_col), decreasing = TRUE)
    n_absent <- if ("occurrenceStatus" %in% names(cleaned_df)) sum(tolower(cleaned_df$occurrenceStatus) == "absent", na.rm = TRUE) else 0L
    cleaned_occurrence <- list(
      df = cleaned_df,
      source_counts = as.list(src_counts),
      n_absent_excluded = n_absent,
      original_rows = nrow(cleaned_df)
    )
  }

  cfg_args <- list(
    species = config$species,
    species_filter = config$species_filter %||% NULL,
    occurrence_file = config$occurrence_file,
    cleaned_occurrence = cleaned_occurrence,
    worldclim_dir = sdm_resolve_project_path(config$worldclim_dir %||% sdm_default_worldclim_dir, app_dir),
    selected_biovars = biovars,
    projection_extent = projection_extent,
    background_n = as.integer(config$background_n %||% sdm_default_background_n),
    min_source_records = as.integer(config$min_source_records %||% sdm_default_min_source_records),
    merge_small_sources = isTRUE(config$merge_small_sources %||% TRUE),
    thin_by_cell = isTRUE(config$thin_by_cell %||% TRUE),
    model_id = config$model_id,
    include_quadratic = isTRUE(config$include_quadratic %||% TRUE),
    threshold = as.numeric(config$threshold %||% sdm_default_threshold),
    aggregation_factor = as.integer(config$aggregation_factor %||% 1L),
    cv_folds = as.integer(config$cv_folds %||% sdm_default_cv_folds),
    n_cores = as.integer(config$n_cores %||% 8L),
    allow_download = TRUE,
    worldclim_res = as.numeric(config$worldclim_res %||% sdm_default_worldclim_res),
    cv_strategy = config$cv_strategy %||% sdm_default_cv_strategy,
    cv_block_size_km = if (!is.null(config$cv_block_size_km)) as.numeric(config$cv_block_size_km) else sdm_default_cv_block_size_km,
    use_elevation = isTRUE(config$use_elevation),
    elevation_demtype = config$elevation_demtype %||% sdm_default_elevation_demtype,
    opentopo_api_key = config$opentopo_api_key,
    use_soil = isTRUE(config$use_soil),
    selected_soil_vars = config$soil_vars %||% sdm_default_soil_vars,
    selected_soil_depths = config$soil_depths %||% sdm_default_soil_depths,
    use_uv = isTRUE(config$use_uv),
    selected_uv_vars = config$uv_vars %||% sdm_default_uv_vars,
    selected_uv_months = config$selected_uv_months,
    use_vegetation = isTRUE(config$use_vegetation),
    veg_year = as.integer(config$veg_year %||% sdm_default_veg_year),
    veg_products = config$veg_products %||% sdm_default_veg_products,
    use_lulc = isTRUE(config$use_lulc),
    lulc_year = as.integer(config$lulc_year %||% sdm_default_lulc_year),
    use_hfp = isTRUE(config$use_hfp),
    hfp_year = as.integer(config$hfp_year %||% sdm_default_hfp_year),
    use_bioclim_season = isTRUE(config$use_bioclim_season),
    use_drought = isTRUE(config$use_drought),
    selected_drought_periods = config$selected_drought_periods %||% "annual_mean",
    covariate_cache_dir = sdm_resolve_project_path(config$covariate_cache_dir %||% sdm_default_covariate_cache_dir, app_dir),
    vif_reduction = isTRUE(config$vif_reduction),
    vif_threshold = as.numeric(config$vif_threshold %||% 10),
    future_projection = isTRUE(config$future_projection),
    future_worldclim_dir = sdm_resolve_project_path(config$future_worldclim_dir %||% sdm_default_future_worldclim_dir, app_dir),
    future_label = config$future_label %||% "Future climate",
    maxnet_features = config$maxnet_features %||% sdm_default_maxnet_features,
    maxnet_regmult = as.numeric(config$maxnet_regmult %||% sdm_default_maxnet_regmult),
    bias_method = config$bias_method %||% "uniform",
    thickening_distance_km = as.numeric(config$thickening_distance_km %||% sdm_default_thinning_distance_km),
    pa_replicates = as.integer(config$pa_replicates %||% sdm_default_pa_replicates),
    output_dir = job_dir,
    seed = as.integer(config$seed %||% sdm_default_seed),
    source = config$source %||% sdm_default_climate_source,
    log_fun = log_fun,
    progress_fun = progress_fun,
    climate_matching = isTRUE(config$climate_matching),
    climate_matching_method = config$climate_matching_method %||% "mahalanobis",
    max_coordinate_uncertainty = if (!is.null(config$max_coordinate_uncertainty)) as.numeric(config$max_coordinate_uncertainty) else NULL,
    multi_ensemble_models = config$multi_ensemble_models,
    multi_ensemble_weighting = config$multi_ensemble_weighting %||% "auc",
    multi_ensemble_power = as.numeric(config$multi_ensemble_power %||% sdm_default_ensemble_power),
    multi_ensemble_min_auc = as.numeric(config$multi_ensemble_min_auc %||% sdm_default_ensemble_min_auc),
    multi_ensemble_min_tss = as.numeric(config$multi_ensemble_min_tss %||% sdm_default_ensemble_min_tss),
    multi_ensemble_export = isTRUE(config$multi_ensemble_export %||% TRUE),
    multi_ensemble_uncertainty = isTRUE(config$multi_ensemble_uncertainty %||% TRUE),
    biomod2_models = config$biomod2_models,
    esm_n_runs = as.integer(config$esm_n_runs %||% sdm_esm_default_n_runs),
    esm_split = config$esm_split %||% sdm_esm_default_split,
    esm_min_auc = as.numeric(config$esm_min_auc %||% sdm_esm_default_min_auc),
    esm_weighting_metric = config$esm_weighting_metric %||% "AUC",
    esm_power = as.numeric(config$esm_power %||% sdm_esm_default_power),
    esm_biovars = config$esm_biovars,
    selected_chelsa_extras = config$selected_chelsa_extras,
    future_worldclim_dir2 = if (!is.null(config$future_worldclim_dir2)) sdm_resolve_project_path(config$future_worldclim_dir2, app_dir) else NULL,
    future_label2 = config$future_label2 %||% "Future climate 2",
    use_cc = isTRUE(config$use_cc),
    cc_tests = config$cc_tests %||% "all",
    analysis_crs = config$analysis_crs %||% sdm_default_analysis_crs,
    generate_tiles = isTRUE(config$generate_tiles %||% sdm_default_generate_tiles),
    mask_type = config$mask_type %||% sdm_default_mask_type,
    mask_file = config$mask_file %||% sdm_default_mask_file,
    mask_buffer_deg = as.numeric(config$mask_buffer_deg %||% sdm_default_mask_buffer_deg),
    mask_boundary_type = config$mask_boundary_type %||% sdm_default_mask_boundary_type,
    mask_resolution = config$mask_resolution %||% sdm_default_mask_resolution,
    mask_country = config$mask_country %||% sdm_default_mask_country,
    restrict_background = isTRUE(config$restrict_background %||% FALSE),
    rangebag_n_bags = as.integer(config$rangebag_n_bags %||% sdm_default_rangebag_n_bags),
    rangebag_bag_fraction = as.numeric(config$rangebag_bag_fraction %||% sdm_default_rangebag_fraction),
    rangebag_vars_per_bag = as.integer(config$rangebag_vars_per_bag %||% sdm_default_rangebag_vars_per_bag),
    tuning_method = config$tuning_method %||% sdm_default_tuning_method,
    enmeval_algorithm = config$enmeval_algorithm %||% sdm_default_enmeval_algorithm,
    enmeval_partitions = config$enmeval_partitions %||% sdm_default_enmeval_partitions,
    enmeval_selection_metric = config$enmeval_selection_metric %||% sdm_default_enmeval_selection_metric,
    enmeval_tune_args = config$enmeval_tune_args %||% sdm_default_enmeval_tune_args,
    enmeval_categoricals = config$enmeval_categoricals %||% sdm_default_enmeval_categoricals,
    enmeval_other_settings = config$enmeval_other_settings %||% sdm_default_enmeval_other_settings,
    enmeval_null_iterations = as.integer(config$enmeval_null_iterations %||% sdm_default_enmeval_null_iterations),
    maxnet_auto_tune = isTRUE(config$maxnet_auto_tune %||% FALSE),
    rf_num_trees = as.integer(config$rf_num_trees %||% 500L),
    rf_mtry = as.integer(config$rf_mtry %||% NA_integer_),
    rf_min_node_size = as.integer(config$rf_min_node_size %||% 10L),
    gam_k = as.integer(config$gam_k %||% 5L),
    xgb_max_depth = as.integer(config$xgb_max_depth %||% 6L),
    xgb_eta = as.numeric(config$xgb_eta %||% 0.3),
    xgb_nrounds = as.integer(config$xgb_nrounds %||% 100L),
    gpu_enabled = config$gpu_enabled %||% "auto",
    dnn_model_type = config$dnn_model_type %||% "DNN_Medium",
    dnn_n_seeds = as.integer(config$dnn_n_seeds %||% 5L),
    dnn_device = config$dnn_device %||% "auto",
    dnn_dropout = as.numeric(config$dnn_dropout %||% 0.3),
    dnn_lambda = as.numeric(config$dnn_lambda %||% 0.001),
    dnn_fused_adam = config$dnn_fused_adam %||% config$dnn_fused_adam_default %||% "auto",
    dnn_mixed_precision = config$dnn_mixed_precision %||% "auto",
    dnn_cuda_graphs = config$dnn_cuda_graphs %||% "off",
    dnn_architecture = config$dnn_architecture %||% config$dnn_model_type %||% "DNN_Medium",
    dnn_multispecies_architecture = config$dnn_multispecies_architecture %||% config$dnn_model_type %||% "DNN_Medium",
    dnn_multispecies_n_seeds = as.integer(config$dnn_multispecies_n_seeds %||% 3L),
    dnn_mc_samples = as.integer(config$dnn_mc_samples %||% 0L),
    dnn_uncertainty_method = config$dnn_uncertainty_method %||% "none",
    job_id = job_id
  )
  cfg <- do.call(sdm_config, c(
    cfg_args,
    python_model_manifest_overrides(config$model_id, config)
  ))

  # Poll Redis for cancellation before starting the run
  check_cancel_background(job_id, log_fun)

  result <- run_fast_sdm(cfg)

  # Poll Redis again in case cancellation was signaled during the run
  check_cancel_background(job_id, log_fun)

  # Handle cancellation: run_fast_sdm returns NULL when cancelled
  if (is.null(result)) {
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    write_meta(meta)
    log_fun("Model run cancelled by user")
    quit(save = "no", status = 0, runLast = TRUE)
  }

  progress_fun(list(value = 0.97, detail = "Persisting model result artifact", stage = "output"))
  # Save full result object for diagnostic/ecology API endpoints
  # Wrap SpatRasters before serialization to avoid loading full raster data into memory
  result_rds_path <- file.path(job_dir, "result.rds")
  tryCatch({
    rds_result <- result
    if (inherits(rds_result$suitability, "SpatRaster")) {
      rds_result$suitability <- terra::wrap(rds_result$suitability)
    }
    if (!is.null(rds_result$future) && inherits(rds_result$future$suitability, "SpatRaster")) {
      rds_result$future$suitability <- terra::wrap(rds_result$future$suitability)
    }
    if (!is.null(rds_result$future2) && inherits(rds_result$future2$suitability, "SpatRaster")) {
      rds_result$future2$suitability <- terra::wrap(rds_result$future2$suitability)
    }
    if (!is.null(rds_result$climate_match) && inherits(rds_result$climate_match$similarity, "SpatRaster")) {
      rds_result$climate_match$similarity <- terra::wrap(rds_result$climate_match$similarity)
    }
    if (!is.null(rds_result$mess) && inherits(rds_result$mess$mess, "SpatRaster")) {
      rds_result$mess$mess <- terra::wrap(rds_result$mess$mess)
    }
    if (!is.null(rds_result$aoa) && inherits(rds_result$aoa, "SpatRaster")) {
      rds_result$aoa <- terra::wrap(rds_result$aoa)
    }
    sdm_atomic_saveRDS(rds_result, result_rds_path)
    rm(rds_result)
    log_fun("Saved result RDS to: ", result_rds_path)
  }, error = function(e) {
    log_fun("Failed to save result RDS: ", conditionMessage(e))
  })

  progress_fun(list(value = 0.98, detail = "Generating diagnostic artifacts", stage = "output"))
  # Generate diagnostic PNG plots
  diag_files <- list()
  tryCatch({
    diag_path <- file.path(app_dir, "R", "output", "diagnostics_plots.R")
    if (file.exists(diag_path)) {
      source(diag_path, local = TRUE)
      diag_files <- save_diagnostic_plots(result, job_dir, log_fun = log_fun)
    }
  }, error = function(e) {
    cat("Diagnostic plots failed:", conditionMessage(e), "\n")
    cat(conditionMessage(e), "\n", file = progress_file, append = TRUE)
  })

  progress_fun(list(value = 0.99, detail = "Generating ODMAP report", stage = "output"))
  # Generate ODMAP report
  tryCatch({
    source(file.path(app_dir, "R", "output", "report_odmap.R"), local = TRUE)
    odmap_csv <- file.path(job_dir, "odmap_report.csv")
    odmap_md <- file.path(job_dir, "odmap_report.md")
    write_odmap_report(result, odmap_csv, odmap_md)
    log_fun("Saved ODMAP report: ", odmap_csv)
    diag_files$odmap_report_csv <- odmap_csv
    diag_files$odmap_report_md <- odmap_md
  }, error = function(e) {
    cat("ODMAP report failed:", conditionMessage(e), "\n")
    cat(conditionMessage(e), "\n", file = progress_file, append = TRUE)
  })

  meta$status <- "completed"
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  if (!is.null(result)) {
    meta$metrics <- list(
      auc_mean = result$cv$auc_mean,
      auc_sd = result$cv$auc_sd,
      tss_mean = result$cv$tss_mean,
      tss_sd = result$cv$tss_sd,
      sensitivity_mean = result$cv$sensitivity_mean,
      specificity_mean = result$cv$specificity_mean,
      cbi = result$metrics$cbi,
      cv_cbi = result$metrics$cv_cbi,
      threshold = result$config$threshold %||% sdm_default_threshold,
      presence_records = result$metrics$presence_records,
      background_points = result$metrics$background_points,
      elapsed_seconds = result$metrics$elapsed_seconds,
      high_suitability_area_km2 = result$summary$high_risk_area_km2,
      training_auc = result$metrics$training_auc,
      auc_diff = result$metrics$auc_diff,
      overfitting_level = result$metrics$overfitting_level,
      cbi_diff = result$metrics$cbi_diff,
      enmeval_tuned = isTRUE(result$metrics$enmeval_tuned),
      enmeval_delta_aicc = result$metrics$enmeval_delta_aicc %||% NA_real_,
      enmeval_or_mtp = result$metrics$enmeval_or_mtp %||% NA_real_,
      enmeval_or_10p = result$metrics$enmeval_or_10p %||% NA_real_,
      enmeval_auc_diff = result$metrics$enmeval_auc_diff %||% NA_real_,
      enmeval_selection_metric = result$metrics$enmeval_selection_metric %||% NA_character_,
      enmeval_null_p_value = result$metrics$enmeval_null_p_value %||% NA_real_,
      enmeval_null_auc_mean = result$metrics$enmeval_null_auc_mean %||% NA_real_,
      enmeval_null_auc_sd = result$metrics$enmeval_null_auc_sd %||% NA_real_,
      enmeval_null_iterations = result$metrics$enmeval_null_iterations %||% NA_integer_
    )
    meta$output_files <- c(result$paths, diag_files, list(result_rds = result_rds_path %||% NA_character_))

    # Write EOO/AOO JSON for the ecology API
    if (!is.null(result$eoo_aoo)) {
      eoo_aoo_path <- file.path(job_dir, "eoo_aoo.json")
      tryCatch({
        eoo_list <- list(
          eoo_km2 = result$eoo_aoo$eoo_km2 %||% NA_real_,
          aoo_km2 = result$eoo_aoo$aoo_km2 %||% NA_real_,
          aoo_cells = result$eoo_aoo$aoo_cells %||% NA_integer_,
          aoo_cell_size_km = result$eoo_aoo$aoo_cell_size_km %||% 2,
          iucn_category = result$eoo_aoo$iucn_category %||% "Not evaluated",
          n_unique_points = result$eoo_aoo$n_unique_points %||% 0L
        )
        writeLines(
          jsonlite::toJSON(eoo_list, null = "null", auto_unbox = TRUE, pretty = TRUE),
          eoo_aoo_path
        )
        log_fun("Wrote EOO/AOO JSON: ", eoo_aoo_path)
      }, error = function(e) {
        log_fun("Failed to write EOO/AOO JSON: ", conditionMessage(e))
      })
    }
  }
  progress_fun(list(value = 0.995, detail = "Finalising persisted outputs", stage = "output"))
  write_meta(meta)
  progress_fun(list(value = 1.0, detail = "All outputs complete", stage = "complete"))
  gc(verbose = FALSE)
}, error = function(e) {
  meta$status <- "failed"
  err_msg <- conditionMessage(e)
  err_code <- tryCatch(sdm_classify_error(err_msg), error = function(ee) "INTERNAL_ERROR")
  meta$error <- err_msg
  meta$error_code <- err_code
  meta$error_hint <- tryCatch(SDM_ERR_CODES[[err_code]]$hint, error = function(ee) NA_character_)
  meta$error_traceback <- paste(utils::tail(traceback(), 10), collapse = "\n")
  # Capture GPU memory snapshot on CUDA/HIP/ROCm memory and runtime failures.
  if (grepl("CUDA|cuda|HIP|hip|ROCm|rocm|HSA|out of memory|OOM", err_msg, ignore.case = TRUE)) {
    tryCatch({
      meta$gpu_memory_mb <- list(
        free = sdm_gpu_available_vram(),
        total = sdm_gpu_total_vram()
      )
      if (requireNamespace("torch", quietly = TRUE) && torch::torch_is_installed()) {
        stats <- torch::cuda_memory_stats()
        meta$gpu_memory_mb$allocated_mb <- stats$allocated_bytes$all$current %/% (1024L * 1024L)
        meta$gpu_memory_mb$reserved_mb <- stats$reserved_bytes$all$current %/% (1024L * 1024L)
      }
    }, error = function(e) NULL)
  }
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  write_meta(meta)
  cat("Run failed [", err_code, "]:", err_msg, "\n")
})
