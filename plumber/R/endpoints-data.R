#* SDM Platform — Occurrence Data Endpoints
#* Upload, clean, GBIF search, and DwC-A parsing

#* Upload occurrence file (CSV/TSV/ZIP)
#* @param file The occurrence file to upload
#* @post /api/v1/occurrences/upload
function(req) {
  uploaded <- req$postBody$file
  if (is.null(uploaded) || !nzchar(uploaded %||% "")) {
    return(plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = "No file uploaded. Send multipart/form-data with field 'file'."), auto_unbox = TRUE),
      content_type = "application/json"
    ))
  }

  file_path <- uploaded$tempfile %||% uploaded$path
  if (!file.exists(file_path)) {
    return(plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = "Uploaded file not found on server."), auto_unbox = TRUE),
      content_type = "application/json"
    ))
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
    plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE),
      content_type = "application/json"
    )
  })
}

#* Clean occurrence data with configurable options
#* @param file_id The uploaded file path or ID
#* @param min_source_records Minimum records per source to keep (default: 15)
#* @param merge_small_sources Merge small sources (default: true)
#* @param use_cc Run CoordinateCleaner (default: false)
#* @param cc_tests CC tests to run: all, sea, capitals, centroids, institutions, urban, zero (default: all)
#* @post /api/v1/occurrences/clean
function(file_id, min_source_records = 15, merge_small_sources = TRUE, use_cc = FALSE, cc_tests = "all") {
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
    plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE),
      content_type = "application/json"
    )
  })
}

#* Search GBIF for occurrence records
#* @param taxon Species name (e.g., "Acacia mearnsii")
#* @param country Country code filter (e.g., "AU")
#* @param max_records Maximum records to fetch (default: 100)
#* @post /api/v1/occurrences/gbif/search
function(taxon, country = NULL, max_records = 100) {
  if (is.null(taxon) || !nzchar(taxon)) {
    return(plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = "taxon is required"), auto_unbox = TRUE),
      content_type = "application/json"
    ))
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
    plumber::plumber_response(
      status = 502,
      body = toJSON(list(error = paste("GBIF search failed:", conditionMessage(e))), auto_unbox = TRUE),
      content_type = "application/json"
    )
  })
}

#* Parse a Darwin Core Archive (.zip file)
#* @param file_id Path to the uploaded .zip file
#* @param species_filter Optional species name filter
#* @param max_coord_uncertainty_m Max coordinate uncertainty in meters
#* @param basis_of_record_filter Basis of record values to include (comma-separated)
#* @post /api/v1/occurrences/dwca
function(file_id, species_filter = NULL, max_coord_uncertainty_m = NULL, basis_of_record_filter = NULL) {
  if (is.null(file_id) || !nzchar(file_id)) {
    return(plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = "file_id is required"), auto_unbox = TRUE),
      content_type = "application/json"
    ))
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
    plumber::plumber_response(
      status = 400,
      body = toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE),
      content_type = "application/json"
    )
  })
}
