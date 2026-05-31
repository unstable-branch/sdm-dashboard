#!/usr/bin/env Rscript
# Background model run script.
# Called by callr::r_bg via Plumber's POST /api/v1/models/run.
# Reads job config from <job_dir>/meta.json and writes results back.
# Prevents closure serialization issues with callr by running as a
# standalone script that sources all required SDM modules.

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

meta_file <- file.path(job_dir, "meta.json")
progress_file <- file.path(job_dir, "progress.log")

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
}

read_meta <- function() {
  jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
}

write_meta <- function(meta) {
  writeLines(jsonlite::toJSON(meta, null = "null", auto_unbox = TRUE, pretty = TRUE), meta_file)
}

# Source all SDM modules in the child process
source(file.path(app_dir, "R", "core", "bootstrap.R"))
sdm_set_project_root(app_dir)
source(file.path(app_dir, "R", "load.R"))

meta <- read_meta()
config <- meta$config %||% list()

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

tryCatch({
  cleaned_occurrence <- NULL
  if (!is.null(config$cleaned_file_id) && nzchar(config$cleaned_file_id) && file.exists(config$cleaned_file_id)) {
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

  cfg <- sdm_config(
    species = config$species,
    occurrence_file = config$occurrence_file,
    cleaned_occurrence = cleaned_occurrence,
    worldclim_dir = config$worldclim_dir %||% sdm_default_worldclim_dir,
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
    n_cores = as.integer(config$n_cores %||% 1L),
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
    selected_uv_months = config$uv_months,
    use_vegetation = isTRUE(config$use_vegetation),
    veg_year = as.integer(config$veg_year %||% sdm_default_veg_year),
    veg_products = config$veg_products %||% sdm_default_veg_products,
    use_lulc = isTRUE(config$use_lulc),
    lulc_year = as.integer(config$lulc_year %||% sdm_default_lulc_year),
    use_hfp = isTRUE(config$use_hfp),
    hfp_year = as.integer(config$hfp_year %||% sdm_default_hfp_year),
    use_bioclim_season = isTRUE(config$use_bioclim_season),
    use_drought = isTRUE(config$use_drought),
    selected_drought_periods = config$drought_periods %||% "annual_mean",
    covariate_cache_dir = "covariates",
    vif_reduction = isTRUE(config$vif_reduction),
    vif_threshold = as.numeric(config$vif_threshold %||% 10),
    future_projection = isTRUE(config$future_projection),
    future_worldclim_dir = config$future_worldclim_dir %||% sdm_default_future_worldclim_dir,
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
    multi_ensemble_weighting = config$multi_ensemble_weighting,
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
    selected_chelsa_extras = config$chelsa_extras %||% NULL,
    future_worldclim_dir2 = config$future_worldclim_dir2,
    future_label2 = config$future_label2 %||% "Future climate 2",
    use_cc = isTRUE(config$use_cc),
    cc_tests = config$cc_tests %||% "all",
    analysis_crs = config$analysis_crs %||% sdm_default_analysis_crs,
    generate_tiles = isTRUE(config$generate_tiles %||% TRUE),
    mask_type = config$mask_type %||% sdm_default_mask_type,
    mask_file = config$mask_file %||% sdm_default_mask_file,
    mask_buffer_deg = as.numeric(config$mask_buffer_deg %||% sdm_default_mask_buffer_deg),
    rangebag_n_bags = as.integer(config$rangebag_n_bags %||% sdm_default_rangebag_n_bags),
    rangebag_bag_fraction = as.numeric(config$rangebag_bag_fraction %||% sdm_default_rangebag_fraction),
    rangebag_vars_per_bag = as.integer(config$rangebag_vars_per_bag %||% sdm_default_rangebag_vars_per_bag),
    maxnet_auto_tune = isTRUE(config$maxnet_auto_tune %||% FALSE),
    rf_num_trees = as.integer(config$rf_num_trees %||% 500L),
    rf_mtry = as.integer(config$rf_mtry %||% NA_integer_),
    rf_min_node_size = as.integer(config$rf_min_node_size %||% 10L),
    gam_k = as.integer(config$gam_k %||% 5L),
    xgb_max_depth = as.integer(config$xgb_max_depth %||% 6L),
    xgb_eta = as.numeric(config$xgb_eta %||% 0.3),
    xgb_nrounds = as.integer(config$xgb_nrounds %||% 100L),
    dnn_model_type = config$dnn_model_type %||% "DNN_Medium",
    dnn_dropout = as.numeric(config$dnn_dropout %||% 0.3),
    dnn_lambda = as.numeric(config$dnn_lambda %||% 0.001)
  )

  result <- run_fast_sdm(cfg)

  # Save full result object for diagnostic/ecology API endpoints
  result_rds_path <- file.path(job_dir, "result.rds")
  tryCatch({
    saveRDS(result, result_rds_path)
    log_fun("Saved result RDS to: ", result_rds_path)
  }, error = function(e) {
    log_fun("Failed to save result RDS: ", conditionMessage(e))
  })

  # Generate diagnostic PNG plots
  diag_files <- list()
  tryCatch({
    source(file.path(app_dir, "R", "output", "diagnostics_plots.R"), local = TRUE)
    diag_files <- save_diagnostic_plots(result, job_dir, log_fun = log_fun)
  }, error = function(e) {
    cat("Diagnostic plots failed:", conditionMessage(e), "\n")
    cat(conditionMessage(e), "\n", file = progress_file, append = TRUE)
  })

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
      cbi_diff = result$metrics$cbi_diff
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
  write_meta(meta)
  gc(verbose = FALSE)
}, error = function(e) {
  meta$status <- "failed"
  meta$error <- conditionMessage(e)
  meta$error_traceback <- paste(utils::tail(traceback(), 10), collapse = "\n")
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  write_meta(meta)
  cat("Run failed:", conditionMessage(e), "\n")
  cat("Traceback:\n")
  print(utils::tail(traceback(), 10))
})
