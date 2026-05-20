#* Run SDM model
#* @post /api/v1/models/run
#* @param species
#* @param model_id
#* @param biovars
#* @param projection_extent
#* @param background_n
#* @param cv_folds
#* @param cv_strategy
#* @param threshold
#* @param include_quadratic
#* @param n_cores
#* @param seed
#* @param occurrence_file
#* @param worldclim_dir
#* @param source
#* @param aggregation_factor
#* @param min_source_records
#* @param merge_small_sources
#* @param thin_by_cell
#* @param use_elevation
#* @param use_soil
#* @param use_uv
#* @param use_vegetation
#* @param use_lulc
#* @param use_hfp
#* @param future_projection
#* @param future_label
#* @param vif_reduction
#* @param bias_method
#* @param pa_replicates
#* @param thickening_distance_km
#* @param output_dir
function(req) {
  body <- tryCatch(jsonlite::fromJSON(req$postBody), error = function(e) NULL)
  if (is.null(body)) return(list(error = "Invalid JSON body"), 400)

  required <- c("species", "model_id", "occurrence_file")
  missing <- setdiff(required, names(body))
  if (length(missing) > 0) {
    return(list(error = paste("Missing required fields:", paste(missing, collapse = ", "))), 400)
  }

  biovars <- as.integer(unlist(strsplit(as.character(body$biovars %||% "1,4,6,12,15,18"), ",")))
  projection_extent <- as.numeric(unlist(strsplit(as.character(body$projection_extent %||% "112,154,-44,-10"), ",")))
  if (length(projection_extent) != 4) {
    return(list(error = "projection_extent must have 4 values: xmin,xmax,ymin,ymax"), 400)
  }

  job_id <- paste0("run-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path("outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  job_meta <- list(
    id = job_id,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config = as.list(body),
    output_dir = job_dir
  )
  job_meta_file <- file.path(job_dir, "meta.json")
  writeLines(jsonlite::toJSON(job_meta, auto_unbox = TRUE, pretty = TRUE), job_meta_file)

  progress_log <- file.path(job_dir, "progress.log")

  log_fun <- function(...) {
    msg <- paste0(format(Sys.time(), "%H:%M:%S"), " ", ...)
    cat(msg, "\n")
    cat(msg, "\n", file = progress_log, append = TRUE)
  }

  progress_fun <- function(pct, msg) {
    log_line <- paste0(format(Sys.time(), "%H:%M:%S"), " [", sprintf("%.0f", pct * 100), "%] ", msg)
    cat(log_line, "\n")
    cat(log_line, "\n", file = progress_log, append = TRUE)
  }

  run_bg <- function() {
    tryCatch({
      cfg <- sdm_config(
        species = body$species,
        occurrence_file = body$occurrence_file,
        worldclim_dir = body$worldclim_dir %||% sdm_default_worldclim_dir,
        selected_biovars = biovars,
        projection_extent = projection_extent,
        background_n = as.integer(body$background_n %||% sdm_default_background_n),
        min_source_records = as.integer(body$min_source_records %||% sdm_default_min_source_records),
        merge_small_sources = isTRUE(body$merge_small_sources %||% TRUE),
        thin_by_cell = isTRUE(body$thin_by_cell %||% TRUE),
        model_id = body$model_id,
        include_quadratic = isTRUE(body$include_quadratic %||% TRUE),
        threshold = as.numeric(body$threshold %||% sdm_default_threshold),
        aggregation_factor = as.integer(body$aggregation_factor %||% 1L),
        cv_folds = as.integer(body$cv_folds %||% sdm_default_cv_folds),
        n_cores = as.integer(body$n_cores %||% 1L),
        allow_download = TRUE,
        worldclim_res = as.integer(body$worldclim_res %||% sdm_default_worldclim_res),
        cv_strategy = body$cv_strategy %||% sdm_default_cv_strategy,
        cv_block_size_km = if (!is.null(body$cv_block_size_km)) as.numeric(body$cv_block_size_km) else sdm_default_cv_block_size_km,
        use_elevation = isTRUE(body$use_elevation),
        elevation_demtype = body$elevation_demtype %||% sdm_default_elevation_demtype,
        opentopo_api_key = body$opentopo_api_key,
        use_soil = isTRUE(body$use_soil),
        selected_soil_vars = body$soil_vars %||% sdm_default_soil_vars,
        selected_soil_depths = body$soil_depths %||% sdm_default_soil_depths,
        use_uv = isTRUE(body$use_uv),
        selected_uv_vars = body$uv_vars %||% sdm_default_uv_vars,
        use_vegetation = isTRUE(body$use_vegetation),
        veg_year = as.integer(body$veg_year %||% sdm_default_veg_year),
        veg_products = body$veg_products %||% sdm_default_veg_products,
        use_lulc = isTRUE(body$use_lulc),
        lulc_year = as.integer(body$lulc_year %||% sdm_default_lulc_year),
        use_hfp = isTRUE(body$use_hfp),
        hfp_year = as.integer(body$hfp_year %||% sdm_default_hfp_year),
        use_bioclim_season = isTRUE(body$use_bioclim_season),
        use_drought = isTRUE(body$use_drought),
        covariate_cache_dir = "covariates",
        vif_reduction = isTRUE(body$vif_reduction),
        vif_threshold = as.numeric(body$vif_threshold %||% 10),
        future_projection = isTRUE(body$future_projection),
        future_worldclim_dir = body$future_worldclim_dir %||% sdm_default_future_worldclim_dir,
        future_label = body$future_label %||% "Future climate",
        maxnet_features = body$maxnet_features %||% sdm_default_maxnet_features,
        maxnet_regmult = as.numeric(body$maxnet_regmult %||% sdm_default_maxnet_regmult),
        bias_method = body$bias_method %||% "uniform",
        thickening_distance_km = as.numeric(body$thickening_distance_km %||% sdm_default_thinning_distance_km),
        pa_replicates = as.integer(body$pa_replicates %||% sdm_default_pa_replicates),
        output_dir = job_dir,
        seed = as.integer(body$seed %||% sdm_default_seed),
        source = body$source %||% sdm_default_climate_source,
        log_fun = log_fun,
        progress_fun = progress_fun
      )

      result <- run_fast_sdm(cfg)

      job_meta$status <<- "completed"
      job_meta$completed_at <<- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      if (!is.null(result)) {
        job_meta$metrics <<- list(
          auc_mean = result$cv$auc_mean,
          auc_sd = result$cv$auc_sd,
          tss_mean = result$cv$tss_mean,
          tss_sd = result$cv$tss_sd,
          presence_records = result$metrics$presence_records,
          background_points = result$metrics$background_points,
          elapsed_seconds = result$metrics$elapsed_seconds,
          high_suitability_area_km2 = result$summary$high_risk_area_km2
        )
        job_meta$output_files <<- result$paths
      }
      writeLines(jsonlite::toJSON(job_meta, auto_unbox = TRUE, pretty = TRUE), job_meta_file)
    }, error = function(e) {
      job_meta$status <<- "failed"
      job_meta$error <<- conditionMessage(e)
      job_meta$completed_at <<- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      writeLines(jsonlite::toJSON(job_meta, auto_unbox = TRUE, pretty = TRUE), job_meta_file)
      cat("Run failed:", conditionMessage(e), "\n")
    })
  }

  callr::r_bg(run_bg)

  list(
    job_id = job_id,
    status = "running",
    message = "Model run started in background"
  )
}

#* Get model run status
#* @get /api/v1/models/status/<job_id>
function(job_id) {
  job_dir <- file.path("outputs", "jobs", job_id)
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    return(list(error = "Run not found"), 404)
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

  progress_lines <- character(0)
  if (file.exists(progress_file)) {
    progress_lines <- tail(readLines(progress_file, warn = FALSE), 20)
  }

  list(
    id = meta$id,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    metrics = meta$metrics %||% NULL,
    output_files = meta$output_files %||% NULL,
    progress_log = progress_lines
  )
}

#* Cancel a running model
#* @post /api/v1/models/cancel/<job_id>
function(job_id) {
  options(sdm.cancelled = TRUE)
  list(ok = TRUE, message = "Cancellation requested")
}

#* List all model runs
#* @get /api/v1/models/runs
function() {
  jobs_dir <- file.path("outputs", "jobs")
  if (!dir.exists(jobs_dir)) return(list())

  job_dirs <- list.dirs(jobs_dir, recursive = FALSE, full.names = FALSE)
  runs <- lapply(job_dirs, function(jd) {
    meta_file <- file.path(jobs_dir, jd, "meta.json")
    if (file.exists(meta_file)) {
      meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
      list(
        id = meta$id,
        species = meta$config$species,
        model_id = meta$config$model_id,
        status = meta$status,
        started_at = meta$started_at,
        completed_at = meta$completed_at %||% NULL,
        metrics = meta$metrics %||% NULL
      )
    } else NULL
  })
  Filter(Negate(is.null), runs)
}
