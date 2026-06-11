handle_occurrences_upload <- function(req, app_dir) {
  uploaded <- req$args$file

  tryCatch({
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
      return(sdm_error_code(req, "INVALID_INPUT", paste("File too large. Maximum", max_size / 1e6, "MB.")))
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

    con <- db_conn()
    on.exit(db_release(con), add = TRUE)

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

      occ <- normalize_coord_columns(occ)
      src_col <- detect_column(names(occ), c("^(source|datasource|institution|institutioncode)$"))

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

      occ <- parse_coordinates(occ)

      coord_warnings <- character(0)
      if ("longitude" %in% names(occ) && "latitude" %in% names(occ)) {
        n_total <- length(occ$longitude)
        n_na_lon <- sum(is.na(suppressWarnings(as.numeric(gsub(",", ".", as.character(occ$longitude))))))
        n_na_lat <- sum(is.na(suppressWarnings(as.numeric(gsub(",", ".", as.character(occ$latitude))))))
        n_non_numeric <- max(n_na_lon, n_na_lat)

        if (n_non_numeric > 0) {
          raw_lon <- utils::head(occ$longitude, 3)
          raw_lat <- utils::head(occ$latitude, 3)
          coord_warnings <- c(coord_warnings, paste0(
            n_non_numeric, " of ", n_total, " record(s) have unparseable coordinates. ",
            "Sample longitude values: [", paste(shQuote(raw_lon), collapse = ", "), "]. ",
            "Sample latitude values: [", paste(shQuote(raw_lat), collapse = ", "), "]."
          ))
        } else {
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
      species_names <- infer_species_labels(file_path)
      preview <- head(occ, 5)
      preview <- lapply(seq_len(nrow(preview)), function(i) as.list(preview[i, ]))

      upload_result <- list(
        file_id = dest_path,
        file_path = rel_path,
        filename = uploaded$filename[[1]] %||% uploaded$name[[1]] %||% basename(dest_path),
        format = if (ext %in% c("tsv", "txt")) "tsv" else "csv",
        n_rows = n_rows,
        species_detected = species_detected,
        species_names = species_names,
        columns_detected = columns_detected,
        coord_warnings = if (length(coord_warnings) > 0) coord_warnings else NULL,
        preview = preview
      )
    }

    db_insert_upload(
      con, req$user_id,
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

handle_occurrences_uploads <- function(req, app_dir, limit = 50) {
  limit <- suppressWarnings(as.integer(limit))
  if (!is.finite(limit) || limit < 1) limit <- 50L
  con <- db_conn()
  if (is.null(con)) return(list(uploads = list()))
  on.exit(db_release(con), add = TRUE)
  tryCatch({
    user_filter <- req$user_id
    rows <- if (is.null(user_filter)) {
      DBI::dbGetQuery(con,
        "SELECT id, filename, file_path, file_size, format, n_rows, species, columns_detected, created_at,
                is_cleaned, cleaned_file_path, cleaned_valid_records, cleaned_original_rows
         FROM uploads ORDER BY created_at DESC LIMIT $1",
        params = list(limit)
      )
    } else {
      DBI::dbGetQuery(con,
        "SELECT id, filename, file_path, file_size, format, n_rows, species, columns_detected, created_at,
                is_cleaned, cleaned_file_path, cleaned_valid_records, cleaned_original_rows
         FROM uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        params = list(user_filter, limit)
      )
    }
    if (nrow(rows) == 0) return(list(uploads = list()))
    list(uploads = lapply(seq_len(nrow(rows)), function(i) as.list(rows[i, ])))
  }, error = function(e) list(uploads = list(), error = conditionMessage(e)))
}

handle_occurrences_clean <- function(req, app_dir, file_id, min_source_records = 15, merge_small_sources = TRUE, use_cc = FALSE, cc_tests = "all", max_coordinate_uncertainty = NULL, max_records = 200000L) {
  min_source_records <- suppressWarnings(as.integer(min_source_records))
  if (!is.finite(min_source_records)) min_source_records <- 15L

  max_coordinate_uncertainty <- if (is.null(max_coordinate_uncertainty) || !nzchar(max_coordinate_uncertainty)) NULL else suppressWarnings(as.numeric(max_coordinate_uncertainty))

  safe_path <- sdm_safe_path(file_id, file.path(app_dir, "data", "uploads"))
  if (is.null(safe_path)) {
    return(sdm_error(req, 400, "Invalid file_id"))
  }

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- sdm_submit_async_job(req, app_dir, "clean", list(
    file_id = file_id,
    min_source_records = min_source_records,
    merge_small_sources = merge_small_sources,
    use_cc = use_cc,
    cc_tests = cc_tests,
    max_coordinate_uncertainty = max_coordinate_uncertainty,
    max_records = max_records
  ), user_id)

  if (is.null(job_id)) {
    return(sdm_error(req, 500, "Failed to submit clean job"))
  }

  list(job_id = job_id, status = "running")
}

sdm_submit_gbif_search <- function(req, taxon, country = NULL, max_records = 100,
                                    use_auth = NULL,
                                    gbif_user = NULL, gbif_pwd = NULL, gbif_email = NULL,
                                    app_dir,
                                    submit_fun = function(job_type, params, app_dir, user_id) {
                                      sdm_submit_async_job(req, app_dir, job_type, params, user_id)
                                    }) {
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
  ), app_dir, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "GBIF search started in background"
  )
}

handle_occurrences_gbif_search <- function(req, app_dir, taxon, country = NULL, max_records = 100, use_auth = NULL,
         gbif_user = NULL, gbif_pwd = NULL, gbif_email = NULL) {
  sdm_submit_gbif_search(req, taxon, country, max_records,
                         use_auth, gbif_user, gbif_pwd, gbif_email,
                         app_dir)
}

sdm_submit_ala_search <- function(req, taxon, country = NULL, max_records = 100,
                                    api_key = NULL,
                                    app_dir,
                                    submit_fun = function(job_type, params, app_dir, user_id) {
                                      sdm_submit_async_job(req, app_dir, job_type, params, user_id)
                                    }) {
  if (is.null(taxon) || !nzchar(taxon)) {
    return(sdm_error(req, 400, "taxon is required"))
  }

  max_records <- suppressWarnings(as.integer(max_records))
  if (!is.finite(max_records) || max_records < 1) max_records <- 100L

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- submit_fun("ala", list(
    taxon = taxon,
    country = if (!is.null(country) && nzchar(country)) country else NULL,
    max_records = max_records,
    api_key = api_key %||% NULL
  ), app_dir, user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "ALA search started in background"
  )
}

handle_occurrences_ala_search <- function(req, app_dir, taxon, country = NULL, max_records = 100, api_key = NULL) {
  sdm_submit_ala_search(req, taxon, country, max_records, api_key, app_dir)
}

handle_occurrences_dwca <- function(req, app_dir, file_id, species_filter = NULL, max_coord_uncertainty_m = NULL, basis_of_record_filter = NULL) {
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

  job_id <- sdm_submit_async_job(req, app_dir, "dwca", list(
    file_id = file_id,
    species_filter = if (!is.null(species_filter) && nzchar(species_filter)) species_filter else NULL,
    max_coord_uncertainty_m = max_unc,
    basis_of_record_filter = bor_filter
  ), user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "Darwin Core Archive parsing started in background"
  )
}
