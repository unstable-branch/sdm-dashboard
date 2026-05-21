#* SDM Platform - Plumber Computation API
#* @apiTitle SDM Computation API
#* @apiDescription R-based computation endpoints for the SDM Platform

library(jsonlite)

# Resolve project root: Docker uses /app, local uses parent of plumber/R/
app_dir <- if (dir.exists("/app/R")) "/app" else normalizePath(file.path(getwd(), ".."), winslash = "/")

# Source bootstrap to get sdm_project_root() and source load.R
source(file.path(app_dir, "R", "core", "bootstrap.R"))
sdm_set_project_root(app_dir)

# Source existing R modules
load_path <- file.path(app_dir, "R", "load.R")
if (!file.exists(load_path)) {
  stop("Could not find R/load.R at: ", load_path, call. = FALSE)
}
source(load_path)

# Helper for error responses
sdm_error <- function(req, status, message) {
  req$res$status <- status
  list(error = message)
}

# --- Data endpoints ---

#* Upload occurrence file (CSV/TSV/ZIP)
#* @param file The occurrence file to upload
#* @post /api/v1/occurrences/upload
function(req) {
  uploaded <- req$args$file
  if (is.null(uploaded)) {
    return(sdm_error(req, 400, "No file uploaded. Send multipart/form-data with field 'file'."))
  }

  # Plumber provides file content as raw vector in uploaded$content
  # or as tempfile path in uploaded$tempfile
  file_path <- if (is.list(uploaded)) {
    if (!is.null(uploaded$tempfile) && nzchar(uploaded$tempfile)) {
      uploaded$tempfile
    } else if (!is.null(uploaded$path) && nzchar(uploaded$path)) {
      uploaded$path
    } else {
      # Find raw content field
      raw_field <- NULL
      for (n in names(uploaded)) {
        if (is.raw(uploaded[[n]])) {
          raw_field <- n
          break
        }
      }
      if (!is.null(raw_field)) {
        tmp <- tempfile(fileext = paste0(".", tolower(tools::file_ext(uploaded$name %||% "csv"))))
        writeBin(uploaded[[raw_field]], tmp)
        tmp
      } else {
        # Debug: write field names to file
        cat("Uploaded field names:", paste(names(uploaded), collapse=", "), "\n", file = "/tmp/plumber_debug.txt")
        cat("Uploaded field classes:", paste(sapply(names(uploaded), function(n) class(uploaded[[n]])), collapse=", "), "\n", file = "/tmp/plumber_debug.txt", append = TRUE)
        NULL
      }
    }
  } else if (is.character(uploaded)) {
    uploaded
  } else {
    NULL
  }

  if (is.null(file_path) || !file.exists(file_path)) {
    return(sdm_error(req, 400, paste("Uploaded file not found:", file_path %||% "unknown")))
  }

  tryCatch({
    ext <- tolower(tools::file_ext(uploaded$name %||% ""))
    is_dwca <- ext == "zip"

    upload_dir <- file.path(app_dir, "data", "uploads")
    dir.create(upload_dir, recursive = TRUE, showWarnings = FALSE)
    safe_name <- gsub("[^a-zA-Z0-9._-]", "_", uploaded$name %||% "upload")
    dest_path <- file.path(upload_dir, paste0(format(Sys.time(), "%Y%m%d_%H%M%S_"), safe_name))
    file.copy(file_path, dest_path, overwrite = TRUE)
    rel_path <- file.path("data", "uploads", basename(dest_path))

    if (is_dwca) {
      result <- read_dwca(file_path, log_fun = message)
      occ <- result$occurrences
      n_rows <- nrow(occ)
      species_detected <- if ("species" %in% names(occ)) {
        unique(occ$species)[1] %||% NA_character_
      } else {
        NA_character_
      }
      columns_detected <- list(
        longitude = if ("x" %in% names(occ)) "x" else NA_character_,
        latitude = if ("y" %in% names(occ)) "y" else NA_character_
      )
      preview <- head(occ, 5)
      preview <- lapply(seq_len(nrow(preview)), function(i) as.list(preview[i, ]))

      list(
        file_id = dest_path,
        file_path = rel_path,
        filename = uploaded$name,
        format = "dwca",
        n_rows = n_rows,
        n_returned = result$n_returned,
        species_detected = species_detected,
        doi = result$doi,
        columns_detected = columns_detected,
        preview = preview,
        datasets = result$datasets,
        issues_flagged_count = if (!is.null(result$issues_flagged)) nrow(result$issues_flagged) else 0L
      )
    } else {
      occ <- read_occurrence_file(file_path, log_fun = message)
      n_rows <- nrow(occ)
      lon_col <- detect_column(names(occ), c("^(lon|longitude|x)$", "^long"))
      lat_col <- detect_column(names(occ), c("^(lat|latitude|y)$", "^lat"))
      src_col <- detect_column(names(occ), c("^(source|datasource|institution|institutioncode)$"))
      species_detected <- infer_species_label(file_path)
      columns_detected <- list(
        longitude = lon_col,
        latitude = lat_col,
        source = src_col
      )
      preview <- head(occ, 5)
      preview <- lapply(seq_len(nrow(preview)), function(i) as.list(preview[i, ]))

      list(
        file_id = dest_path,
        file_path = rel_path,
        filename = uploaded$name,
        format = if (ext %in% c("tsv", "txt")) "tsv" else "csv",
        n_rows = n_rows,
        species_detected = species_detected,
        columns_detected = columns_detected,
        preview = preview
      )
    }
  }, error = function(e) {
    sdm_error(req, 400, conditionMessage(e))
  })
}

#* Clean occurrence data with configurable options
#* @param file_id The uploaded file path or ID
#* @param min_source_records Minimum records per source to keep (default: 15)
#* @param merge_small_sources Merge small sources (default: true)
#* @param use_cc Run CoordinateCleaner (default: false)
#* @param cc_tests CC tests to run: all, sea, capitals, centroids, institutions, urban, zero (default: all)
#* @post /api/v1/occurrences/clean
function(req, file_id, min_source_records = 15, merge_small_sources = TRUE, use_cc = FALSE, cc_tests = "all") {
  min_source_records <- suppressWarnings(as.integer(min_source_records))
  if (!is.finite(min_source_records)) min_source_records <- 15L

  tryCatch({
    result <- clean_occurrences(
      path = file_id,
      min_source_records = min_source_records,
      merge_small_sources = as.logical(merge_small_sources),
      use_cc = as.logical(use_cc),
      cc_tests = cc_tests,
      log_fun = message
    )

    occ <- result$occ
    source_counts <- result$source_counts

    list(
      cleaned_id = file_id,
      valid_records = nrow(occ),
      original_rows = result$original_rows,
      removed_bad_coordinates = result$removed_bad_coordinates,
      removed_duplicates = result$removed_duplicates,
      n_absent_excluded = result$n_absent_excluded,
      source_counts = as.list(source_counts),
      cc_flagged = if ("cc_flag" %in% names(occ)) sum(occ$cc_flag, na.rm = TRUE) else 0L,
      training_extent = make_training_extent(occ, buffer = 2),
      occurrence_preview = lapply(seq_len(min(5, nrow(occ))), function(i) as.list(occ[i, ]))
    )
  }, error = function(e) {
    sdm_error(req, 400, conditionMessage(e))
  })
}

#* Search GBIF for occurrence records
#* @param taxon Species name (e.g., "Acacia mearnsii")
#* @param country Country code filter (e.g., "AU")
#* @param max_records Maximum records to fetch (default: 100)
#* @post /api/v1/occurrences/gbif/search
function(req, taxon, country = NULL, max_records = 100) {
  if (is.null(taxon) || !nzchar(taxon)) {
    return(sdm_error(req, 400, "taxon is required"))
  }

  max_records <- suppressWarnings(as.integer(max_records))
  if (!is.finite(max_records) || max_records < 1) max_records <- 100L

  tryCatch({
    occ <- read_gbif_records(
      taxon = taxon,
      country = if (!is.null(country) && nzchar(country)) country else NULL,
      max_records = max_records,
      log_fun = message
    )

    list(
      taxon = taxon,
      country = country,
      n_records = nrow(occ),
      max_records = max_records,
      doi = if (!is.null(occ$gbif_doi[1]) && nzchar(occ$gbif_doi[1])) occ$gbif_doi[1] else NA_character_,
      preview = lapply(seq_len(min(5, nrow(occ))), function(i) as.list(occ[i, ]))
    )
  }, error = function(e) {
    sdm_error(req, 502, paste("GBIF search failed:", conditionMessage(e)))
  })
}

#* Parse a Darwin Core Archive (.zip file)
#* @param file_id Path to the uploaded .zip file
#* @param species_filter Optional species name filter
#* @param max_coord_uncertainty_m Max coordinate uncertainty in meters
#* @param basis_of_record_filter Basis of record values to include (comma-separated)
#* @post /api/v1/occurrences/dwca
function(req, file_id, species_filter = NULL, max_coord_uncertainty_m = NULL, basis_of_record_filter = NULL) {
  if (is.null(file_id) || !nzchar(file_id)) {
    return(sdm_error(req, 400, "file_id is required"))
  }

  max_unc <- if (!is.null(max_coord_uncertainty_m)) {
    suppressWarnings(as.numeric(max_coord_uncertainty_m))
  } else {
    Inf
  }
  if (!is.finite(max_unc)) max_unc <- Inf

  bor_filter <- if (!is.null(basis_of_record_filter) && nzchar(basis_of_record_filter)) {
    strsplit(basis_of_record_filter, ",")[[1]]
  } else {
    NULL
  }

  tryCatch({
    result <- read_dwca(
      dwca_path = file_id,
      species_filter = if (!is.null(species_filter) && nzchar(species_filter)) species_filter else NULL,
      max_coord_uncertainty_m = max_unc,
      basis_of_record_filter = bor_filter,
      log_fun = message
    )

    occ <- result$occurrences
    list(
      doi = result$doi,
      n_raw = result$n_raw,
      n_returned = result$n_returned,
      datasets = result$datasets,
      issues_flagged_count = if (!is.null(result$issues_flagged)) nrow(result$issues_flagged) else 0L,
      preview = lapply(seq_len(min(5, nrow(occ))), function(i) as.list(occ[i, ]))
    )
  }, error = function(e) {
    sdm_error(req, 400, conditionMessage(e))
  })
}

# --- Model endpoints ---

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
  if (is.null(body)) return(sdm_error(req, 400, "Invalid JSON body"))

  required <- c("species", "model_id", "occurrence_file")
  missing <- setdiff(required, names(body))
  if (length(missing) > 0) {
    return(sdm_error(req, 400, paste("Missing required fields:", paste(missing, collapse = ", "))))
  }

  biovars <- as.integer(unlist(strsplit(as.character(body$biovars %||% "1,4,6,12,15,18"), ",")))
  projection_extent <- as.numeric(unlist(strsplit(as.character(body$projection_extent %||% "112,154,-44,-10"), ",")))
  if (length(projection_extent) != 4) {
    return(sdm_error(req, 400, "projection_extent must have 4 values: xmin,xmax,ymin,ymax"))
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

#* Health check
#* @get /health
function() {
  list(
    status = "ok",
    r_version = R.version.string,
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  )
}

#* Get model config defaults
#* @get /api/v1/config/defaults
function() {
  list(
    biovars = sdm_default_biovars,
    background_n = sdm_default_background_n,
    cv_folds = sdm_default_cv_folds,
    cv_strategy = sdm_default_cv_strategy,
    threshold = sdm_default_threshold,
    extent_presets = sdm_extent_choices
  )
}

#* List available models
#* @get /api/v1/models
function() {
  ids <- sdm_model_ids()
  choices <- sdm_model_choices()
  lapply(ids, function(id) {
    list(id = id, label = choices[id])
  })
}
