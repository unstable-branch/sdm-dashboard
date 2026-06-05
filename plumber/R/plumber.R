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

# Guard against double-loading when run_server.R sources plumber.R twice
# (once via pr() for route discovery, once via source(local=FALSE) for globals).
if (is.null(.GlobalEnv$.sdm_plumber_initialized)) {
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

  # Source shared Plumber helpers used by route handlers. run_server.R also
  # sources this file before router setup, but plumber.R must be self-contained
  # for direct Plumber parsing and helper-level tests.
  source(file.path(app_dir, "plumber", "R", "helpers", "plumber_helpers.R"))

  .GlobalEnv$.sdm_plumber_initialized <- TRUE
}

# Maximum concurrent model runs to prevent OOM
SDM_MAX_CONCURRENT_RUNS <- as.integer(Sys.getenv("SDM_MAX_CONCURRENT_RUNS", "2"))
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
      return(sdm_error_code(req, "INVALID_INPUT", "No file uploaded. Send multipart/form-data with field 'file' or JSON with 'file_path'."))
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
      return(sdm_error_code(req, "INVALID_INPUT", paste("Uploaded file not found:", file_path %||% "unknown")))
    }

    max_size <- 100 * 1024 * 1024
    file_size <- file.info(file_path)$size
    if (file_size > max_size) {
      return(sdm_error(req, 413, paste("File too large. Maximum", max_size / 1e6, "MB.")))
    }

    orig_name <- uploaded$filename[[1]] %||% uploaded$name[[1]] %||% "upload"
    ext <- tolower(tools::file_ext(orig_name))
    is_dwca <- ext == "zip"

    upload_dir <- file.path(app_dir, "data", "uploads")
    dir.create(upload_dir, recursive = TRUE, showWarnings = FALSE)
    safe_name <- gsub("[^a-zA-Z0-9._-]", "_", orig_name)
    dest_path <- file.path(upload_dir, paste0(format(Sys.time(), "%Y%m%d_%H%M%S_"), safe_name))
    file.copy(file_path, dest_path, overwrite = TRUE)
    encrypt_file(dest_path, dest_path)
    rel_path <- file.path("data", "uploads", basename(dest_path))

    con <- db_connect()
    on.exit(if (!is.null(con)) DBI::dbDisconnect(con), add = TRUE)

    upload_result <- NULL

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

      upload_result <- list(
        file_id = dest_path,
        file_path = rel_path,
        filename = uploaded$filename[[1]] %||% uploaded$name[[1]] %||% basename(dest_path),
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

      upload_result <- list(
        file_id = dest_path,
        file_path = rel_path,
        filename = uploaded$filename[[1]] %||% uploaded$name[[1]] %||% basename(dest_path),
        format = if (ext %in% c("tsv", "txt")) "tsv" else "csv",
        n_rows = n_rows,
        species_detected = species_detected,
        columns_detected = columns_detected,
        coord_warnings = if (length(coord_warnings) > 0) coord_warnings else NULL,
        preview = preview
      )
    }

    db_insert_upload(
      con, req$user_id %||% "unknown",
      dest_path, upload_result$filename %||% basename(dest_path), file_size,
      upload_result$format %||% "csv", upload_result$n_rows %||% 0L,
      if (is.character(upload_result$species_detected)) upload_result$species_detected else NULL,
      if (is.list(upload_result$columns_detected)) jsonlite::toJSON(upload_result$columns_detected, auto_unbox = TRUE) else NULL
    )

    upload_result
  }, error = function(e) {
    sdm_error(req, 400, conditionMessage(e))
  })
}

#* List uploaded files (persisted across sessions)
#* @get /api/v1/occurrences/uploads
function(req, limit = 50) {
  limit <- suppressWarnings(as.integer(limit))
  if (!is.finite(limit) || limit < 1) limit <- 50L
  con <- db_connect()
  if (is.null(con)) return(list(uploads = list()))
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  tryCatch({
    user_filter <- req$user_id %||% "unknown"
    rows <- DBI::dbGetQuery(con,
      "SELECT id, filename, file_path, file_size, format, n_rows, species, columns_detected, created_at,
              is_cleaned, cleaned_file_path, cleaned_valid_records, cleaned_original_rows
       FROM uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      params = list(user_filter, limit)
    )
    if (nrow(rows) == 0) return(list(uploads = list()))
    list(uploads = lapply(seq_len(nrow(rows)), function(i) as.list(rows[i, ])))
  }, error = function(e) list(uploads = list(), error = conditionMessage(e)))
}

#* Clean occurrence data with configurable options
#* @param file_id The uploaded file path or ID
#* @param min_source_records Minimum records per source to keep (default: 15)
#* @param merge_small_sources Merge small sources (default: true)
#* @param use_cc Run CoordinateCleaner (default: false)
#* @param cc_tests CC tests to run: all, sea, capitals, centroids, institutions, urban, zero (default: all)
#* @param max_coordinate_uncertainty Max coordinate uncertainty in meters (default: no filter)
#* @post /api/v1/occurrences/clean
function(req, file_id, min_source_records = 15, merge_small_sources = TRUE, use_cc = FALSE, cc_tests = "all", max_coordinate_uncertainty = NULL) {
  min_source_records <- suppressWarnings(as.integer(min_source_records))
  if (!is.finite(min_source_records)) min_source_records <- 15L

  max_coordinate_uncertainty <- if (is.null(max_coordinate_uncertainty) || !nzchar(max_coordinate_uncertainty)) NULL else suppressWarnings(as.numeric(max_coordinate_uncertainty))

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
    cc_tests = cc_tests,
    max_coordinate_uncertainty = max_coordinate_uncertainty
  ), app_dir, user_id)

  if (is.null(job_id)) {
    return(sdm_error(req, 500, "Failed to submit clean job"))
  }

  list(job_id = job_id, status = "running")
}

#* Search GBIF for occurrence records (async)
#* @param taxon Species name (e.g., "Acacia mearnsii")
#* @param country Country code filter (e.g., "AU")
#* @param max_records Maximum records to fetch (default: 100)
#* @param use_auth If true, use authenticated download (unlimited records)
#* @param gbif_user GBIF username for authenticated download
#* @param gbif_pwd GBIF password for authenticated download
#* @param gbif_email GBIF email for authenticated download
sdm_submit_gbif_search <- function(req, taxon, country = NULL, max_records = 100,
                                    use_auth = NULL,
                                    gbif_user = NULL, gbif_pwd = NULL, gbif_email = NULL,
                                    app_dir_override = app_dir,
                                    submit_fun = sdm_async_submit) {
  if (is.null(taxon) || !nzchar(taxon)) {
    return(sdm_error(req, 400, "taxon is required"))
  }

  max_records <- suppressWarnings(as.integer(max_records))
  if (!is.finite(max_records) || max_records < 1) max_records <- 100L

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- submit_fun("gbif", list(
    taxon = taxon,
    country = if (!is.null(country) && nzchar(country)) country else NULL,
    max_records = max_records,
    use_auth = isTRUE(use_auth),
    gbif_user = gbif_user %||% NULL,
    gbif_pwd = gbif_pwd %||% NULL,
    gbif_email = gbif_email %||% NULL
  ), app_dir_override, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "GBIF search started in background"
  )
}

#* @post /api/v1/occurrences/gbif/search
function(req, taxon, country = NULL, max_records = 100, use_auth = NULL,
         gbif_user = NULL, gbif_pwd = NULL, gbif_email = NULL) {
  sdm_submit_gbif_search(req, taxon, country, max_records,
                         use_auth, gbif_user, gbif_pwd, gbif_email)
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
#* @param analysis_crs
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
  if (length(projection_extent) != 4 || any(!is.finite(projection_extent))) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent must have 4 numeric values: xmin,xmax,ymin,ymax"))
  }
  if (projection_extent[1] >= projection_extent[2] || projection_extent[3] >= projection_extent[4]) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent has invalid ordering: xmin must be < xmax, ymin must be < ymax"))
  }
  if (projection_extent[1] < -180 || projection_extent[2] > 180 || projection_extent[3] < -90 || projection_extent[4] > 90) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent is outside valid coordinate bounds (±180, ±90)"))
  }

  # Memory guard: reject if available RAM is critically low
  tryCatch({
    mem_info <- terra::mem_info()
    if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
      if (mem_info$memavail < 1.0) {
        return(sdm_error_code(req, "INTERNAL_ERROR", paste0(
          "Server memory critically low (", sprintf("%.1f", mem_info$memavail),
          " GB available). Wait for other runs to complete or restart the container."
        )))
      }
    }
  }, error = function(e) NULL)

  # Concurrency limit: reject if too many runs in-flight to prevent OOM
  active <- sdm_count_active_runs()
  if (active >= SDM_MAX_CONCURRENT_RUNS) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste0(
      "Server busy: ", active, " model run(s) in progress (max ", SDM_MAX_CONCURRENT_RUNS,
      "). Please wait and retry."
    )))
  }

  job_id <- paste0("run-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  # Spawn model run in background via standalone script
  # (avoids closure serialization issues with callr::r_bg)
  script_path <- file.path(app_dir, "plumber", "R", "run_model_background.R")
  if (!file.exists(script_path)) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste("Model run script not found at:", script_path)))
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  env = c(
    OMP_THREAD_LIMIT = as.character(getOption("sdm.omp_thread_limit", "1")),
    R_MAX_VSIZE = Sys.getenv("SDM_CHILD_MAX_VSIZE", "6Gb")
  ))
  sdm_process_registry[[job_id]] <- proc

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "pending",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config = as.list(body),
    output_dir = job_dir,
    process_pid = proc$get_pid()
  )
  job_meta_file <- file.path(job_dir, "meta.json")
  sdm_write_json(job_meta, job_meta_file)

  progress_log <- file.path(job_dir, "progress.log")

  list(
    job_id = job_id,
    status = "running",
    message = "Model run started in background"
  )
}

# --- Targets pipeline endpoints ---

#* Submit a multi-species batch via targets pipeline
#* @post /api/v1/models/targets-run
function(req) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody),
    error = function(e) NULL
  )
  if (is.null(body) || is.null(body$configs) || length(body$configs) == 0) {
    return(sdm_error_code(req, "INVALID_INPUT", "Request body must contain a non-empty 'configs' array"))
  }

  job_id <- paste0("targets-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  # Write config CSV for _targets.R
  configs <- body$configs
  csv_rows <- lapply(seq_along(configs), function(i) {
    c <- configs[[i]]
    data.frame(
      species = c$species %||% "",
      species_filter = c$species_filter %||% c$species %||% "",
      occurrences_csv = c$cleaned_file_id %||% c$occurrence_file %||% "",
      model_id = c$model_id %||% "glm",
      biovars = paste(c$biovars %||% "1,4,6,12,15,18", collapse = ","),
      projection_extent = paste(c$projection_extent %||% "112,154,-44,-10", collapse = ","),
      background_n = as.character(c$background_n %||% 10000),
      cv_folds = as.character(c$cv_folds %||% 5),
      threshold = as.character(c$threshold %||% 0.5),
      stringsAsFactors = FALSE
    )
  })
  config_df <- do.call(rbind, csv_rows)
  config_csv <- file.path(job_dir, "config.csv")
  write.csv(config_df, config_csv, row.names = FALSE)

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "queued",
    type = "targets",
    n_species = length(configs),
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config_csv = config_csv
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"))

  # Spawn targets pipeline
  script_path <- file.path(app_dir, "plumber", "R", "targets_dispatcher.R")
  if (!file.exists(script_path)) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste("Targets dispatcher not found at:", script_path)))
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"))
  sdm_process_registry[[job_id]] <- proc

  job_meta$process_pid <- proc$get_pid()
  job_meta$status <- "running"
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"))

  list(
    job_id = job_id,
    status = "running",
    n_species = length(configs),
    message = paste0("Targets pipeline started with ", length(configs), " species")
  )
}

#* Get targets pipeline status
#* @get /api/v1/models/targets-status/<job_id>
function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      res$status <- 500L
      return(list(error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)

  # Process crash detection
  if (identical(meta$status, "running")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({ process_alive <- tools::pskill(pid, signal = 0) }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed"
      meta$error_code <- "PROCESS_CRASH"
      meta$error_hint <- "The process was terminated by the OS, likely due to insufficient memory. Reduce covariates, use coarser resolution, or increase available memory."
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
    }
  }

  # Read targets metadata for progress
  store_path <- file.path(job_dir, "_targets")
  targets_progress <- NULL
  if (dir.exists(store_path)) {
    tryCatch({
      tm <- targets::tar_meta(store = store_path)
      if (is.data.frame(tm) && nrow(tm) > 0) {
        targets_progress <- list(
          total_targets = nrow(tm),
          completed = sum(tm$status == "completed", na.rm = TRUE),
          errored = sum(tm$status == "errored", na.rm = TRUE),
          running = sum(tm$status == "running", na.rm = TRUE)
        )
        # Extract per-target status
        targets_progress$targets <- lapply(seq_len(nrow(tm)), function(i) {
          list(
            name = tm$name[i],
            type = tm$type[i] %||% "stem",
            status = tm$status[i] %||% "unknown",
            seconds = if (!is.null(tm$seconds[i]) && is.finite(tm$seconds[i])) tm$seconds[i] else NULL,
            error = if (!is.null(tm$error[i]) && nzchar(tm$error[i] %||% "")) tm$error[i] else NULL
          )
        })
      }
    }, error = function(e) NULL)
  }

  # Read progress log
  progress_log <- character(0)
  progress_file <- file.path(job_dir, "progress.log")
  if (file.exists(progress_file)) {
    progress_log <- readLines(progress_file, warn = FALSE)
  }

  list(
    id = meta$id,
    status = meta$status,
    n_species = meta$n_species %||% 0,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    targets_progress = targets_progress,
    progress_log = progress_log
  )
}

#* Get targets pipeline results
#* @get /api/v1/models/targets-results/<job_id>
function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  store_path <- file.path(job_dir, "_targets")

  results <- list()
  if (dir.exists(store_path)) {
    tryCatch({
      tm <- targets::tar_meta(store = store_path)
      if (is.data.frame(tm) && nrow(tm) > 0) {
        # Group by species by examining the post targets (which contain final results)
        post_rows <- tm[tm$name %in% grep("^post_", tm$name, value = TRUE), , drop = FALSE]
        for (i in seq_len(nrow(post_rows))) {
          pr <- post_rows[i, , drop = FALSE]
          species_name <- gsub("^post_", "", pr$name)
          result_path <- file.path(job_dir, pr$data[[1]]$path %||% "")
          species_result <- NULL
          if (file.exists(result_path) && grepl("\\.rds$", result_path)) {
            # Validate the RDS path stays within the job directory
            safe_rds <- sdm_safe_path(result_path, job_dir)
            if (!is.null(safe_rds)) {
              species_result <- tryCatch(readRDS(safe_rds), error = function(e) NULL)
            }
          }
          row <- list(
            name = species_name,
            status = pr$status %||% "unknown",
            error = if (!is.null(pr$error) && nzchar(pr$error[1] %||% "")) pr$error[1] else NULL,
            metrics = tryCatch({
              if (!is.null(species_result)) {
                list(
                  auc_mean = species_result$cv$auc_mean %||% NA_real_,
                  auc_sd = species_result$cv$auc_sd %||% NA_real_,
                  tss_mean = species_result$cv$tss_mean %||% NA_real_,
                  tss_sd = species_result$cv$tss_sd %||% NA_real_,
                  cbi = species_result$metrics$cbi %||% NA_real_,
                  presence_records = species_result$metrics$presence_records %||% NA_integer_,
                  elapsed_seconds = species_result$metrics$elapsed_seconds %||% NA_real_
                )
              } else NULL
            }, error = function(e) NULL)
          )
          results[[species_name]] <- row
        }
      }
    }, error = function(e) NULL)
  }

  config_csv <- file.path(job_dir, "config.csv")
  species_list <- character(0)
  if (file.exists(config_csv)) {
    tryCatch({
      df <- read.csv(config_csv, stringsAsFactors = FALSE)
      species_list <- df$species
    }, error = function(e) NULL)
  }

  list(
    id = meta$id,
    status = meta$status,
    n_species = meta$n_species %||% length(species_list),
    species = species_list,
    results = results
  )
}

#* Get job logs (stderr, stdout, progress)
#* @get /api/v1/models/logs/<job_id>
function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }

  read_safe <- function(path, max_lines = 500) {
    if (!file.exists(path)) return("")
    tryCatch({
      lines <- readLines(path, warn = FALSE)
      if (length(lines) > max_lines) {
        lines <- tail(lines, max_lines)
      }
      paste(lines, collapse = "\n")
    }, error = function(e) "")
  }

  list(
    id = job_id,
    stderr = read_safe(file.path(job_dir, "stderr.log")),
    stdout = read_safe(file.path(job_dir, "stdout.log")),
    progress_log = read_safe(file.path(job_dir, "progress.log"))
  )
}

#* Get model run status
#* @get /api/v1/models/status/<job_id>
function(res, job_id) {
  job_dir <- tryCatch(sdm_safe_job_dir(job_id), error = function(e) { NULL })
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")
  progress_json_file <- file.path(job_dir, "progress.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      # meta.json may be corrupted if the background process was killed mid-write
      res$status <- 500L
      return(list(error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)

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
    # Also check PID directly if stored (uses signal 0 which tests existence without sending signal)
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) {
          process_alive <<- FALSE
        })
      }
    }
    # Heartbeat staleness check — if process appears alive but heartbeat hasn't updated in 30 min,
    # the R process is likely stuck (infinite loop, deadlock, or unresponsive)
    if (process_alive || is.null(proc)) {
      heartbeat_file <- file.path(job_dir, "heartbeat.log")
      if (file.exists(heartbeat_file)) {
        last_line <- tryCatch(tail(readLines(heartbeat_file, warn = FALSE), 1), error = function(e) NULL)
        if (!is.null(last_line) && length(last_line) > 0 && nchar(last_line) > 0) {
          hb_ts <- tryCatch(as.POSIXct(sub("\\|.*", "", last_line), format = "%Y-%m-%dT%H:%M:%S"), error = function(e) NULL)
          if (!is.null(hb_ts) && !is.na(hb_ts)) {
            if (difftime(Sys.time(), hb_ts, units = "secs") > 1800) {
              process_alive <- FALSE
            }
          }
        }
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

  # Crash detection for loading state — process died during module initialization
  if (identical(meta$status, "loading")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) NULL)
      }
    }
    # Heartbeat staleness check — if heartbeat not updated in 90s, process is likely dead
    if (is.null(proc) || !process_alive) {
      heartbeat_file <- file.path(job_dir, "heartbeat.log")
      if (file.exists(heartbeat_file)) {
        last_line <- tryCatch(tail(readLines(heartbeat_file, warn = FALSE), 1), error = function(e) NULL)
        if (!is.null(last_line) && length(last_line) > 0 && nchar(last_line) > 0) {
          hb_ts <- tryCatch(as.POSIXct(sub("\\|.*", "", last_line), format = "%Y-%m-%dT%H:%M:%S"), error = function(e) NULL)
          if (!is.null(hb_ts) && !is.na(hb_ts)) {
            if (difftime(Sys.time(), hb_ts, units = "secs") > 90) {
              process_alive <- FALSE
            }
          }
        }
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died while loading modules: ", stderr_content)
      } else {
        meta$error <- "R process died while loading modules — no stderr output available"
      }
      meta$error_code <- "RUNNER_LOAD_FAILED"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  # Crash detection for pending state — process died before writing "loading"
  if (identical(meta$status, "pending")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died: ", stderr_content)
      } else {
        meta$error <- "R process died before loading modules — no stderr output available"
      }
      meta$error_code <- "RUNNER_START_FAILED"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  # Also check Redis cancellation signal — catches cancel before background process reacts
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

  progress_lines <- character(0)
  last_stage <- NULL
  if (file.exists(progress_file)) {
    progress_lines <- tail(readLines(progress_file, warn = FALSE), 200)
    for (line in rev(progress_lines)) {
      stage <- gsub("^\\d{2}:\\d{2}:\\d{2}\\s*(\\[\\d+%\\]\\s*)?", "", line)
      stage <- trimws(stage)
      if (nchar(stage) >= 3) {
        last_stage <- stage
        break
      }
    }
  }

  # Read structured progress JSON (written as JSON-lines by progress_fun in background process)
  progress_json <- NULL
  if (file.exists(progress_json_file)) {
    progress_json <- tryCatch({
      lines <- readLines(progress_json_file, warn = FALSE)
      entries <- lapply(lines[nzchar(lines)], function(l) jsonlite::fromJSON(l, simplifyVector = FALSE))
      if (length(entries) > 0) entries else NULL
    }, error = function(e) NULL)
  }

  result <- list(
    id = meta$id,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    metrics = meta$metrics %||% NULL,
    output_files = meta$output_files %||% NULL,
    progress_log = progress_lines,
    last_stage = last_stage,
    progress_json = progress_json
  )
  if (identical(Sys.getenv("PLUMBER_AUTH_DISABLED"), "true") && !is.null(meta$error_traceback)) {
    result$error_traceback <- meta$error_traceback
  }
  result
}

# Global process registry for background model runs
# Stores callr::r_bg process handles keyed by job_id
sdm_process_registry <- new.env(parent = emptyenv())

#* Cancel a running model
#* @post /api/v1/models/cancel/<job_id>
function(req, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    return(list(ok = FALSE, message = "Invalid job ID"))
  }
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
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    return(list(ok = TRUE, message = "Invalid job ID", deleted = FALSE))
  }
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
  tryCatch({
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
  }, error = function(e) {
    cat(sprintf("[sdm_async_submit] ERROR: %s\n", conditionMessage(e)), stderr())
    NULL
  })
}

sdm_async_status <- function(job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  result_file <- file.path(job_dir, "result.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    return(list(available = FALSE, error = "Job not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      return(list(available = FALSE, error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)
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
      meta$error <- "Process crashed or was killed (OOM, segfault, or external signal)"
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = "Process crashed or was killed (OOM, segfault, or external signal)",
                  error_code = "PROCESS_CRASH", error_hint = "The R process was terminated by the OS. Check system memory, reduce raster resolution, or run with fewer covariates."))
    }
  }

  # Crash detection for loading state — process died during module init
  if (identical(meta$status, "loading")) {
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
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died while loading modules: ", stderr_content)
      } else {
        meta$error <- "R process died while loading modules — no stderr output available"
      }
      meta$error_code <- "RUNNER_LOAD_FAILED"
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = meta$error,
                  error_code = "RUNNER_LOAD_FAILED", error_hint = "The R process was killed while loading SDM modules. Check container memory limits, reduce covariates, or increase memory allocation."))
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

  # Loading state (process still initializing modules)
  if (identical(meta$status, "loading")) {
    return(list(available = TRUE, status = "loading", progress_log = character(0),
                error_code = NULL, error_hint = NULL))
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
function(req, res, job_id) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        res$status <- 403L
        return(list(error = "Access denied"))
      }
    }
  }
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
  mem_avail <- tryCatch(terra::mem_info()$memavail, error = function(e) NULL)
  list(
    status = "ok",
    r_version = R.version.string,
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    active_runs = sdm_count_active_runs(),
    max_concurrent_runs = SDM_MAX_CONCURRENT_RUNS,
    memory_gb = if (is.numeric(mem_avail)) mem_avail else NULL
  )
}

#* Readiness check (lightweight — for load balancers / probes)
#* @get /ready
function() {
  list(
    status = "ok",
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
    stop("Climate download script not found at: ", script_path, call. = FALSE)
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

  # jsonlite encodes R NULL/NA as {} — normalize to NULL
  nullify <- function(x) {
    if (is.null(x)) return(NULL)
    if (is.list(x) && length(x) == 0) return(NULL)
    if (length(x) == 1 && is.na(x)) return(NULL)
    x
  }

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
    config = nullify(meta$config) %||% NA,
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
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this download"))
      }
    }
  }

  sdm_redis_cancel_set(basename(job_id))

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
    extent_presets = sdm_extent_choices,
    analysis_crs = sdm_default_analysis_crs,
    analysis_crs_choices = lapply(seq_along(sdm_analysis_crs_choices), function(i) {
      list(value = unname(sdm_analysis_crs_choices[i]), label = names(sdm_analysis_crs_choices)[i])
    })
  )
}

#* List available models
#* @get /api/v1/models
function() {
  ids <- sdm_model_ids()
  lapply(ids, function(id) {
    spec <- get_sdm_model(id)
    tier <- COMPLEXITY_MODEL_TIERS[id]
    if (is.na(tier)) tier <- "moderate"
    list(
      id = id,
      label = spec$label,
      maturity = spec$maturity,
      min_records = if (!is.na(spec$min_records)) spec$min_records else NULL,
      packages = spec$packages,
      notes = if (length(spec$notes) > 0) paste(spec$notes, collapse = " ") else "",
      complexity_tier = tier
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
    tryCatch(sdm_read_result(result_rds), error = function(e) NULL)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
      result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
    result <- sdm_read_result(result_rds)
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
  result <- tryCatch(sdm_read_result(result_rds), error = function(e) NULL)
  if (is.null(result)) {
    res$status <- 500L; return(list(error = "Failed to load result file"))
  }
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
  result <- tryCatch(sdm_read_result(result_rds), error = function(e) NULL)
  if (is.null(result)) { res$status <- 500L; return(list(error = "Failed to load result file")) }
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
          stop("Invalid climate path parameters", call. = FALSE)
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

#* Download non-climate covariates (elevation, soil, UV, vegetation, LULC, HFP, drought, bioclim seasonality)
#* @post /api/v1/covariates/download
#* @parser json
function(req) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(body)) {
    return(sdm_error(req, 400, "Request body is empty or not valid JSON"))
  }

  type <- body$type
  valid_types <- c("elevation", "soil", "uv", "vegetation", "lulc", "hfp", "drought", "bioclim_seasonality")
  if (is.null(type) || !nzchar(type) || !type %in% valid_types) {
    return(sdm_error(req, 400, paste0("Invalid or missing 'type'. Must be one of: ", paste(valid_types, collapse = ", "))))
  }

  tryCatch({
    # Resolve extent: body, then extent file, then default
    extent <- body$extent %||% sdm_default_projection_extent
    extent <- as.numeric(unlist(extent))
    if (length(extent) != 4 || any(!is.finite(extent))) {
      extent <- sdm_extent_presets$aus_full
    }

    cache_base <- file.path(app_dir, sdm_default_covariate_cache_dir)

    if (type == "elevation") {
      source(file.path(app_dir, "R", "covariates", "covariates_elevation.R"))
      result <- load_elevation_covariate(
        training_extent = extent,
        projection_extent = extent,
        demtype = body$dem_type %||% sdm_default_elevation_demtype,
        api_key = body$apikey
      )
      cache_dir <- file.path(cache_base, "opentopo")
    } else if (type == "soil") {
      source(file.path(app_dir, "R", "covariates", "covariates_soil.R"))
      result <- load_soil_covariate(
        soil_path = NULL,
        selected_soil_vars = body$soil_vars %||% sdm_default_soil_vars,
        selected_soil_depths = body$soil_depths %||% sdm_default_soil_depths
      )
      cache_dir <- file.path(cache_base, "soilgrids")
    } else if (type == "uv") {
      source(file.path(app_dir, "R", "covariates", "covariates_uv.R"))
      result <- load_uv_covariate()
      cache_dir <- file.path(cache_base, "gluv")
    } else if (type == "vegetation") {
      source(file.path(app_dir, "R", "covariates", "covariates_vegetation.R"))
      result <- load_vegetation_covariate(
        veg_year = body$veg_year %||% NULL,
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "gimms")
    } else if (type == "lulc") {
      source(file.path(app_dir, "R", "covariates", "covariates_lulc.R"))
      result <- load_lulc_covariate(
        lulc_year = body$lulc_year %||% 2020,
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "lulc")
    } else if (type == "hfp") {
      source(file.path(app_dir, "R", "covariates", "covariates_human_footprint.R"))
      result <- load_human_footprint_covariate(
        hfp_year = body$hfp_year %||% 2020,
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "human_footprint")
    } else if (type == "drought") {
      source(file.path(app_dir, "R", "covariates", "covariates_drought.R"))
      result <- load_drought_covariate(
        selected_periods = body$drought_periods %||% "annual_mean",
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "drought")
    } else if (type == "bioclim_seasonality") {
      source(file.path(app_dir, "R", "covariates", "covariates_bioclim_seasonality.R"))
      result <- load_bioclim_seasonality(
        extent_vec = extent
      )
      cache_dir <- file.path(cache_base, "bioclim_season")
    }

    if (is.null(result)) {
      return(list(status = "error", message = paste("Failed to download", type, "- check logs for details"), files = list()))
    }

    downloaded_files <- if (dir.exists(cache_dir)) {
      list.files(cache_dir, recursive = TRUE)
    } else {
      character(0)
    }

    list(
      status = "success",
      message = paste("Downloaded", type, "successfully"),
      files = downloaded_files
    )
  }, error = function(e) {
    list(status = "error", message = conditionMessage(e))
  })
}

#* Download covariate layer in background — returns job_id for progress polling
#* @post /api/v1/covariates/download_bg
function(req) {
  body <- req$postBody
  if (is.null(body)) body <- list()
  if (is.character(body)) body <- jsonlite::fromJSON(body, simplifyVector = FALSE)

  type <- body$type %||% ""
  job_id <- paste0("cov_", format(Sys.time(), "%Y%m%d_%H%M%S"), "_", paste(sample(letters, 6), collapse = ""))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  job_meta <- list(
    id = job_id,
    type = type,
    status = "running",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    completed_at = NULL,
    error = NULL,
    config = body
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  script_path <- file.path(app_dir, "plumber", "R", "covariate_download.R")
  if (!file.exists(script_path)) {
    stop("Covariate download script not found at: ", script_path, call. = FALSE)
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  env = c(R_MAX_VSIZE = Sys.getenv("SDM_CHILD_MAX_VSIZE", "6Gb")))

  sdm_process_registry[[job_id]] <- proc
  job_meta$process_pid <- proc$get_pid()
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"), null = "null")

  list(
    job_id = job_id,
    status = "running",
    message = paste("Covariate download started:", type)
  )
}

# Return a 1x1 transparent PNG for empty tiles (MapLibre handles transparent gracefully)
sdm_transparent_tile_png <- function() {
  as.raw(c(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82
  ))
}

# COG cache keyed by file path + mtime (avoids repeated terra::rast() calls)
tile_cog_cache <- new.env(parent = emptyenv())
tile_cog_cache_max <- 20L

#* On-the-fly XYZ tile from COG (fallback when pre-generated tiles missing)
#* Computes tile bounding box in EPSG:3857, crops COG, applies palette, returns PNG
#* @get /api/v1/results/tiles/cog/<run_id>/<z>/<x>/<y>
#* @serializer contentType list(type="image/png")
function(res, run_id, z, x, y) {
  z <- as.integer(z); x <- as.integer(x); y <- as.integer(y)
  if (is.na(z) || is.na(x) || is.na(y) || z < 0L || z > 20L) {
    res$status <- 400L; stop("Invalid tile coordinates")
  }
  n <- 2^z
  if (x < 0L || x >= n || y < 0L || y >= n) {
    res$status <- 400L; stop("Tile coordinates out of range")
  }

  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; stop("Run not found") }

  # Find COG in job directory (filename varies; search by suffix)
  cog_path <- NULL; need_reproject <- FALSE
  cog_files <- list.files(job_dir, pattern = "_3857\\.tif$", full.names = TRUE)
  if (length(cog_files) > 0L) {
    cog_path <- cog_files[1L]
  } else {
    # Fallback: reproject suitability.tif (4326) to 3857 once, cache result as file
    suit_files <- list.files(job_dir, pattern = "_suitability\\.tif$", full.names = TRUE)
    if (length(suit_files) > 0L) {
      fallback_path <- sub("_suitability\\.tif$", "_3857_fallback.tif", suit_files[1L])
      if (!file.exists(fallback_path)) {
        lock_path <- paste0(fallback_path, ".lock")
        lock_acquired <- dir.create(lock_path, showWarnings = FALSE)
        if (!lock_acquired && dir.exists(lock_path)) {
          # Check if lock is stale (>5 minutes old)
          lock_time_file <- file.path(lock_path, "created_at")
          if (file.exists(lock_time_file)) {
            lock_time <- as.POSIXct(readLines(lock_time_file, warn = FALSE))
            if (is.na(lock_time) || difftime(Sys.time(), lock_time, units = "mins") > 5) {
              unlink(lock_path, recursive = TRUE)
              lock_acquired <- dir.create(lock_path, showWarnings = FALSE)
            }
          } else {
            unlink(lock_path, recursive = TRUE)
            lock_acquired <- dir.create(lock_path, showWarnings = FALSE)
          }
        }
        if (lock_acquired) {
          writeLines(format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"), file.path(lock_path, "created_at"))
          on.exit(unlink(lock_path, recursive = TRUE), add = TRUE)
          # Re-check after acquiring lock (another worker may have created it)
          if (!file.exists(fallback_path)) {
            r_4326 <- terra::rast(suit_files[1L])
            r_3857 <- terra::project(r_4326, "EPSG:3857", method = "near")
            terra::writeRaster(r_3857, fallback_path, filetype = "COG",
              gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "BLOCKSIZE=512"),
              NAflag = -9999, datatype = "FLT4S", overwrite = TRUE)
          }
        }
      }
      cog_path <- fallback_path
    }
  }
  if (is.null(cog_path)) { res$status <- 404L; stop("No raster found for run") }

  # Use cached COG raster if available and unchanged
  cog_mtime <- file.info(cog_path)$mtime
  cog_key <- paste0(cog_path, "_", as.numeric(cog_mtime))
  r_cog <- tile_cog_cache[[cog_key]]
  if (is.null(r_cog)) {
    if (length(ls(tile_cog_cache)) >= tile_cog_cache_max) {
      access_times <- sapply(ls(tile_cog_cache), function(k) attr(tile_cog_cache[[k]], "accessed") %||% 0)
      n_excess <- length(ls(tile_cog_cache)) - tile_cog_cache_max + 1L
      to_remove <- names(sort(access_times))[seq_len(n_excess)]
      rm(list = to_remove, envir = tile_cog_cache)
    }
    r_cog <- terra::rast(cog_path)
    attr(r_cog, "accessed") <- Sys.time()
    tile_cog_cache[[cog_key]] <- r_cog
  } else {
    attr(r_cog, "accessed") <- Sys.time()
    tile_cog_cache[[cog_key]] <- r_cog
  }
  cog_range <- terra::minmax(r_cog)
  vr_min <- max(0, cog_range[1, 1])
  vr_max <- min(1, cog_range[2, 1])
  if (!is.finite(vr_min) || !is.finite(vr_max) || vr_max <= vr_min) {
    vr_min <- 0; vr_max <- 1
  }

  n <- 2^z
  tile_res <- 40075016.685578488 / n
  half_world <- 20037508.342789244
  xmin <- x * tile_res - half_world
  xmax <- (x + 1L) * tile_res - half_world
  ymin <- half_world - (y + 1L) * tile_res
  ymax <- half_world - y * tile_res

  r_full <- NULL
  tile_crop <- tryCatch(terra::crop(r_cog, terra::ext(xmin, xmax, ymin, ymax), snap = "out"),
    error = function(e) NULL)
  if (is.null(tile_crop) || terra::ncell(tile_crop) == 0L) {
    # Retry at full resolution — GDAL overview alignment can miss at certain zooms
    r_full <- terra::rast(cog_path)
    tile_crop <- tryCatch(terra::crop(r_full, terra::ext(xmin, xmax, ymin, ymax), snap = "out"),
      error = function(e) NULL)
  }

  template <- terra::rast(ncols = 256L, nrows = 256L, xmin = xmin, xmax = xmax,
    ymin = ymin, ymax = ymax, crs = "EPSG:3857")

  if (is.null(tile_crop) || terra::ncell(tile_crop) == 0L) {
    # Tile is smaller than a single COG pixel — sample center point
    cx <- (xmin + xmax) / 2
    cy <- (ymin + ymax) / 2
    pt <- terra::vect(data.frame(x = cx, y = cy), geom = c("x", "y"), crs = "EPSG:3857")
    center_val <- terra::extract(r_full %||% r_cog, pt)[1, 1]
    if (is.na(center_val) || !is.finite(center_val)) { res$status <- 204L; return(sdm_transparent_tile_png()) }
    vals <- rep(as.numeric(center_val), 65536)
    is_na <- rep(FALSE, 65536)
  } else {
    vals <- terra::values(tile_crop)
    has_na_edge <- any(is.na(vals))
    resample_method <- if (has_na_edge) "near" else "bilinear"
    tile_256 <- tryCatch(terra::resample(tile_crop, template, method = resample_method),
      error = function(e) NULL)
    if (is.null(tile_256)) { res$status <- 204L; return(sdm_transparent_tile_png()) }
    vals <- terra::values(tile_256)
    is_na <- is.na(vals) | !is.finite(vals) | (vals <= -9998)
    if (all(is_na)) { res$status <- 204L; return(sdm_transparent_tile_png()) }
  }

  # Apply palette (shared with R/core/config.R)
  palette <- sdm_suitability_palette
  pal_rgb <- grDevices::col2rgb(palette, alpha = TRUE)
  n_col <- length(palette)
  idx <- if (all(is_na)) integer(0) else {
    round((vals - vr_min) / (vr_max - vr_min) * (n_col - 1L)) + 1L
  }
  if (length(idx) > 0) idx <- pmax(1L, pmin(n_col, idx))

  rgba <- matrix(0L, nrow = 65536L, ncol = 4L)
  rgba[!is_na, 1L] <- pal_rgb[1, idx[!is_na]]
  rgba[!is_na, 2L] <- pal_rgb[2, idx[!is_na]]
  rgba[!is_na, 3L] <- pal_rgb[3, idx[!is_na]]
  rgba[!is_na, 4L] <- 255L

  # Write PNG via GDAL (no external package needed)
  tmp_png <- tempfile(fileext = ".png")
  tile_out <- terra::rast(ncols = 256L, nrows = 256L, xmin = xmin, xmax = xmax,
    ymin = ymin, ymax = ymax, crs = "EPSG:3857", nlyrs = 4L)
  terra::values(tile_out) <- rgba
  terra::writeRaster(tile_out, tmp_png, datatype = "INT1U", gdal = "ZLEVEL=6", overwrite = TRUE)
  raw_bytes <- readBin(tmp_png, "raw", n = file.info(tmp_png)$size)
  unlink(tmp_png)
  res$setHeader("Cache-Control", "public, max-age=3600")
  raw_bytes
}

#* Serve boundary GeoJSON (NE Admin 0, Land, or custom — auto-downloads if missing)
#* @param resolution Boundary resolution: auto, 110m, 50m, or 10m
#* @param type Boundary type: admin0, land, or custom
#* @param country Country name or ISO code, or "all" for no filter
#* @post /api/v1/data/boundary/default
function(resolution = NULL, type = NULL, country = NULL, res) {
  dataset_type <- type %||% "admin0"
  scale <- resolution %||% "110m"
  country_val <- country %||% "all"

  boundary_path <- if (dataset_type == "custom" && !is.null(country) && nzchar(country)) {
    country
  } else if (dataset_type %in% c("admin0", "land")) {
    tryCatch(
      resolve_mask_file(dataset_type, scale, country_val, raster_res = NULL, default_file = NULL),
      error = function(e) NULL
    )
  } else {
    NULL
  }

  # Plumber sets wd to plumber.R directory, so relative paths from R modules
  # need to be resolved against the project root (app_dir).
  if (!is.null(boundary_path) && !file.exists(boundary_path)) {
    abs_path <- file.path(app_dir, boundary_path)
    if (file.exists(abs_path)) boundary_path <- abs_path
  }
  if (is.null(boundary_path) || !file.exists(boundary_path)) {
    fallback <- sdm_default_mask_file
    if (!file.exists(fallback)) fallback <- file.path(app_dir, fallback)
    boundary_path <- fallback
  }
  if (!file.exists(boundary_path)) {
    res$status <- 404L
    return(list(error = "Boundary file not found"))
  }

  geojson <- jsonlite::fromJSON(boundary_path, simplifyVector = FALSE)
  geojson
}

#* Upload custom boundary (GeoJSON, KML, GPKG, or zipped shapefile — converted to GeoJSON)
#* Receives file content as base64-encoded JSON (Hono converts multipart to base64)
#* @param file_name Original filename with extension (.geojson, .json, .kml, .gpkg, .zip)
#* @param file_content Base64-encoded file content
#* @post /api/v1/data/boundary/upload
function(file_name, file_content, res) {
  if (is.null(file_name) || is.null(file_content) || !nzchar(file_content)) {
    res$status <- 400L
    return(list(error = "No file uploaded"))
  }
  ext <- tolower(tools::file_ext(file_name))
  if (!ext %in% c("geojson", "json", "kml", "gpkg", "zip")) {
    res$status <- 400L
    return(list(error = "Only .geojson, .json, .kml, .gpkg, or .zip files accepted. For shapefiles, zip the .shp + .shx + .dbf + .prj together."))
  }
  tmp <- tempfile(fileext = paste0(".", ext))
  on.exit(unlink(tmp), add = TRUE)
  writeBin(jsonlite::base64_dec(file_content), tmp)

  boundary_dir <- file.path("data", "boundaries", "custom")
  dir.create(boundary_dir, recursive = TRUE, showWarnings = FALSE)
  uuid_base <- paste0(format(Sys.time(), "%Y%m%d_%H%M%S"), "_", gsub("-", "", uuid::UUIDgenerate()))

  needs_conversion <- !ext %in% c("geojson", "json")
  src <- tmp
  if (needs_conversion) {
    if (ext == "zip") {
      zip_dir <- tempfile()
      dir.create(zip_dir, showWarnings = FALSE)
      on.exit(unlink(zip_dir, recursive = TRUE), add = TRUE)
      utils::unzip(src, exdir = zip_dir)
      src <- list.files(zip_dir, pattern = "\\.(shp|kml|gpkg|geojson|json)$", full.names = TRUE, recursive = TRUE)[1]
      if (is.na(src) || !file.exists(src)) {
        res$status <- 400L
        return(list(error = "ZIP archive does not contain a valid vector file (.shp, .kml, .gpkg, .geojson)"))
      }
    }
    dest <- file.path(boundary_dir, paste0(uuid_base, ".geojson"))
    tryCatch({
      vec <- sf::st_read(src, quiet = TRUE)
      sf::st_write(vec, dest, delete_dsn = TRUE, quiet = TRUE)
    }, error = function(e) {
      res$status <- 400L
      stop("Failed to convert boundary file: ", conditionMessage(e))
    })
  } else {
    dest <- file.path(boundary_dir, paste0(uuid_base, ".geojson"))
    file.copy(src, dest, overwrite = TRUE)
  }
  list(
    file_path = normalizePath(dest, winslash = "/"),
    file_name = file_name,
    file_size = file.size(dest)
  )
}

#* List custom boundaries
#* @post /api/v1/data/boundary/list
function(res) {
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  if (!dir.exists(custom_dir)) {
    return(list(boundaries = list()))
  }
  files <- list.files(custom_dir, pattern = "\\.geojson$", full.names = TRUE)
  boundaries <- lapply(files, function(f) {
    list(
      file_path = normalizePath(f, winslash = "/"),
      file_name = basename(f),
      file_size = file.size(f),
      modified_at = format(file.mtime(f), "%Y-%m-%dT%H:%M:%SZ")
    )
  })
  list(boundaries = boundaries)
}

#* Delete custom boundary
#* @param file_path Absolute path to the boundary file to delete
#* @post /api/v1/data/boundary/delete
function(file_path, res) {
  if (is.null(file_path) || !nzchar(file_path)) {
    res$status <- 400L
    return(list(error = "File path required"))
  }
  custom_dir <- tryCatch(normalizePath(file.path(app_dir, "data", "boundaries", "custom"), winslash = "/"), error = function(e) NULL)
  resolved_path <- tryCatch(normalizePath(file_path, winslash = "/", mustWork = FALSE), error = function(e) NULL)
  if (is.null(resolved_path) || is.null(custom_dir) || !startsWith(resolved_path, custom_dir)) {
    res$status <- 403L
    return(list(error = "Invalid file path"))
  }
  if (!file.exists(resolved_path)) {
    res$status <- 404L
    return(list(error = "File not found"))
  }
  file.remove(resolved_path)
  list(ok = TRUE)
}

#* List country names from Admin 0 boundary
#* @post /api/v1/data/boundary/countries
function(res) {
  boundary_path <- file.path("data", "boundaries", "ne", "110m", "ne_10m_admin_0_countries.geojson")
  if (!file.exists(boundary_path)) {
    boundary_path <- file.path(app_dir, boundary_path)
  }
  if (!file.exists(boundary_path)) {
    res$status <- 404L
    return(list(error = "Admin 0 boundary not found — download NE data first"))
  }
  geojson <- jsonlite::fromJSON(boundary_path, simplifyVector = FALSE)
  feats <- geojson$features %||% list()
  countries <- unique(vapply(feats, function(f) {
    props <- f$properties %||% list()
    props$ADMIN %||% props$NAME %||% props$name %||% "Unknown"
  }, character(1)))
  countries <- sort(countries[!is.na(countries) & countries != ""])
  list(countries = countries)
}

#* Compute bounding box extent of a boundary file
#* @param file_path Direct path to a boundary file (alternative to type/resolution/country)
#* @param type Boundary type: admin0, land, or custom
#* @param resolution Boundary resolution: auto, 110m, 50m, or 10m
#* @param country Country name or ISO code, or "all"
#* @param buffer_deg Buffer in degrees around computed extent (default: 2)
#* @post /api/v1/data/boundary/extent
function(file_path = NULL, type = NULL, resolution = NULL, country = NULL, buffer_deg = 2, res) {
  # Resolve file path from params if not given directly
  if (is.null(file_path) || !file.exists(file_path)) {
    if (!is.null(type)) {
      res_type <- type %||% "admin0"
      res_scale <- resolution %||% "110m"
      if (identical(res_scale, "auto")) res_scale <- ne_boundary_infer_scale(NULL)
      if (res_type == "custom" && !is.null(country) && nzchar(country)) {
        file_path <- country
      } else if (res_type %in% c("admin0", "land")) {
        file_path <- get_ne_boundary_path(res_scale, res_type)
        if (!file.exists(file_path)) {
          file_path <- download_ne_boundary(res_scale, res_type)
        }
        if (res_type == "admin0" && !is.null(country) && nzchar(country) && tolower(country) != "all") {
          file_path <- filter_admin0_to_country(file_path, country)
        }
      }
    }
  }
  if (is.null(file_path) || !file.exists(file_path)) {
    res$status <- 404L
    return(list(error = "Boundary file not found"))
  }
  tryCatch({
    vec <- terra::vect(file_path)
    e <- terra::ext(vec)
    xmin <- e[1]; xmax <- e[2]; ymin <- e[3]; ymax <- e[4]
    buf <- as.numeric(buffer_deg) %||% 2
    list(xmin = xmin - buf, xmax = xmax + buf, ymin = ymin - buf, ymax = ymax + buf)
  }, error = function(e) {
    res$status <- 500L
    list(error = paste("Failed to compute extent:", conditionMessage(e)))
  })
}

#* Download Natural Earth boundary to custom directory for model use
#* Saves the resolved boundary to data/boundaries/custom/ so it appears
#* in the model config form's "Uploaded boundary file" dropdown.
#* @param type Boundary type: admin0 or land
#* @param resolution Boundary resolution: 110m, 50m, or 10m
#* @param country Country name or "all"
#* @post /api/v1/data/boundary/download
function(type = "admin0", resolution = "110m", country = "all", res) {
  tryCatch({
    scale <- resolution %||% "110m"
    country_val <- country %||% "all"

    boundary_path <- tryCatch(
      resolve_mask_file(type, scale, country_val, raster_res = NULL, default_file = NULL),
      error = function(e) NULL
    )

    if (!is.null(boundary_path) && !file.exists(boundary_path)) {
      abs_path <- file.path(app_dir, boundary_path)
      if (file.exists(abs_path)) boundary_path <- abs_path
    }

    if (is.null(boundary_path) || !file.exists(boundary_path)) {
      fallback <- sdm_default_mask_file
      if (!file.exists(fallback)) fallback <- file.path(app_dir, fallback)
      if (file.exists(fallback)) {
        boundary_path <- fallback
      } else {
        return(list(status = "error", message = "Boundary not available via Natural Earth download"))
      }
    }

    custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
    dir.create(custom_dir, recursive = TRUE, showWarnings = FALSE)
    label <- if (country_val != "all") gsub("[^a-zA-Z0-9_-]", "_", tolower(country_val)) else type
    saved_name <- sprintf("ne_%s_%s_%s.geojson", scale, type, label)
    saved_path <- file.path(custom_dir, saved_name)

    file.copy(boundary_path, saved_path, overwrite = TRUE)

    list(
      status = "success",
      message = paste("Downloaded", type, "boundary at", scale, "resolution"),
      file = list(
        file_path = normalizePath(saved_path, winslash = "/"),
        file_name = saved_name,
        file_size = file.size(saved_path)
      )
    )
  }, error = function(e) {
    list(status = "error", message = conditionMessage(e))
  })
}
