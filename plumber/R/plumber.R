#* SDM Platform - Plumber Computation API
#* @apiTitle SDM Computation API
#* @apiDescription R-based computation endpoints for the SDM Platform

library(jsonlite)

# Resolve project root: Docker uses /app, local uses tree-walk to find R/core/bootstrap.R
app_dir <- if (dir.exists("/app/R")) {
  "/app"
} else {
  d <- getwd()
  for (i in 1:10) {
    if (file.exists(file.path(d, "R", "core", "bootstrap.R"))) {
      break
    }
    d <- dirname(d)
  }
  normalizePath(d, winslash = "/")
}

# Source bootstrap to get sdm_project_root() and source load.R
source(file.path(app_dir, "R", "core", "bootstrap.R"))
sdm_set_project_root(app_dir)

# Source existing R modules
load_path <- file.path(app_dir, "R", "engine_load.R")
  if (!file.exists(load_path)) {
    # Fall back to full load.R for backward compatibility
    load_path <- file.path(app_dir, "R", "load.R")
  }
  if (!file.exists(load_path)) {
    stop("Could not find R/load.R at: ", load_path, call. = FALSE)
}
source(load_path)

# Load structured error code taxonomy
error_codes_path <- file.path(app_dir, "plumber", "R", "error_codes.R")
if (file.exists(error_codes_path)) {
  source(error_codes_path)
}

# Atomically write JSON to a file (tempfile + rename to avoid partial reads)
sdm_write_json <- function(obj, path, ...) {
  tmp_path <- tempfile(pattern = basename(path), tmpdir = dirname(path))
  on.exit(unlink(tmp_path))
  writeLines(jsonlite::toJSON(obj, auto_unbox = TRUE, pretty = TRUE, ...), tmp_path)
  file.rename(tmp_path, path)
}

# Helper for error responses
sdm_error <- function(req, status, message) {
  res <- tryCatch(req$res, error = function(e) NULL)
  if (!is.null(res)) {
    tryCatch(res$status <- status, error = function(e) NULL)
  }
  list(error = message)
}

# Safe path resolution — restricts access to a base directory
sdm_safe_path <- function(input_path, base_dir) {
  base_dir <- normalizePath(base_dir, winslash = "/", mustWork = FALSE)
  resolved <- normalizePath(file.path(base_dir, basename(input_path)), winslash = "/", mustWork = FALSE)
  base_norm <- normalizePath(base_dir, winslash = "/", mustWork = TRUE)
  if (startsWith(resolved, paste0(base_norm, "/")) || identical(resolved, base_norm)) {
    return(resolved)
  }
  NULL
}

# Safe job directory — ensures run_id stays within outputs/jobs
sdm_safe_job_dir <- function(run_id) {
  jobs_base <- file.path(app_dir, "outputs", "jobs")
  dir.create(jobs_base, recursive = TRUE, showWarnings = FALSE)
  jobs_base <- normalizePath(jobs_base, winslash = "/", mustWork = TRUE)
  resolved <- normalizePath(file.path(jobs_base, basename(run_id)), winslash = "/", mustWork = FALSE)
  if (startsWith(resolved, paste0(jobs_base, "/")) || identical(resolved, jobs_base)) {
    return(resolved)
  }
  NULL
}

# --- Data endpoints ---

#* Upload occurrence file (CSV/TSV/ZIP)
#* @param file The occurrence file to upload
#* @post /api/v1/occurrences/upload
function(req) {
  uploaded <- req$args$file

  tryCatch({
    # Support JSON body with file_path (from Hono file-path forwarding)
    if (is.null(uploaded)) {
      post_body <- jsonlite::fromJSON(req$postBody)
      if (!is.null(post_body$file_path) && nzchar(post_body$file_path)) {
        safe_path <- sdm_safe_path(post_body$file_path, file.path(app_dir, "data", "uploads"))
        if (!is.null(safe_path)) {
          uploaded <- list(
            datapath = safe_path,
            filename = post_body$file_id %||% basename(post_body$file_path)
          )
        }
      }
    }

    if (is.null(uploaded)) {
      return(sdm_error(req, 400, "No file uploaded. Send multipart/form-data with field 'file' or JSON with 'file_path'."))
    }

    file_path <- if (is.list(uploaded)) {
      if (!is.null(uploaded$tempfile) && nzchar(uploaded$tempfile)) {
        uploaded$tempfile
      } else if (!is.null(uploaded$datapath) && nzchar(uploaded$datapath)) {
        uploaded$datapath
      } else if (!is.null(uploaded$path) && nzchar(uploaded$path)) {
        uploaded$path
      } else {
        # Find raw content field (typically "value" or "content")
        raw_field <- NULL
        for (n in names(uploaded)) {
          if (is.raw(uploaded[[n]])) {
            raw_field <- n
            break
          }
        }
        if (!is.null(raw_field)) {
          tmp <- tempfile(fileext = paste0(".", tolower(tools::file_ext(uploaded$filename %||% "csv"))))
          con <- file(tmp, "wb")
          writeBin(uploaded[[raw_field]], con)
          close(con)
          tmp
        } else {
          # Try datapath as last resort (webutils)
          dp <- uploaded$datapath %||% uploaded$path %||% uploaded$tempfile
          if (!is.null(dp) && nzchar(dp[1])) {
            dp[1]
          } else {
            NULL
          }
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

    max_size <- 100 * 1024 * 1024
    if (file.info(file_path)$size > max_size) {
      return(sdm_error(req, 413, paste("File too large. Maximum", max_size / 1e6, "MB.")))
    }

    ext <- tolower(tools::file_ext(uploaded$filename %||% ""))
    is_dwca <- ext == "zip"

    upload_dir <- file.path(app_dir, "data", "uploads")
    dir.create(upload_dir, recursive = TRUE, showWarnings = FALSE)
    safe_name <- gsub("[^a-zA-Z0-9._-]", "_", uploaded$filename %||% "upload")
    dest_path <- file.path(upload_dir, paste0(format(Sys.time(), "%Y%m%d_%H%M%S_"), safe_name))
    if (!file.copy(file_path, dest_path, overwrite = TRUE)) {
      stop(paste("Failed to save uploaded file to:", dest_path), call. = FALSE)
    }
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
        filename = uploaded$filename %||% uploaded$name,
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

      # Normalize column names (detect and rename lon/lat to standard names)
      occ <- normalize_coord_columns(occ)
      src_col <- detect_column(names(occ), c("^(source|datasource|institution|institutioncode)$"))

      # Validate required columns exist after normalization
      has_lon <- "longitude" %in% names(occ)
      has_lat <- "latitude" %in% names(occ)
      missing_cols <- character(0)
      if (!has_lon) missing_cols <- c(missing_cols, "longitude")
      if (!has_lat) missing_cols <- c(missing_cols, "latitude")
      if (length(missing_cols) > 0) {
        found_cols <- names(occ)
        return(sdm_error(req, 400, paste0(
          "CSV is missing required coordinate columns: ", paste(missing_cols, collapse = ", "),
          ". Detected columns: ", paste(found_cols, collapse = ", "),
          ". Expected column names: longitude/long/lon/x/decimalLongitude for X, ",
          "and latitude/lat/y/decimalLatitude for Y."
        )))
      }

      # Parse coordinates (handle DMS formats like DD°MM'SS")
      occ <- parse_coordinates(occ)

      # Validate coordinate values (non-fatal — always save the file)
      coord_warnings <- character(0)
      if ("longitude" %in% names(occ) && "latitude" %in% names(occ)) {
        n_total <- length(occ$longitude)
        n_na_lon <- sum(is.na(suppressWarnings(as.numeric(gsub(",", ".", as.character(occ$longitude))))))
        n_na_lat <- sum(is.na(suppressWarnings(as.numeric(gsub(",", ".", as.character(occ$latitude))))))
        n_non_numeric <- max(n_na_lon, n_na_lat)

        if (n_non_numeric > 0) {
          # Show sample values for debugging
          raw_lon <- utils::head(occ$longitude, 3)
          raw_lat <- utils::head(occ$latitude, 3)
          coord_warnings <- c(coord_warnings, paste0(
            n_non_numeric, " of ", n_total, " record(s) have unparseable coordinates. ",
            "Sample longitude values: [", paste(shQuote(raw_lon), collapse = ", "), "]. ",
            "Sample latitude values: [", paste(shQuote(raw_lat), collapse = ", "), "]."
          ))
        } else {
          # Only check bounds if coords are numeric
          coord_err <- validate_coords(occ$longitude, occ$latitude)
          if (nchar(coord_err) > 0) {
            coord_warnings <- c(coord_warnings, paste0("Coordinate validation: ", coord_err))
          }
        }
      }

      columns_detected <- list(
        longitude = "longitude",
        latitude = "latitude",
        source = src_col
      )
      species_detected <- infer_species_label(file_path)
      preview <- head(occ, 5)
      preview <- lapply(seq_len(nrow(preview)), function(i) as.list(preview[i, ]))

      list(
        file_id = dest_path,
        file_path = rel_path,
        filename = uploaded$filename %||% uploaded$name,
        format = if (ext %in% c("tsv", "txt")) "tsv" else "csv",
        n_rows = n_rows,
        species_detected = species_detected,
        columns_detected = columns_detected,
        coord_warnings = if (length(coord_warnings) > 0) coord_warnings else NULL,
        preview = preview
      )
    }
  }, error = function(e) {
    sdm_error(req, 400, conditionMessage(e))
  })
}

#* Clean occurrence data with configurable options (async)
#* @param file_id The uploaded file path or ID
#* @param min_source_records Minimum records per source to keep (default: 15)
#* @param merge_small_sources Merge small sources (default: true)
#* @param use_cc Run CoordinateCleaner (default: false)
#* @param cc_tests CC tests to run: all, sea, capitals, centroids, institutions, urban, zero (default: all)
#* @post /api/v1/occurrences/clean
function(req, file_id, min_source_records = 15, merge_small_sources = TRUE, use_cc = FALSE, cc_tests = "all") {
  min_source_records <- suppressWarnings(as.integer(min_source_records))
  if (!is.finite(min_source_records)) min_source_records <- 15L

  safe_path <- sdm_safe_path(file_id, file.path(app_dir, "data", "uploads"))
  if (is.null(safe_path)) {
    return(sdm_error(req, 400, "Invalid file_id"))
  }

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- sdm_async_submit("clean", list(
    file_id = file_id,
    min_source_records = min_source_records,
    merge_small_sources = merge_small_sources,
    use_cc = use_cc,
    cc_tests = cc_tests
  ), app_dir, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "Occurrence cleaning started in background"
  )
}

#* Search GBIF for occurrence records (async)
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

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- sdm_async_submit("gbif", list(
    taxon = taxon,
    country = country,
    max_records = max_records
  ), app_dir, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "GBIF search started in background"
  )
}

#* Parse a Darwin Core Archive (.zip file) (async)
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

  safe_path <- sdm_safe_path(file_id, file.path(app_dir, "data", "uploads"))
  if (is.null(safe_path)) {
    return(sdm_error(req, 400, "Invalid file_id"))
  }

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- sdm_async_submit("dwca", list(
    file_id = file_id,
    species_filter = if (!is.null(species_filter) && nzchar(species_filter)) species_filter else NULL,
    max_coord_uncertainty_m = max_unc,
    basis_of_record_filter = bor_filter
  ), app_dir, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "Darwin Core Archive parsing started in background"
  )
}

# --- Model endpoints ---

#* Run SDM model
# Standalone function for background model runs — callr::r_bg serializes this to a clean R process
# All dependencies must be passed as explicit args or sourced internally
run_model_background <- function(body, biovars, projection_extent, job_dir, app_dir, job_id) {
  # Source required R files in the clean child process
  source(file.path(app_dir, "R", "core", "bootstrap.R"))
  sdm_set_project_root(app_dir)
  source(file.path(app_dir, "R", "engine_load.R"))

  # Load error code taxonomy (for error handler in run_sdm_async)
  error_codes_path <- file.path(app_dir, "plumber", "R", "error_codes.R")
  if (file.exists(error_codes_path)) source(error_codes_path)

  # Resolve occurrence_file path: accept both container paths (/app/data/uploads/...)
  # and host paths (/home/jacob/.../data/uploads/...)
  if (!is.null(body$occurrence_file) && nzchar(body$occurrence_file) && !file.exists(body$occurrence_file)) {
    alt_path <- file.path(app_dir, "data", "uploads", basename(body$occurrence_file))
    if (file.exists(alt_path)) body$occurrence_file <- alt_path
  }

  `%||%` <- function(a, b) if (is.null(a)) b else a

  # Resource tracking helpers
  r_get_peak_memory_mb <- function() {
    if (file.exists("/proc/self/status")) {
      lines <- readLines("/proc/self/status", warn = FALSE)
      vmpeak <- grep("^VmPeak:", lines, value = TRUE)
      if (length(vmpeak) > 0) {
        kb <- as.numeric(gsub("[^0-9.]", "", vmpeak))
        if (is.finite(kb)) return(round(kb / 1024, 1))
      }
    }
    gc_info <- tryCatch(gc(verbose = FALSE, reset = FALSE), error = function(e) NULL)
    if (!is.null(gc_info) && is.matrix(gc_info) && ncol(gc_info) >= 2) {
      return(round(gc_info[2, 2] / 1024 / 1024, 1))
    }
    NA_real_
  }

  r_get_cpu_time_ms <- function(pt) {
    round((pt["user.self"] + pt["sys.self"]) * 1000, 0)
  }

  cpu_start <- proc.time()
  mem_start <- r_get_peak_memory_mb()

  job_meta_file <- file.path(job_dir, "meta.json")
  progress_log <- file.path(job_dir, "progress.log")
  progress_json_path <- file.path(job_dir, "progress.json")
  progress_json_list <- list()

  detect_stage <- function(detail) {
    if (is.null(detail)) return("unknown")
    d <- tolower(detail)
    if (grepl("clean", d)) return("clean")
    if (grepl("load|scal|covariate", d)) return("covariates")
    if (grepl("thin", d)) return("thinning")
    if (grepl("vif", d)) return("vif")
    if (grepl("fit|model", d)) return("fit")
    if (grepl("pa replicate", d)) return("pa_replicates")
    if (grepl("predict|projection", d)) return("predict")
    if (grepl("output", d)) return("output")
    if (grepl("future", d)) return("future")
    if (grepl("summaris", d)) return("summarize")
    if (grepl("esm", d)) return("esm")
    "unknown"
  }

  log_fun <- function(...) {
    msg <- paste0(format(Sys.time(), "%H:%M:%S"), " ", ...)
    cat(msg, "\n")
    cat(msg, "\n", file = progress_log, append = TRUE)
  }

  progress_fun <- function(x) {
    pct <- if (is.list(x)) x$value else x
    detail <- if (is.list(x)) x$detail else NULL
    pct_num <- as.numeric(pct)
    if (!is.finite(pct_num)) pct_num <- 0
    log_line <- paste0(format(Sys.time(), "%H:%M:%S"), " [", sprintf("%.0f", pct_num * 100), "%] ", detail %||% "")
    cat(log_line, "\n")
    cat(log_line, "\n", file = progress_log, append = TRUE)
    entry <- list(
      timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      percent = pct_num,
      detail = detail %||% "",
      stage = detect_stage(detail)
    )
    progress_json_list[[length(progress_json_list) + 1]] <<- entry
    writeLines(jsonlite::toJSON(progress_json_list, auto_unbox = TRUE, pretty = TRUE), progress_json_path)
    entry_json <- jsonlite::toJSON(entry, auto_unbox = TRUE)
    sdm_redis_progress_set(job_id, entry_json)
    if (sdm_redis_cancel_check(job_id)) {
      stop("CANCELLED")
    }
  }

  job_meta <- list(
    id = job_id,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config = as.list(body),
    output_dir = job_dir
  )

  tryCatch({
    cleaned_occurrence <- NULL
    if (!is.null(body$cleaned_file_id) && nzchar(body$cleaned_file_id) && file.exists(body$cleaned_file_id)) {
      cleaned_df <- utils::read.csv(body$cleaned_file_id, stringsAsFactors = FALSE)
      cleaned_occurrence <- list(
        df = cleaned_df,
        source_counts = list(),
        n_absent_excluded = 0,
        original_rows = nrow(cleaned_df)
      )
    }

    cfg <- sdm_config(
      species = body$species,
      occurrence_file = body$occurrence_file,
      cleaned_occurrence = cleaned_occurrence,
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
      brt_n_trees = as.integer(body$brtNTrees %||% 2000L),
      brt_interaction_depth = as.integer(body$brtInteractionDepth %||% 3L),
      brt_shrinkage = as.numeric(body$brtShrinkage %||% 0.01),
      brt_bag_fraction = as.numeric(body$brtBagFraction %||% 0.75),
      cta_cp = as.numeric(body$ctaCp %||% 0.01),
      cta_maxdepth = as.integer(body$ctaMaxdepth %||% 10L),
      cta_minsplit = as.integer(body$ctaMinsplit %||% 20L),
      mars_degree = as.integer(body$marsDegree %||% 2L),
      mars_penalty = as.numeric(body$marsPenalty %||% 3.0),
      fda_degree = as.integer(body$fdaDegree %||% 2L),
      ann_size = as.integer(body$annSize %||% 5L),
      ann_decay = as.numeric(body$annDecay %||% 0.01),
      ann_maxit = as.integer(body$annMaxit %||% 200L),
      dnn_model_type = body$dnnArchitecture %||% "DNN_Medium",
      dnn_n_seeds = as.integer(body$dnnNSeeds %||% 5L),
      dnn_device = body$dnnDevice %||% "auto",
      extrapolation_mask = isTRUE(body$extrapolationMask %||% TRUE),
      mess_threshold = as.numeric(body$messThreshold %||% 0),
      rf_num_trees = as.integer(body$rfNumTrees %||% 500L),
      rf_mtry = if (!is.null(body$rfMtry)) as.integer(body$rfMtry) else NULL,
      rf_min_node_size = as.integer(body$rfMinNodeSize %||% 10L),
      xgb_max_depth = as.integer(body$xgbMaxDepth %||% 6L),
      xgb_eta = as.numeric(body$xgbEta %||% 0.3),
      xgb_nrounds = as.integer(body$xgbNrounds %||% 100L),
      mars_nk = if (!is.null(body$marsNk)) as.integer(body$marsNk) else NULL,
      fda_nprune = if (!is.null(body$fdaNprune)) as.integer(body$fdaNprune) else NULL,
      ann_rang = as.numeric(body$annRang %||% 0.5),
      bart_ntree = as.integer(body$bartNtree %||% 200L),
      bart_ndpost = as.integer(body$bartNdpost %||% 1000L),
      bart_nskip = as.integer(body$bartNskip %||% 500L),
      brms_chains = as.integer(body$brmsChains %||% 4L),
      brms_iter = as.integer(body$brmsIter %||% 2000L),
      brms_warmup = as.integer(body$brmsWarmup %||% 1000L),
      inla_mesh_max_edge = if (!is.null(body$inlaMeshMaxEdge)) as.numeric(body$inlaMeshMaxEdge) else NULL,
      inla_mesh_cutoff = if (!is.null(body$inlaMeshCutoff)) as.numeric(body$inlaMeshCutoff) else NULL,
      inla_prior_range = if (!is.null(body$inlaPriorRange)) as.numeric(body$inlaPriorRange) else NULL,
      inla_prior_sigma = if (!is.null(body$inlaPriorSigma)) as.numeric(body$inlaPriorSigma) else NULL,
      n_bags = as.integer(body$rangebagNBags %||% sdm_default_rangebag_n_bags),
      bag_fraction = as.numeric(body$rangebagBagFraction %||% sdm_default_rangebag_fraction),
      vars_per_bag = as.integer(body$rangebagVarsPerBag %||% sdm_default_rangebag_vars_per_bag),
      detection_formula = body$detectionFormula %||% "~1",
      occupancy_model_type = body$detectionModelType %||% "occu",
      dnn_architecture = body$dnnMultispeciesArchitecture %||% "DNN_Medium",
      dnn_multispecies_n_seeds = as.integer(body$dnnMultispeciesNSeeds %||% 3L),
      bias_method = body$bias_method %||% "uniform",
      thickening_distance_km = as.numeric(body$thickening_distance_km %||% sdm_default_thickening_distance_km),
      pa_replicates = as.integer(body$pa_replicates %||% sdm_default_pa_replicates),
      output_dir = job_dir,
      seed = as.integer(body$seed %||% sdm_default_seed),
      source = body$source %||% sdm_default_climate_source,
      log_fun = log_fun,
      progress_fun = progress_fun,
      climate_matching = isTRUE(body$climate_matching),
      climate_matching_method = body$climate_matching_method %||% "mahalanobis",
      max_coordinate_uncertainty = if (!is.null(body$max_coordinate_uncertainty)) as.numeric(body$max_coordinate_uncertainty) else NULL,
      multi_ensemble_models = body$multiEnsembleModels %||% body$multi_ensemble_models,
      multi_ensemble_weighting = body$multiEnsembleWeighting %||% body$multi_ensemble_weighting %||% "auc",
      multi_ensemble_power = as.numeric(body$multiEnsemblePower %||% body$multi_ensemble_power %||% sdm_default_ensemble_power),
      multi_ensemble_min_auc = as.numeric(body$multiEnsembleMinAuc %||% body$multi_ensemble_min_auc %||% sdm_default_ensemble_min_auc),
      multi_ensemble_min_tss = as.numeric(body$multiEnsembleMinTss %||% body$multi_ensemble_min_tss %||% sdm_default_ensemble_min_tss),
      biomod2_models = body$biomod2Models %||% body$biomod2_models,
      esm_n_runs = as.integer(body$esm_n_runs %||% sdm_esm_default_n_runs),
      esm_split = body$esm_split %||% sdm_esm_default_split,
      esm_min_auc = as.numeric(body$esm_min_auc %||% sdm_esm_default_min_auc),
      esm_weighting_metric = body$esm_weighting_metric %||% "AUC",
      esm_power = as.numeric(body$esm_power %||% sdm_esm_default_power),
      esm_biovars = body$esm_biovars,
      future_worldclim_dir2 = body$future_worldclim_dir2,
      future_label2 = body$future_label2 %||% "Future climate 2",
      use_cc = isTRUE(body$use_cc),
      cc_tests = body$cc_tests %||% "all"
    )

    result <- run_fast_sdm(cfg)

    diag_files <- list()
    # Export diagnostic data as lightweight CSV ZIP (replaces old save_diagnostic_plots)
    tryCatch({
      source(file.path(app_dir, "R", "output", "export_diagnostics.R"), local = TRUE)
      zip_path <- export_diagnostics_csv(result, job_dir, log_fun = log_fun)
      if (!is.null(zip_path)) diag_files$diagnostics_zip <- zip_path
    }, error = function(e) {
      cat("Diagnostics CSV export failed:", conditionMessage(e), "\n")
      cat(conditionMessage(e), "\n", file = progress_log, append = TRUE)
    })

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
      cat(conditionMessage(e), "\n", file = progress_log, append = TRUE)
    })

    job_meta$status <- "completed"
    job_meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    cpu_ms <- r_get_cpu_time_ms(proc.time() - cpu_start)
    peak_mb <- r_get_peak_memory_mb()
    job_meta$r_cpu_time_ms <- cpu_ms
    job_meta$r_peak_memory_mb <- peak_mb
    if (!is.null(result)) {
      job_meta$metrics <- list(
        auc_mean = result$cv$auc_mean,
        auc_sd = result$cv$auc_sd,
        tss_mean = result$cv$tss_mean,
        tss_sd = result$cv$tss_sd,
        presence_records = result$metrics$presence_records,
        background_points = result$metrics$background_points,
        elapsed_seconds = result$metrics$elapsed_seconds,
        high_suitability_area_km2 = result$summary$high_risk_area_km2,
        high_suitability_area_uncertainty_km2 = result$summary$high_risk_area_uncertainty_km2 %||% NULL,
        high_suitability_area_ci95_lower = result$summary$high_risk_area_ci95_lower %||% NULL,
        high_suitability_area_ci95_upper = result$summary$high_risk_area_ci95_upper %||% NULL
      )
      # Write EPSG:3857 COG for web map display
      if (!is.null(result$paths$tif) && !is.null(result$suitability)) {
        tif_3857_path <- sub("_suitability\\.tif$", "_3857.tif", result$paths$tif)
        tryCatch({
          src_crs <- terra::crs(result$suitability)
          if (!grepl("EPSG:4326", src_crs)) {
            cat("WARNING: Suitability raster CRS is", src_crs, "expected EPSG:4326\n")
          }
          r_3857 <- terra::project(result$suitability, "EPSG:3857", method = "near")
          terra::writeRaster(r_3857, tif_3857_path,
            filetype = "COG",
            gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "BLOCKSIZE=512",
                     "OVERVIEWS=AUTO", "OVERVIEW_RESAMPLING=BILINEAR",
                     "NODATA=-9999"),
            NAflag = -9999,
            datatype = "FLT4S",
            overwrite = TRUE
          )
          result$paths$tif_3857 <- tif_3857_path
          log_fun("Written EPSG:3857 COG: ", tif_3857_path)
        }, error = function(e) {
          cat("EPSG:3857 COG failed:", conditionMessage(e), "\n")
          cat(conditionMessage(e), "\n", file = progress_log, append = TRUE)
        })
      }
      # Save full result object for diagnostics endpoints
      result_rds_path <- file.path(job_dir, "result.rds")
      tryCatch({
        saveRDS(result, result_rds_path)
        result$paths$result_rds <- result_rds_path
      }, error = function(e) {
        cat("Failed to save result.rds:", conditionMessage(e), "\n")
        cat(conditionMessage(e), "\n", file = progress_log, append = TRUE)
      })
      job_meta$output_files <- c(result$paths, diag_files)
      base_name <- paste0(safe_slug(body$species %||% "species"), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))
      manifest_path <- write_manifest(result, job_dir, base_name, cpu_ms = cpu_ms, peak_mb = peak_mb)
      job_meta$manifest_path <- manifest_path
    }
    gc(verbose = FALSE)
    sdm_write_json(job_meta, job_meta_file)
  }, error = function(e) {
    err_msg <- conditionMessage(e)
    is_cancelled <- identical(err_msg, "CANCELLED") || sdm_redis_cancel_check(job_id)
    err_code <- if (is_cancelled) "CANCELLED" else tryCatch(sdm_classify_error(err_msg), error = function(ee) "INTERNAL_ERROR")
    error_hint <- tryCatch(
      { h <- SDM_ERR_CODES[[err_code]]$hint; if (is.null(h)) NA_character_ else h },
      error = function(ee) NA_character_
    )
    cpu_ms <- tryCatch(r_get_cpu_time_ms(proc.time() - cpu_start), error = function(ee) NA_real_)
    peak_mb <- tryCatch(r_get_peak_memory_mb(), error = function(ee) NA_real_)
    err_meta <- list(
      id = job_id,
      status = if (is_cancelled) "cancelled" else "failed",
      started_at = job_meta$started_at %||% format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      config = as.list(body),
      output_dir = job_dir,
      error = if (is_cancelled) "Cancelled by user" else err_msg,
      error_code = err_code,
      error_hint = error_hint,
      error_traceback = paste(utils::tail(traceback(), 10), collapse = "\n"),
      completed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      r_cpu_time_ms = cpu_ms,
      r_peak_memory_mb = peak_mb
    )
    sdm_write_json(err_meta, job_meta_file)
    cat("Run", if (is_cancelled) "cancelled" else "failed", "[", err_code, "]:", err_msg, "\n")
  })

  NULL
}

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
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody),
    error = function(e) {
      cat("JSON parse error:", conditionMessage(e), "\n")
      NULL
    }
  )
  if (is.null(body)) return(sdm_error_code(req, "INVALID_INPUT", "Request body is empty or not valid JSON"))

  required <- c("species", "model_id", "occurrence_file")
  missing <- setdiff(required, names(body))
  if (length(missing) > 0) {
    return(sdm_error_code(req, "INVALID_INPUT", paste("Missing required fields:", paste(missing, collapse = ", "))))
  }

  biovars <- as.integer(unlist(strsplit(as.character(body$biovars %||% "1,4,6,12,15,18"), ",")))
  projection_extent <- as.numeric(unlist(strsplit(as.character(body$projection_extent %||% "112,154,-44,-10"), ",")))
  if (length(projection_extent) != 4) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent must have 4 values: xmin,xmax,ymin,ymax"))
  }

  job_id <- paste0("run-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config = as.list(body),
    output_dir = job_dir
  )
  job_meta_file <- file.path(job_dir, "meta.json")
  sdm_write_json(job_meta, job_meta_file)

  proc <- callr::r_bg(run_model_background, args = list(body, biovars, projection_extent, job_dir, app_dir, job_id),
    stdout = file.path(job_dir, "stdout.log"), stderr = file.path(job_dir, "stderr.log"))
  sdm_process_registry[[job_id]] <- proc

  job_meta$process_pid <- proc$get_pid()
  sdm_write_json(job_meta, job_meta_file)

  list(
    job_id = job_id,
    status = "running",
    message = "Model run started in background"
  )
}

#* Get model run status
#* @get /api/v1/models/status/<job_id>
function(res, job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")
  progress_json_file <- file.path(job_dir, "progress.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

  # Detect process crash: if status is "running" but process is dead or missing
  if (identical(meta$status, "running")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({
        process_alive <- proc$is_alive()
      }, error = function(e) {
        process_alive <<- FALSE
      })
    }
    # Also check PID directly if stored
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          ps_info <- tools::ps()
          process_alive <- pid %in% ps_info$PID
        }, error = function(e) {
          process_alive <<- FALSE
        })
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed (OOM, segfault, or external signal)"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  # Check Redis cancellation signal — catches cancel before background process reacts
  if (identical(meta$status, "running") && sdm_redis_cancel_check(job_id)) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[job_id]] <- NULL
    sdm_redis_progress_clear(job_id)
    sdm_redis_cancel_clear(job_id)
  }

  # Clean up registry for terminal states
  if (identical(meta$status, "completed") || identical(meta$status, "failed") || identical(meta$status, "cancelled")) {
    sdm_process_registry[[job_id]] <- NULL
    sdm_redis_progress_clear(job_id)
    sdm_redis_cancel_clear(job_id)
  }

  # Try Redis progress first, fall back to file progress
  redis_progress <- sdm_redis_progress_get(job_id, 20)
  if (!is.null(redis_progress) && length(redis_progress) > 0) {
    progress_lines <- redis_progress
  } else {
    progress_lines <- character(0)
    if (file.exists(progress_file)) {
      progress_lines <- tail(readLines(progress_file, warn = FALSE), 20)
    }
  }

  progress_json <- NULL
  if (file.exists(progress_json_file)) {
    progress_json <- jsonlite::fromJSON(progress_json_file, simplifyVector = FALSE)
  }

  list(
    id = meta$id,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_traceback = meta$error_traceback %||% NULL,
    metrics = meta$metrics %||% NULL,
    output_files = meta$output_files %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    r_cpu_time_ms = meta$r_cpu_time_ms %||% NULL,
    r_peak_memory_mb = meta$r_peak_memory_mb %||% NULL,
    progress_log = progress_lines,
    progress_json = progress_json
  )
}

# Global process registry for background model runs
# Stores callr::r_bg process handles keyed by job_id
sdm_process_registry <- new.env(parent = emptyenv())

#* Cancel a running model
#* @post /api/v1/models/cancel/<job_id>
function(req, job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this run"))
      }
    }
  }

  proc <- sdm_process_registry[[job_id]]
  killed <- FALSE

  if (!is.null(proc) && inherits(proc, "Process")) {
    if (proc$is_alive()) {
      proc$kill()
      killed <- TRUE
    }
    rm(list = job_id, envir = sdm_process_registry)
  }

  progress_log <- file.path(job_dir, "progress.log")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

    if (!killed && !is.null(meta$process_pid)) {
      tryCatch({
        tools::pskill(meta$process_pid, signal = 9)
        killed <- TRUE
      }, error = function(e) NULL)
    }

    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
    sdm_redis_cancel_set(job_id)
  }

  if (killed) {
    log_line <- paste0(format(Sys.time(), "%H:%M:%S"), " [CANCELLED] Process killed for job ", job_id)
    cat(log_line, "\n")
    if (file.exists(progress_log)) {
      cat(log_line, "\n", file = progress_log, append = TRUE)
    }
  }

  list(ok = TRUE, message = if (killed) "Run cancelled and process terminated" else "Run cancelled (process not found)")
}

#* Delete a model run's output files
#* @post /api/v1/models/delete/<job_id>
function(req, job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to delete this run"))
      }
    }
  }

  if (!dir.exists(job_dir)) {
    return(list(ok = TRUE, message = "Run directory not found (already deleted)", deleted = FALSE))
  }

  tryCatch({
    unlink(job_dir, recursive = TRUE, force = TRUE)
    list(ok = TRUE, message = "Run output files deleted", deleted = TRUE)
  }, error = function(e) {
    list(ok = FALSE, message = paste("Failed to delete:", conditionMessage(e)), deleted = FALSE)
  })
}

#* List all model runs (filtered by user if authenticated)
#* @get /api/v1/models/runs
function(req) {
  jobs_dir <- file.path(app_dir, "outputs", "jobs")
  if (!dir.exists(jobs_dir)) return(list())

  job_dirs <- list.dirs(jobs_dir, recursive = FALSE, full.names = FALSE)
  runs <- lapply(job_dirs, function(jd) {
    meta_file <- file.path(jobs_dir, jd, "meta.json")
    if (file.exists(meta_file)) {
      meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

      # Filter by user if authenticated
      if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) {
        if (is.null(meta$user_id) || as.character(meta$user_id) != as.character(req$user_id)) {
          return(NULL)
        }
      }

      list(
        id = meta$id,
        species = meta$config$species,
        model_id = meta$config$model_id,
        status = meta$status,
        started_at = meta$started_at,
        completed_at = meta$completed_at %||% NULL,
        metrics = meta$metrics %||% NULL,
        r_cpu_time_ms = meta$r_cpu_time_ms %||% NULL,
        r_peak_memory_mb = meta$r_peak_memory_mb %||% NULL
      )
    } else NULL
  })
  Filter(Negate(is.null), runs)
}

# --- Async data job helpers ---

sdm_async_submit <- function(job_type, params, app_dir, user_id = "anonymous") {
  job_id <- paste0("data-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  meta <- list(
    id = job_id,
    user_id = user_id,
    type = job_type,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    params = params
  )
  sdm_write_json(meta, file.path(job_dir, "meta.json"))

  input <- params
  input$type <- job_type
  # Strip NULL entries — jsonlite toJSON with auto_unbox converts NULL to {} not null
  input <- input[!sapply(input, is.null)]
  writeLines(jsonlite::toJSON(input, auto_unbox = TRUE, pretty = TRUE), file.path(job_dir, "input.json"))

  dispatcher_path <- file.path(app_dir, "plumber", "R", "async_dispatcher.R")
  proc <- processx::process$new(
    "Rscript",
    c("--no-save", "--no-restore", dispatcher_path, app_dir, job_dir),
    stdout = file.path(job_dir, "stdout.log"),
    stderr = file.path(job_dir, "stderr.log")
  )

  sdm_process_registry[[job_id]] <- proc
  meta$process_pid <- proc$get_pid()
  sdm_write_json(meta, file.path(job_dir, "meta.json"))

  job_id
}

sdm_async_status <- function(job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  result_file <- file.path(job_dir, "result.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    return(list(available = FALSE, error = "Job not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  result <- NULL
  if (file.exists(result_file)) {
    result <- jsonlite::fromJSON(result_file, simplifyVector = FALSE)
  }

  # Check for terminal states from meta.json
  if (identical(meta$status, "cancelled")) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "cancelled", error = meta$error %||% "Cancelled by user",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }
  if (identical(meta$status, "completed") && is.null(result)) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "completed",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }
  if (identical(meta$status, "failed") && is.null(result)) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "failed", error = meta$error %||% "Unknown error",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }

  # Crash detection for running jobs
  if (identical(meta$status, "running") && is.null(result)) {
    proc <- sdm_process_registry[[basename(job_id)]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          ps_info <- tools::ps()
          process_alive <- pid %in% ps_info$PID
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed"
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = "Process crashed",
                  error_code = "PROCESS_CRASH", error_hint = "The R process terminated unexpectedly"))
    }
  }

  # Check Redis cancellation signal for running jobs
  if (identical(meta$status, "running") && is.null(result) && sdm_redis_cancel_check(basename(job_id))) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "cancelled", error = "Cancelled by user",
                error_code = NULL, error_hint = NULL))
  }

  error_code <- meta$error_code %||% NULL
  error_hint <- meta$error_hint %||% NULL

  if (!is.null(result)) {
    if (identical(result$status, "completed")) {
      sdm_process_registry[[basename(job_id)]] <- NULL
      meta$status <- "completed"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      meta$result <- result$result
      sdm_write_json(meta, meta_file)
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "completed", result = result$result, error_code = error_code, error_hint = error_hint))
    } else if (identical(result$status, "failed")) {
      sdm_process_registry[[basename(job_id)]] <- NULL
      meta$status <- "failed"
      meta$error <- result$error
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = result$error, error_code = error_code, error_hint = error_hint))
    }
  }

  # Try Redis progress first, fall back to file progress
  redis_progress <- sdm_redis_progress_get(basename(job_id), 20)
  if (!is.null(redis_progress) && length(redis_progress) > 0) {
    progress_lines <- redis_progress
  } else {
    progress_lines <- character(0)
    if (file.exists(progress_file)) {
      progress_lines <- tail(readLines(progress_file, warn = FALSE), 20)
    }
  }

  list(available = TRUE, status = "running", progress_log = progress_lines, error_code = error_code, error_hint = error_hint)
}

#* Get async job status
#* @get /api/v1/jobs/status/<job_id>
function(res, job_id) {
  status <- sdm_async_status(job_id)
  if (!status$available) {
    res$status <- 404L
    return(list(error = "Job not found"))
  }
  status
}

#* Cancel an async data job
#* @post /api/v1/jobs/cancel/<job_id>
function(req, job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this job"))
      }
    }
  }

  proc <- sdm_process_registry[[basename(job_id)]]
  killed <- FALSE
  if (!is.null(proc) && inherits(proc, "Process") && proc$is_alive()) {
    proc$kill()
    killed <- TRUE
    rm(list = basename(job_id), envir = sdm_process_registry)
  }

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!killed && !is.null(meta$process_pid)) {
      tryCatch({ tools::pskill(meta$process_pid, signal = 9); killed <- TRUE }, error = function(e) NULL)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_redis_cancel_set(basename(job_id))
  }

  list(ok = TRUE, message = if (killed) "Job cancelled" else "Job not found")
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

#* Discover available future climate scenarios
#* @get /api/v1/future/scenarios
function() {
  base_dir <- file.path(app_dir, sdm_default_future_worldclim_dir)
  if (!dir.exists(base_dir)) {
    return(list(available_scenarios = list(), message = paste("Directory not found:", base_dir)))
  }

  available <- list()
  subdirs <- list.dirs(base_dir, recursive = FALSE, full.names = FALSE)
  for (sd_name in subdirs) {
    sd <- file.path(base_dir, sd_name)
    tif_files <- list.files(sd, pattern = "\\.tif$", full.names = TRUE)
    if (length(tif_files) == 0) next

    is_averaged <- startsWith(sd_name, "averaged_")
    if (is_averaged) {
      parts <- strsplit(sub("^averaged_", "", sd_name), "_")[[1]]
      if (length(parts) < 4) next
      period <- parts[length(parts)]
      ssp_raw <- parts[length(parts) - 1]
      ssp <- if (grepl("-", ssp_raw)) ssp_raw else paste0("SSP", substr(ssp_raw, 1, 1), "-", substr(ssp_raw, 2, 3))
      gcm <- paste(parts[1:(length(parts) - 2)], collapse = "_")
      gcm <- paste0("Averaged (", gcm, ")")
    } else {
      parts <- strsplit(sd_name, "_")[[1]]
      if (length(parts) < 3) next
      period <- parts[length(parts)]
      ssp_raw <- parts[length(parts) - 1]
      ssp <- if (grepl("-", ssp_raw)) ssp_raw else paste0("SSP", substr(ssp_raw, 1, 1), "-", substr(ssp_raw, 2, 3))
      gcm <- paste(parts[1:(length(parts) - 2)], collapse = "_")
    }

    available <- c(available, list(list(
      gcm = gcm,
      ssp = ssp,
      period = period,
      path = sd,
      file_count = length(tif_files),
      files = tif_files
    )))
  }

  list(available_scenarios = available, base_directory = base_dir)
}

#* Download a climate scenario (current or future)
#* @post /api/v1/climate/download
function(req) {
  body <- req$postBody
  if (is.null(body)) body <- list()
  if (is.character(body)) body <- jsonlite::fromJSON(body, simplifyVector = FALSE)

  download_type <- body$type %||% "cmip6"
  job_id <- paste0("climate_", format(Sys.time(), "%Y%m%d_%H%M%S"), "_", paste(sample(letters, 6), collapse = ""))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  job_meta <- list(
    id = job_id,
    type = download_type,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    completed_at = NULL,
    error = NULL,
    config = body
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  script_path <- file.path(app_dir, "plumber", "R", "climate_download.R")
  if (!file.exists(script_path)) {
    stop("Climate download script not found at: ", script_path)
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir), stdout = file.path(job_dir, "stdout.log"), stderr = file.path(job_dir, "stderr.log"))
  sdm_process_registry[[job_id]] <- proc
  job_meta$process_pid <- proc$get_pid()
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  list(
    job_id = job_id,
    status = "running",
    message = "Climate download started in background"
  )
}

#* Get climate download job status
#* @get /api/v1/climate/status/<job_id>
function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Download job not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

  # Crash detection: if status is "running" but process is dead or missing
  if (identical(meta$status, "running")) {
    proc <- sdm_process_registry[[basename(job_id)]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({ ps_info <- tools::ps(); process_alive <- pid %in% ps_info$PID }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
    }
  }

  # Cancel check via Redis — catches cancel before process reacts
  if (identical(meta$status, "running") && sdm_redis_cancel_check(basename(job_id))) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[basename(job_id)]] <- NULL
  }

  # jsonlite encodes R NULL as {} — normalize to NULL
  nullify <- function(x) if (is.list(x) && length(x) == 0) NULL else x

  # Try Redis progress first, fall back to file progress
  redis_progress <- sdm_redis_progress_get(basename(job_id), 50)
  if (!is.null(redis_progress) && length(redis_progress) > 0) {
    progress_lines <- redis_progress
  } else {
    progress_lines <- character(0)
    if (file.exists(progress_file)) {
      progress_lines <- tail(readLines(progress_file, warn = FALSE), 50)
    }
  }

  list(
    id = meta$id,
    type = meta$type,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = nullify(meta$completed_at) %||% NA,
    error = nullify(meta$error) %||% NA,
    error_category = nullify(meta$error_category) %||% NA,
    failed_vars = nullify(meta$failed_vars) %||% NA,
    config = meta$config %||% NA,
    progress_log = progress_lines
  )
}

#* List downloaded climate scenarios
#* @get /api/v1/climate/scenarios
function() {
  future_dir <- file.path(app_dir, sdm_default_future_worldclim_dir)
  current_dir <- file.path(app_dir, sdm_default_worldclim_dir)
  chelsa_dir <- file.path(app_dir, sdm_default_chelsa_dir)

  scenarios <- list()

  if (dir.exists(future_dir)) {
    subdirs <- list.dirs(future_dir, recursive = FALSE, full.names = FALSE)
    for (sd_name in subdirs) {
      sd <- file.path(future_dir, sd_name)
      tif_files <- list.files(sd, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
      total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
      is_averaged <- startsWith(sd_name, "averaged_")

      gcm <- ""
      ssp <- ""
      period <- ""
      if (is_averaged) {
        parts <- strsplit(sd_name, "_")[[1]]
        if (length(parts) >= 4) {
          gcm <- paste(parts[2:(length(parts) - 2)], collapse = "_")
          ssp_code <- parts[length(parts) - 1]
          ssp <- paste0("SSP", substr(ssp_code, 1, 1), "-", substr(ssp_code, 2, 3))
          period <- parts[length(parts)]
        }
      } else {
        parts <- strsplit(sd_name, "_")[[1]]
        if (length(parts) >= 3) {
          period <- parts[length(parts)]
          ssp_raw <- parts[length(parts) - 1]
          ssp <- if (grepl("-", ssp_raw)) ssp_raw else paste0("SSP", substr(ssp_raw, 1, 1), "-", substr(ssp_raw, 2, 3))
          gcm <- paste(parts[1:(length(parts) - 2)], collapse = "_")
        }
      }

      scenarios <- c(scenarios, list(list(
        id = sd_name,
        type = "future",
        gcm = gcm,
        ssp = ssp,
        period = period,
        file_count = length(tif_files),
        size_bytes = total_size,
        is_averaged = is_averaged
      )))
    }
  }

  if (dir.exists(current_dir)) {
    tif_files <- list.files(current_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
    scenarios <- c(scenarios, list(list(
      id = "worldclim_current",
      type = "current",
      source = "worldclim",
      file_count = length(tif_files),
      size_bytes = total_size
    )))
  }

  if (dir.exists(chelsa_dir)) {
    tif_files <- list.files(chelsa_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
    total_size <- sum(file.info(tif_files)$size, na.rm = TRUE)
    scenarios <- c(scenarios, list(list(
      id = "chelsa_current",
      type = "current",
      source = "chelsa",
      file_count = length(tif_files),
      size_bytes = total_size
    )))
  }

  list(scenarios = scenarios)
}

#* Delete a downloaded climate scenario
#* @post /api/v1/climate/delete/<scenario_id>
function(res, scenario_id) {
  future_dir <- file.path(app_dir, sdm_default_future_worldclim_dir)
  current_dir <- file.path(app_dir, sdm_default_worldclim_dir)
  chelsa_dir <- file.path(app_dir, sdm_default_chelsa_dir)

  target_dir <- NULL
  if (scenario_id == "worldclim_current") {
    target_dir <- current_dir
  } else if (scenario_id == "chelsa_current") {
    target_dir <- chelsa_dir
  } else {
    target_dir <- file.path(future_dir, scenario_id)
  }

  if (is.null(target_dir) || !dir.exists(target_dir)) {
    res$status <- 404L; return(list(error = "Scenario not found"))
  }

  unlink(target_dir, recursive = TRUE, force = TRUE)

  list(ok = TRUE, message = paste("Scenario deleted:", scenario_id))
}

#* Cancel a climate download
#* @post /api/v1/climate/cancel/<job_id>
function(req, job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", sdm_basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this download"))
      }
    }
  }

  sdm_redis_cancel_set(sdm_basename(job_id))

  proc <- sdm_process_registry[[sdm_basename(job_id)]]
  killed <- FALSE
  if (!is.null(proc) && inherits(proc, "Process") && proc$is_alive()) {
    proc$kill()
    killed <- TRUE
    rm(list = sdm_basename(job_id), envir = sdm_process_registry)
  }

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!killed && !is.null(meta$process_pid)) {
      tryCatch({ tools::pskill(meta$process_pid, signal = 9); killed <- TRUE }, error = function(e) NULL)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
  }

  list(ok = TRUE, message = if (killed) "Download cancelled and process terminated" else "Download cancelled")
}

#* Get ecology data for a model run
#* @get /api/v1/ecology/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  output_files <- meta$output_files %||% list()
  config <- meta$config %||% list()

  result <- list(
    run_id = run_id,
    species = config$species,
    model_id = config$model_id
  )

  # EOO/AOO
  eoo_aoo_file <- file.path(job_dir, "eoo_aoo.json")
  if (file.exists(eoo_aoo_file)) {
    result$eoo_aoo <- jsonlite::fromJSON(eoo_aoo_file, simplifyVector = FALSE)
  } else if (!is.null(meta$metrics) && !is.null(meta$metrics$eoo_aoo)) {
    result$eoo_aoo <- meta$metrics$eoo_aoo
  } else {
    result$eoo_aoo <- list(available = FALSE, message = "EOO/AOO not computed for this run")
  }

  # AOA
  aoa_png <- output_files$aoa_png
  if (!is.null(aoa_png) && file.exists(aoa_png)) {
    result$aoa <- list(available = TRUE, png = aoa_png)
  } else {
    result$aoa <- list(available = FALSE, message = "AOA not computed for this run")
  }

  # Climate matching
  cm_tif <- output_files$climate_matching_tif
  if (!is.null(cm_tif) && file.exists(cm_tif)) {
    result$climate_matching <- list(available = TRUE, tif = cm_tif)
  } else {
    result$climate_matching <- list(available = FALSE, message = "Climate matching not enabled for this run")
  }

  # MESS (from future projection)
  mess_tif <- output_files$future_mess_tif
  mod_tif <- output_files$future_mod_tif
  if (!is.null(mess_tif) && file.exists(mess_tif)) {
    result$mess <- list(
      available = TRUE,
      mess_tif = mess_tif,
      mod_tif = mod_tif,
      pct_extrapolation = if (!is.null(meta$metrics)) meta$metrics$mess_pct_extrapolation %||% NULL
    )
  } else {
    result$mess <- list(available = FALSE, message = "No future projection with MESS for this run")
  }

  # Niche overlap (if available)
  niche_file <- file.path(job_dir, "niche_overlap.json")
  if (file.exists(niche_file)) {
    result$niche_overlap <- jsonlite::fromJSON(niche_file, simplifyVector = FALSE)
  }

  result
}

#* Get EOO/AOO data for a model run
#* @get /api/v1/ecology/<run_id>/eoo-aoo
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

  eoo_aoo_file <- file.path(job_dir, "eoo_aoo.json")
  if (file.exists(eoo_aoo_file)) {
    return(jsonlite::fromJSON(eoo_aoo_file, simplifyVector = FALSE))
  }

  if (!is.null(meta$metrics) && !is.null(meta$metrics$eoo_aoo)) {
    return(meta$metrics$eoo_aoo)
  }

  list(available = FALSE, message = "EOO/AOO not computed for this run")
}

#* Get AOA data for a model run
#* @get /api/v1/ecology/<run_id>/aoa
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  output_files <- meta$output_files %||% list()

  aoa_png <- output_files$aoa_png
  if (!is.null(aoa_png) && file.exists(aoa_png)) {
    list(available = TRUE, png = aoa_png)
  } else {
    list(available = FALSE, message = "AOA not computed for this run")
  }
}

#* Generate conservation status report text
#* @get /api/v1/ecology/<run_id>/report
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  config <- meta$config %||% list()
  metrics <- meta$metrics %||% list()

  lines <- character(0)
  lines <- c(lines, paste0("Conservation Status Summary: ", config$species %||% "Unknown species"))
  lines <- c(lines, paste0("Model: ", config$model_id %||% "Unknown"))
  lines <- c(lines, "")

  # EOO/AOO
  eoo_aoo_file <- file.path(job_dir, "eoo_aoo.json")
  if (file.exists(eoo_aoo_file)) {
    eoo_aoo <- jsonlite::fromJSON(eoo_aoo_file, simplifyVector = FALSE)
    eoo_km2 <- eoo_aoo$eoo_km2 %||% NA
    aoo_km2 <- eoo_aoo$aoo_km2 %||% NA
    iucn_category <- eoo_aoo$iucn_category %||% "Unknown"

    lines <- c(lines, "Extent and Area of Occurrence:")
    if (!is.na(eoo_km2)) lines <- c(lines, paste0("  EOO: ", round(eoo_km2, 1), " km²"))
    if (!is.na(aoo_km2)) lines <- c(lines, paste0("  AOO: ", round(aoo_km2, 1), " km²"))
    lines <- c(lines, paste0("  IUCN Red List guidance: ", iucn_category))
    lines <- c(lines, "")
  }

  # AOA
  output_files <- meta$output_files %||% list()
  if (!is.null(output_files$aoa_png) && file.exists(output_files$aoa_png)) {
    lines <- c(lines, "Area of Applicability: Computed (see AOA map)")
    lines <- c(lines, "")
  }

  # Climate matching
  if (!is.null(output_files$climate_matching_tif) && file.exists(output_files$climate_matching_tif)) {
    lines <- c(lines, "Climate Matching: Enabled (see similarity map)")
    lines <- c(lines, "")
  }

  # MESS
  if (!is.null(output_files$future_mess_tif) && file.exists(output_files$future_mess_tif)) {
    lines <- c(lines, "MESS Extrapolation: Future projection computed")
    if (!is.null(metrics$mess_pct_extrapolation)) {
      lines <- c(lines, paste0("  % extrapolation: ", round(metrics$mess_pct_extrapolation, 1), "%"))
    }
    lines <- c(lines, "")
  }

  # Model performance
  if (!is.null(metrics$auc_mean)) {
    lines <- c(lines, paste0("Model Performance: AUC = ", round(metrics$auc_mean, 3)))
  }
  if (!is.null(metrics$tss_mean)) {
    lines <- c(lines, paste0("  TSS = ", round(metrics$tss_mean, 3)))
  }

  paste(lines, collapse = "\n")
}

#* Compute niche overlap between two runs (async)
#* @post /api/v1/ecology/niche-overlap
function(req) {
  body <- tryCatch(jsonlite::fromJSON(req$postBody), error = function(e) NULL)
  if (is.null(body)) return(sdm_error(req, 400, "Invalid JSON body"))

  run_id_1 <- body$run_id_1
  run_id_2 <- body$run_id_2
  if (is.null(run_id_1) || is.null(run_id_2)) {
    return(sdm_error(req, 400, "run_id_1 and run_id_2 are required"))
  }

  job_dir_1 <- sdm_safe_job_dir(run_id_1)
  job_dir_2 <- sdm_safe_job_dir(run_id_2)
  if (is.null(job_dir_1) || is.null(job_dir_2)) {
    return(sdm_error(req, 404, "One or both runs not found"))
  }
  meta_file_1 <- file.path(job_dir_1, "meta.json")
  meta_file_2 <- file.path(job_dir_2, "meta.json")

  if (!file.exists(meta_file_1) || !file.exists(meta_file_2)) {
    return(sdm_error(req, 404, "One or both runs not found"))
  }

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- sdm_async_submit("niche_overlap", list(
    run_id_1 = run_id_1,
    run_id_2 = run_id_2,
    n_boot = body$n_boot %||% 100
  ), app_dir, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "Niche overlap computation started in background"
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
  lapply(ids, function(id) {
    spec <- get_sdm_model(id)
    list(
      id = id,
      label = spec$label,
      maturity = spec$maturity,
      min_records = if (!is.na(spec$min_records)) spec$min_records else NULL,
      packages = spec$packages,
      notes = if (length(spec$notes) > 0) paste(spec$notes, collapse = " ") else ""
    )
  })
}

#* Compare two completed model runs
#* @get /api/v1/output/compare/<run_id1>/<run_id2>
function(res, run_id1, run_id2) {
  load_result <- function(rid) {
    job_dir <- sdm_safe_job_dir(rid)
    if (is.null(job_dir)) return(NULL)
    meta_file <- file.path(job_dir, "meta.json")
    if (!file.exists(meta_file)) return(NULL)
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (meta$status != "completed") return(NULL)
    result_rds <- meta$output_files$result_rds
    if (is.null(result_rds) || !file.exists(result_rds)) return(NULL)
    readRDS(result_rds)
  }

  r1 <- load_result(run_id1)
  r2 <- load_result(run_id2)

  if (is.null(r1) || is.null(r2)) {
    res$status <- 404L
    return(list(error = "One or both runs not found or not completed"))
  }

  tryCatch({
    comp <- compare_runs(r1, r2)
    comp$report_text <- format_comparison_text(comp)
    comp
  }, error = function(e) {
    list(error = paste("Comparison failed:", conditionMessage(e)))
  })
}

#* Export reproducible R script for a run
#* @get /api/v1/output/script/<run_id>
function(res, run_id, output_dir = NULL) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    script_path <- file.path(job_dir, "reproducible_run.R")
    source(sdm_resolve_module("script_export.R"), local = TRUE)
    export_run_script(result, script_path)
    list(ok = TRUE, script_path = script_path)
  }, error = function(e) {
    list(error = paste("Script export failed:", conditionMessage(e)))
  })
}

#* Generate run manifest for reproducibility
#* @get /api/v1/output/manifest/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  config <- meta$config %||% list()
  metrics <- meta$metrics %||% list()
  output_files <- meta$output_files %||% list()

  # Git commit SHA
  git_sha <- tryCatch(
    system("git rev-parse HEAD", intern = TRUE, ignore.stderr = TRUE),
    error = function(e) NA_character_
  )
  if (length(git_sha) != 1 || !nzchar(git_sha)) git_sha <- NA_character_

  # Package versions from sessionInfo
  si <- sessionInfo()
  pkg_versions <- list()
  if (!is.null(si$otherPkgs)) {
    for (pkg_name in names(si$otherPkgs)) {
      pkg_versions[[pkg_name]] <- si$otherPkgs[[pkg_name]]$Version %||% NA_character_
    }
  }

  # SHA-256 hash of occurrence file
  occ_hash <- NA_character_
  occ_file <- config$occurrence_file
  if (!is.null(occ_file) && nzchar(occ_file) && file.exists(occ_file)) {
    occ_hash <- tryCatch(
      digest::digest(occ_file, algo = "sha256", file = TRUE),
      error = function(e) NA_character_
    )
  }

  manifest <- list(
    run_id = meta$id,
    run_timestamp = meta$started_at %||% format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    app_version = list(
      git_sha = git_sha,
      r_version = R.version.string,
      platform = R.version$platform,
      package_versions = pkg_versions
    ),
    species = config$species,
    model = list(
      id = config$model_id,
      seed = config$seed %||% NA_integer_,
      parameters = config
    ),
    data = list(
      occurrence_file = occ_file,
      occurrence_hash_sha256 = occ_hash,
      record_count = metrics$presence_records %||% NA_integer_
    ),
    climate = list(
      source = config$source %||% "worldclim",
      worldclim_dir = config$worldclim_dir %||% NA_character_,
      biovars = config$biovars %||% NA_character_,
      resolution = config$worldclim_res %||% 10
    ),
    validation = list(
      cv_folds = config$cv_folds %||% NA_integer_,
      cv_strategy = config$cv_strategy %||% NA_character_,
      seed = config$seed %||% NA_integer_
    ),
    metrics = metrics,
    output_files = output_files
  )

  manifest_path <- file.path(job_dir, "manifest.json")
  writeLines(jsonlite::toJSON(manifest, auto_unbox = TRUE, pretty = TRUE), manifest_path)

  list(ok = TRUE, manifest_path = manifest_path, manifest = manifest)
}

#* Get VIF collinearity screening results for a run
#* @get /api/v1/diagnostics/vif/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    env_info <- result$environment
    vif_result <- env_info$vif_result

    if (is.null(vif_result)) {
      return(list(
        available = FALSE,
        message = "VIF reduction was not enabled for this run",
        selected_vars = env_info$names %||% character(0)
      ))
    }

    vif_history <- if (!is.null(vif_result$vif_history) && is.data.frame(vif_result$vif_history)) {
      lapply(seq_len(nrow(vif_result$vif_history)), function(i) as.list(vif_result$vif_history[i, ]))
    } else {
      list()
    }

    list(
      available = TRUE,
      selected = vif_result$selected %||% character(0),
      dropped = vif_result$dropped %||% character(0),
      vif_final = vif_result$vif_final,
      vif_history = vif_history,
      all_vars = env_info$names %||% character(0),
      var_means = env_info$means %||% list(),
      var_sds = env_info$sds %||% list()
    )
  }, error = function(e) {
    list(error = paste("VIF diagnostics failed:", conditionMessage(e)))
  })
}

#* Get response curve data for a run
#* @get /api/v1/diagnostics/response-curves/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    rc <- result$response_curves

    if (is.null(rc) || length(rc) == 0) {
      return(list(available = FALSE, message = "Response curves not computed for this run"))
    }

    curves <- lapply(names(rc), function(var) {
      df <- rc[[var]]
      if (is.null(df) || !is.data.frame(df)) return(NULL)
      list(
        covariate = var,
        points = lapply(seq_len(nrow(df)), function(i) list(
          value = df$value[i],
          suitability = df$suitability[i]
        ))
      )
    })
    curves <- Filter(Negate(is.null), curves)

    list(
      available = TRUE,
      n_curves = length(curves),
      curves = curves
    )
  }, error = function(e) {
    list(error = paste("Response curves failed:", conditionMessage(e)))
  })
}

#* Get Accumulated Local Effects data for a run
#* @get /api/v1/diagnostics/ale/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    fit_obj <- result$fit
    if (is.null(fit_obj) || is.null(fit_obj$model_data)) {
      return(list(available = FALSE, message = "Model data not available for ALE"))
    }

    ale_data <- compute_ale(fit_obj, model_data = fit_obj$model_data, n_points = 50)

    if (is.null(ale_data) || length(ale_data) == 0) {
      return(list(available = FALSE, message = "ALE computation returned no data"))
    }

    curves <- lapply(names(ale_data), function(var) {
      df <- ale_data[[var]]
      if (is.null(df) || !is.data.frame(df)) return(NULL)
      list(
        covariate = var,
        points = lapply(seq_len(nrow(df)), function(i) list(
          value = df$value[i],
          ale = df$ale[i]
        ))
      )
    })
    curves <- Filter(Negate(is.null), curves)

    list(
      available = TRUE,
      n_curves = length(curves),
      curves = curves
    )
  }, error = function(e) {
    list(error = paste("ALE failed:", conditionMessage(e)))
  })
}

#* Get variable importance data for a run
#* @get /api/v1/diagnostics/importance/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    imp <- result$variable_importance

    if (is.null(imp) || !is.data.frame(imp) || nrow(imp) == 0) {
      return(list(available = FALSE, message = "Variable importance not computed for this run"))
    }

    importance_data <- lapply(seq_len(nrow(imp)), function(i) list(
      variable = imp$variable[i],
      importance = imp$importance[i],
      sd = imp$sd[i],
      baseline = imp$baseline[i]
    ))

    list(
      available = TRUE,
      n_variables = nrow(imp),
      importance = importance_data
    )
  }, error = function(e) {
    list(error = paste("Variable importance failed:", conditionMessage(e)))
  })
}

#* Get per-cell SHAP explanation
#* @post /api/v1/diagnostics/shap/cell
function(res, run_id = "", longitude = NULL, latitude = NULL) {
  if (!nzchar(run_id) || is.null(longitude) || is.null(latitude)) {
    res$status <- 400L; return(list(error = "run_id, longitude, and latitude required"))
  }

  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    if (is.null(result$fit) || is.null(result$fit$model_data)) {
      return(list(available = FALSE, message = "Model data not available for SHAP"))
    }

    model_data <- result$fit$model_data
    covariates <- result$fit$covariates
    if (is.null(covariates) || length(covariates) == 0) {
      return(list(available = FALSE, message = "Covariates not available"))
    }

    if (!requireNamespace("fastshap", quietly = TRUE)) {
      return(list(available = FALSE, message = "fastshap package required for SHAP"))
    }

    coord_df <- data.frame(x = as.numeric(longitude), y = as.numeric(latitude))
    env_rast <- tryCatch(terra::rast(meta$output_files$env_tif %||% ""), error = function(e) NULL)
    if (!is.null(env_rast)) {
      cell_vals <- terra::extract(env_rast, coord_df)
      if (is.null(cell_vals) || nrow(cell_vals) == 0) {
        return(list(available = FALSE, message = "Cell coordinates outside raster extent"))
      }
      cell_vals <- as.numeric(cell_vals[1, ])
      names(cell_vals) <- names(env_rast)
      cell_vals <- cell_vals[!is.na(cell_vals)]
    } else {
      return(list(available = FALSE, message = "Environmental raster not available"))
    }

    shap_vals <- tryCatch(
      compute_shap_cell(result$fit, cell_vals, background = model_data, n_samples = 200L),
      error = function(e) NULL
    )

    if (is.null(shap_vals)) {
      return(list(available = FALSE, message = "SHAP computation failed"))
    }

    shap_list <- lapply(names(shap_vals), function(v) list(
      variable = v, value = cell_vals[v],
      shap_value = shap_vals[v]
    ))
    pred_fun <- build_importance_predict_fun(result$fit)
    prediction <- if (!is.null(pred_fun)) {
      as.numeric(pred_fun(result$fit, as.data.frame(t(cell_vals))))
    } else NA_real_

    list(available = TRUE, prediction = prediction, shap = shap_list)
  }, error = function(e) {
    list(error = paste("SHAP cell explanation failed:", conditionMessage(e)))
  })
}

#* Get climate-change driver attribution summary
#* @get /api/v1/diagnostics/climate-drivers/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    paths <- result$paths %||% list()
    delta_tif <- paths$delta_tif

    if (is.null(delta_tif) || !file.exists(delta_tif)) {
      return(list(available = FALSE, message = "Future projection not available for this run"))
    }

    delta <- terra::rast(delta_tif)
    delta_vals <- terra::values(delta)
    delta_vals <- delta_vals[is.finite(delta_vals)]

    if (length(delta_vals) == 0) {
      return(list(available = FALSE, message = "Delta raster has no valid values"))
    }

    pct_loss <- mean(delta_vals < 0, na.rm = TRUE) * 100
    pct_gain <- mean(delta_vals > 0, na.rm = TRUE) * 100
    pct_stable <- 100 - pct_loss - pct_gain
    mean_delta <- mean(delta_vals, na.rm = TRUE)
    sd_delta <- stats::sd(delta_vals, na.rm = TRUE)

    list(
      available = TRUE,
      has_future_projection = TRUE,
      summary = list(
        mean_delta = mean_delta,
        sd_delta = sd_delta,
        min_delta = min(delta_vals, na.rm = TRUE),
        max_delta = max(delta_vals, na.rm = TRUE),
        pct_loss = pct_loss,
        pct_gain = pct_gain,
        pct_stable = pct_stable,
        n_cells = length(delta_vals)
      ),
      note = "Full per-variable attribution available via SHAP cell click on the suitability map"
    )
  }, error = function(e) {
    list(error = paste("Climate driver analysis failed:", conditionMessage(e)))
  })
}

#* Get Continuous Boyce Index data for a run
#* @get /api/v1/diagnostics/cbi/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- readRDS(result_rds)
    pres_suit <- result$fit$presence_suit
    bg_suit <- result$fit$background_suit

    if (is.null(pres_suit) || is.null(bg_suit)) {
      return(list(available = FALSE, message = "Suitability data not available for CBI computation"))
    }

    source(sdm_resolve_module("metrics_binary.R"), local = TRUE)
    cbi_result <- continuous_boyce_index(pres_suit, bg_suit, n_bins = 51, win = 0.1)

    if (is.null(cbi_result) || !is.data.frame(cbi_result$bins)) {
      return(list(available = FALSE, message = "CBI computation returned no data"))
    }

    bins_df <- cbi_result$bins
    bins_data <- lapply(seq_len(nrow(bins_df)), function(i) list(
      bin_mid = bins_df$bin_mid[i],
      ratio = bins_df$ratio[i],
      smoothed = bins_df$smoothed[i]
    ))

    list(
      available = TRUE,
      cbi = cbi_result$cbi,
      pe_ratio = cbi_result$pe_ratio,
      n_bins = nrow(bins_df),
      bins = bins_data,
      note = if (!is.null(cbi_result$note) && nzchar(cbi_result$note)) cbi_result$note else NULL
    )
  }, error = function(e) {
    list(error = paste("CBI computation failed:", conditionMessage(e)))
  })
}

#* Get MESS extrapolation summary for a run
#* @get /api/v1/diagnostics/mess/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  metrics <- meta$metrics %||% list()
  output_files <- meta$output_files %||% list()

  mess_tif <- output_files$future_mess_tif
  mod_tif <- output_files$future_mod_tif

  if (is.null(mess_tif) || !file.exists(mess_tif)) {
    return(list(
      available = FALSE,
      message = "No future projection with MESS for this run",
      has_future_projection = !is.null(output_files$future_suitability_tif)
    ))
  }

  list(
    available = TRUE,
    mess_tif = mess_tif,
    mod_tif = mod_tif,
    pct_extrapolation = metrics$projection$mess_pct_extrapolation %||% NULL,
    message = "MESS raster available; download TIFF for full spatial analysis"
  )
}

#* Get combined diagnostics summary for a run
#* @get /api/v1/diagnostics/summary/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  metrics <- meta$metrics %||% list()
  config <- meta$config %||% list()

  result_rds <- output_files$result_rds
  has_result_rds <- !is.null(result_rds) && file.exists(result_rds)

  vif_available <- FALSE
  response_curves_available <- FALSE
  importance_available <- FALSE
  cbi_available <- FALSE

  if (has_result_rds) {
    tryCatch({
      result <- readRDS(result_rds)
      vif_available <- !is.null(result$environment$vif_result)
      response_curves_available <- !is.null(result$response_curves) && length(result$response_curves) > 0
      importance_available <- !is.null(result$variable_importance) && is.data.frame(result$variable_importance) && nrow(result$variable_importance) > 0
      cbi_available <- !is.null(result$fit$presence_suit) && !is.null(result$fit$background_suit)
    }, error = function(e) {})
  }

  mess_available <- !is.null(output_files$future_mess_tif) && file.exists(output_files$future_mess_tif)

  list(
    run_id = run_id,
    species = config$species,
    model_id = config$model_id,
    diagnostics = list(
      vif = list(available = vif_available, enabled = isTRUE(config$vif_reduction)),
      response_curves = list(available = response_curves_available),
      variable_importance = list(available = importance_available),
      cbi = list(available = cbi_available),
      mess = list(available = mess_available)
    ),
    metrics = list(
      auc_mean = metrics$auc_mean,
      auc_sd = metrics$auc_sd,
      tss_mean = metrics$tss_mean,
      tss_sd = metrics$tss_sd,
      presence_records = metrics$presence_records,
      background_points = metrics$background_points
    ),
    files = list(
      variable_importance_png = output_files$variable_importance_png %||% NULL,
      response_curves_png = output_files$response_curves_png %||% NULL,
      roc_curve_png = output_files$roc_curve_png %||% NULL,
      cbi_png = output_files$cbi_png %||% NULL,
      calibration_png = output_files$calibration_png %||% NULL,
      cv_folds_png = output_files$cv_folds_png %||% NULL
    )
  )
}

#* Get ROC curve data for a run
#* @get /api/v1/diagnostics/roc/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- readRDS(result_rds)
    cv <- result$cv
    if (is.null(cv) || !is.data.frame(cv$fold_metrics) || nrow(cv$fold_metrics) == 0) {
      return(list(available = FALSE, message = "CV fold metrics not available"))
    }
    fm <- cv$fold_metrics
    mean_fpr <- seq(0, 1, length.out = 100)
    tpr_list <- apply(fm[, c("tp", "fp", "tn", "fn")], 1, function(row) {
      tp <- row["tp"]; fp <- row["fp"]; tn <- row["tn"]; fn <- row["fn"]
      n_pos <- tp + fn; n_neg <- fp + tn
      if (n_pos < 2 || n_neg < 2) return(rep(NA_real_, 100))
      fpr_val <- seq(0, 1, length.out = 100)
      tpr_val <- sapply(fpr_val, function(f) {
        threshold <- f * max(c(1, sqrt(n_pos * n_neg))) / sqrt(n_pos * n_neg) + 0.5
        tp_at_fpr <- tp - f * n_pos
        max(0, min(1, (tp_at_fpr + tn) / (n_pos + n_neg)))
      })
      tpr_val
    })
    mean_tpr <- if (is.matrix(tpr_list)) rowMeans(tpr_list, na.rm = TRUE) else rep(0.5, 100)
    list(
      available = TRUE,
      auc = cv$auc_mean %||% NA_real_,
      auc_sd = cv$auc_sd %||% NA_real_,
      fpr = as.list(mean_fpr),
      tpr = as.list(mean_tpr)
    )
  }, error = function(e) {
    list(error = paste("ROC computation failed:", conditionMessage(e)))
  })
}

#* Get calibration curve data for a run
#* @get /api/v1/diagnostics/calibration/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- readRDS(result_rds)
    cv <- result$cv
    if (is.null(cv) || !is.data.frame(cv$predictions) || length(cv$predictions$predicted) == 0) {
      return(list(available = FALSE, message = "CV predictions not available"))
    }
    preds <- cv$predictions
    n_bins <- 10
    preds$bin <- cut(preds$predicted, breaks = seq(0, 1, length.out = n_bins + 1), include.lowest = TRUE)
    cal_df <- aggregate(observed ~ bin, data = preds, FUN = function(x) c(mean = mean(x), count = length(x)))
    cal_list <- lapply(seq_len(nrow(cal_df)), function(i) {
      b <- cal_df$bin[i]
      mid <- mean(as.numeric(gsub("[\\[\\]()]", "", strsplit(as.character(b), ",")[[1]])))
      list(bin_mid = mid, observed_freq = cal_df$observed[i, "mean"], count = as.integer(cal_df$observed[i, "count"]))
    })
    list(available = TRUE, bins = cal_list)
  }, error = function(e) {
    list(error = paste("Calibration computation failed:", conditionMessage(e)))
  })
}

#* Get per-fold cross-validation metrics
#* @get /api/v1/diagnostics/cv-folds/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- readRDS(result_rds)
    cv <- result$cv
    if (is.null(cv) || !is.data.frame(cv$fold_metrics) || nrow(cv$fold_metrics) == 0) {
      return(list(available = FALSE, message = "CV fold metrics not available"))
    }
    fm <- cv$fold_metrics
    fold_list <- lapply(seq_len(nrow(fm)), function(i) list(
      fold = as.integer(fm$fold[i]),
      auc = as.numeric(fm$auc[i]),
      tss = as.numeric(fm$tss[i])
    ))
    list(
      available = TRUE,
      auc_mean = cv$auc_mean %||% NA_real_,
      auc_sd = cv$auc_sd %||% NA_real_,
      tss_mean = cv$tss_mean %||% NA_real_,
      tss_sd = cv$tss_sd %||% NA_real_,
      folds = fold_list
    )
  }, error = function(e) {
    list(error = paste("CV folds computation failed:", conditionMessage(e)))
  })
}

#* Get threshold performance data
#* @get /api/v1/diagnostics/threshold/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- readRDS(result_rds)
    pres <- result$fit$presence_suit
    bg <- result$fit$background_suit
    if (is.null(pres) || is.null(bg)) {
      return(list(available = FALSE, message = "Prediction data not available"))
    }
    thresholds <- seq(0, 1, length.out = 100)
    threshold_list <- lapply(thresholds, function(t) {
      tp <- sum(pres >= t, na.rm = TRUE)
      fn <- sum(pres < t, na.rm = TRUE)
      fp <- sum(bg >= t, na.rm = TRUE)
      tn <- sum(bg < t, na.rm = TRUE)
      sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else NA_real_
      specificity <- if ((tn + fp) > 0) tn / (tn + fp) else NA_real_
      tss <- if (is.finite(sensitivity) && is.finite(specificity)) sensitivity + specificity - 1 else NA_real_
      list(threshold = t, sensitivity = sensitivity, specificity = specificity, tss = tss)
    })
    list(available = TRUE, thresholds = threshold_list)
  }, error = function(e) {
    list(error = paste("Threshold computation failed:", conditionMessage(e)))
  })
}

#* Get presence vs background density data
#* @get /api/v1/diagnostics/density/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- readRDS(result_rds)
    pres <- result$fit$presence_suit
    bg <- result$fit$background_suit
    if (is.null(pres) || is.null(bg)) {
      return(list(available = FALSE, message = "Prediction data not available"))
    }
    pres_d <- stats::density(pres, from = 0, to = 1, na.rm = TRUE)
    bg_d <- stats::density(bg, from = 0, to = 1, na.rm = TRUE)
    list(
      available = TRUE,
      presence = list(x = as.list(pres_d$x), y = as.list(pres_d$y)),
      background = list(x = as.list(bg_d$x), y = as.list(bg_d$y))
    )
  }, error = function(e) {
    list(error = paste("Density computation failed:", conditionMessage(e)))
  })
}

#* Generate diagnostic PNG plots on demand for a completed run
#* @post /api/v1/diagnostics/plots/<run_id>
function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  result <- readRDS(result_rds)
  source(file.path(app_dir, "R", "output", "diagnostics_plots.R"), local = TRUE)
  diag_files <- save_diagnostic_plots(result, job_dir, log_fun = function(...) {})
  # Merge new diagnostic paths into meta.json output_files
  meta$output_files <- c(meta$output_files %||% list(), diag_files)
  sdm_write_json(meta, meta_file)
  list(ok = TRUE, files = diag_files)
}

#* Download diagnostic data as CSV for a completed run
#* @param type diagnostic type: importance, response_curves, cbi, vif
#* @get /api/v1/diagnostics/data/<run_id>/<type>
function(res, run_id, type) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  result <- readRDS(result_rds)
  csv_data <- switch(type,
    importance = {
      imp <- result$variable_importance
      if (is.null(imp) || !is.data.frame(imp)) return(NULL)
      imp
    },
    response_curves = {
      rc <- result$response_curves
      if (is.null(rc) || length(rc) == 0) return(NULL)
      do.call(rbind, lapply(names(rc), function(nm) { df <- rc[[nm]]; df$covariate <- nm; df }))
    },
    cbi = {
      cbi_result <- tryCatch({
        pres <- result$fit$presence_suit; bg <- result$fit$background_suit
        if (is.null(pres) || is.null(bg)) NULL else {
          source(file.path(app_dir, "R", "output", "diagnostics_plots.R"), local = TRUE)
          continuous_boyce_index(pres, bg, n_bins = 51, win = 0.1)
        }
      }, error = function(e) NULL)
      if (is.null(cbi_result) || is.null(cbi_result$bins)) return(NULL)
      cbi_result$bins
    },
    vif = {
      env <- result$environment
      if (is.null(env) || is.null(env$vif_result)) return(NULL)
      vif <- env$vif_result
      combined <- data.frame(
        variable = c(vif$selected %||% character(0), vif$dropped %||% character(0)),
        status = c(rep("retained", length(vif$selected %||% character(0))), rep("dropped", length(vif$dropped %||% character(0)))),
        stringsAsFactors = FALSE
      )
      if (!is.null(vif$vif_final)) combined$vif_final <- vif$vif_final
      combined
    },
    mess = {
      list(pct_extrapolation = meta$metrics$projection$mess_pct_extrapolation %||% NA)
    },
    NULL
  )
  if (is.null(csv_data)) { res$status <- 404L; return(list(error = paste0("Data not available for type: ", type))) }
  res$headers[["Content-Type"]] <- "text/csv"
  res$headers[["Content-Disposition"]] <- paste0("attachment; filename=\"", type, "_", run_id, ".csv\"")
  write.csv(csv_data, row.names = FALSE)
}

#* Check which BIO variables are already downloaded
#* @param source data source: worldclim, chelsa, cmip6
#* @param resolution spatial resolution (for worldclim)
#* @param biovars comma-separated BIO variable IDs
#* @param gcm GCM name (for cmip6)
#* @param ssp SSP scenario (for cmip6)
#* @param period time period (for cmip6)
#* @get /api/v1/climate/check
function(source = "worldclim", resolution = "10", biovars = "", gcm = "", ssp = "", period = "") {
  tryCatch({
    if (length(biovars) > 1) biovars <- paste(biovars, collapse = ",")
    requested <- as.integer(unlist(strsplit(as.character(biovars), ",")))
    requested <- unique(requested[!is.na(requested)])

    existing_nums <- integer(0)

    if (source == "worldclim") {
      res_esc <- gsub("\\.", "\\\\.", as.character(resolution))
      pattern <- sprintf("^wc2\\.1_%sm_bio_\\d+\\.tif$", res_esc)
      files <- list.files(file.path(app_dir, sdm_default_worldclim_dir), pattern = pattern)
      existing_nums <- as.integer(gsub("^.*_bio_(\\d+)\\.tif$", "\\1", files))
    } else if (source == "chelsa") {
      files <- list.files(file.path(app_dir, sdm_default_chelsa_dir), pattern = "^CHELSA_bio\\d+_.*\\.tif$")
      existing_nums <- as.integer(gsub("^CHELSA_bio0*(\\d+)_.*$", "\\1", files))
    } else if (source == "cmip6") {
      if (nzchar(gcm) && nzchar(ssp) && nzchar(period)) {
        if (grepl("(\\.\\./|\\.\\.\\\\|/)", paste(gcm, ssp, period))) {
          stop("Invalid climate path parameters")
        }
        future_dir <- file.path(app_dir, sdm_default_future_worldclim_dir, paste0(gcm, "_", ssp, "_", period))
        if (dir.exists(future_dir)) {
          files <- list.files(future_dir, pattern = "^bio\\d+\\.tif$")
          existing_nums <- as.integer(gsub("^bio(\\d+)\\.tif$", "\\1", files))
        }
      }
    }

    available <- intersect(requested, existing_nums)
    missing <- setdiff(requested, existing_nums)

    list(
      source = source,
      res = resolution,
      available = as.list(available),
      missing = as.list(missing)
    )
  }, error = function(e) {
    requested_safe <- if (exists("requested", inherits = FALSE)) requested else integer(0)
    list(
      source = source,
      res = resolution,
      available = as.list(integer(0)),
      missing = as.list(requested_safe)
    )
  })
}
