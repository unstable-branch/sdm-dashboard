# Occurrence data ingestion, cleaning, and thinning.

detect_column <- function(names_vec, patterns) {
  lower <- tolower(names_vec)
  for (pattern in patterns) {
    hit <- grep(pattern, lower, perl = TRUE)
    if (length(hit) > 0) return(names_vec[hit[1]])
  }
  NA_character_
}

read_occurrence_file <- function(path, log_fun = NULL) {
  if (is.null(path) || !file.exists(path)) {
    stop("Occurrence file not found. Upload a CSV or restore presence_data.csv.", call. = FALSE)
  }
  ext <- tolower(tools::file_ext(path))
  if (ext == "zip") {
    result <- read_dwca(path, log_fun = log_fun)
    occ <- result$occurrences
    if ("x" %in% names(occ) && !"longitude" %in% names(occ)) {
      occ$longitude <- occ$x
    }
    if ("y" %in% names(occ) && !"latitude" %in% names(occ)) {
      occ$latitude <- occ$y
    }
    if ("species" %in% names(occ) && !"source" %in% names(occ)) {
      occ$source <- occ$species
    }
    if (!"source" %in% names(occ)) {
      occ$source <- "DwC-A"
    }
    attr(occ, "gbif_doi") <- result$doi
    attr(occ, "n_raw") <- result$n_raw
    attr(occ, "dwca_datasets") <- result$datasets
    attr(occ, "dwca_issues") <- result$issues_flagged
    attr(occ, "dwca_n_returned") <- result$n_returned
    return(occ)
  }
  is_tab <- grepl("\\.(tsv|txt)$", path, ignore.case = TRUE)
  log_message(log_fun, "Reading occurrences from ", normalizePath(path, winslash = "/", mustWork = FALSE))
  if (is_tab) {
    utils::read.delim(path, quote = "", stringsAsFactors = FALSE, check.names = FALSE)
  } else {
    if (requireNamespace("data.table", quietly = TRUE)) {
      data.table::fread(path, stringsAsFactors = FALSE, check.names = FALSE)
    } else {
      utils::read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    }
  }
}

clean_occurrences <- function(path, min_source_records = 15, merge_small_sources = TRUE,
                              use_cc = FALSE, cc_tests = "all", log_fun = NULL) {
  raw <- read_occurrence_file(path, log_fun = log_fun)
  original_n <- nrow(raw)
  if (original_n == 0) stop("Occurrence file is empty.", call. = FALSE)

  lon_col <- detect_column(names(raw), c("^(lon|longitude|x)$", "decimal.*lon", "decimallongitude", "^long"))
  lat_col <- detect_column(names(raw), c("^(lat|latitude|y)$", "decimal.*lat", "decimallatitude"))
  src_col <- detect_column(names(raw), c("^(source|datasource|data_source|institution|institutioncode|herbarium|provider)$", "basisofrecord", "dataset"))
country_col <- detect_column(names(raw), c("^(countrycode|country|iso2)$"))
  status_col <- detect_column(names(raw), c("occurrenceStatus"))

  source <- if (!is.na(src_col)) raw[[src_col]] else rep("Unknown", nrow(raw))
  source <- as.character(source)
  source[is.na(source) | trimws(source) == ""] <- "Unknown"
  source <- trimws(source)
  source <- gsub("[^A-Za-z0-9 _.-]+", "_", source)
  source <- gsub("[ ]+", "_", source)

  if (!is.na(status_col)) {
    raw_status <- as.character(raw[[status_col]])
    raw_status[is.na(raw_status) | trimws(raw_status) == ""] <- "PRESENT"
  } else {
    raw_status <- rep(NA_character_, nrow(raw))
  }
  n_absent_excluded <- sum(raw_status == "ABSENT", na.rm = TRUE)

  occ <- data.frame(
    longitude = suppressWarnings(as.numeric(raw[[lon_col]])),
    latitude = suppressWarnings(as.numeric(raw[[lat_col]])),
    source = source,
    stringsAsFactors = FALSE
  )
  if (!is.na(country_col)) occ$countryCode <- as.character(raw[[country_col]])

  complete_ok <- stats::complete.cases(occ[, c("longitude", "latitude", "source")])
  finite_ok <- is.finite(occ$longitude) & is.finite(occ$latitude)
  bounds_ok <- occ$longitude >= -180 & occ$longitude <= 180 & occ$latitude >= -90 & occ$latitude <= 90
  status_ok <- is.na(raw_status) | raw_status == "PRESENT"
  ok <- complete_ok & finite_ok & bounds_ok & status_ok
  removed_bad <- sum(!ok)
  occ <- occ[ok, , drop = FALSE]

  duplicated_rows <- duplicated(occ[, c("longitude", "latitude", "source")])
  removed_dupes <- sum(duplicated_rows)
  occ <- occ[!duplicated_rows, , drop = FALSE]
  occ$source[is.na(occ$source) | occ$source == "" | occ$source == "NA"] <- "Unknown"
  occ$presence <- 1L

  source_counts <- sort(table(occ$source), decreasing = TRUE)
  small_sources <- names(source_counts[source_counts < min_source_records])
  if (length(small_sources) > 0) {
    if (merge_small_sources) {
      occ$source[occ$source %in% small_sources] <- "Other_institutions"
      log_message(log_fun, "Merged ", length(small_sources), " small sources into Other_institutions")
    } else {
      occ <- occ[!occ$source %in% small_sources, , drop = FALSE]
      log_message(log_fun, "Dropped ", length(small_sources), " small sources")
    }
  }
  source_counts <- sort(table(occ$source), decreasing = TRUE)
  if (nrow(occ) < 20) stop("Too few valid occurrence records after cleaning (", nrow(occ), ").", call. = FALSE)

  if (use_cc && requireNamespace("CoordinateCleaner", quietly = TRUE)) {
    cc_tests_active <- if (identical(cc_tests, "all")) {
      c("sea", "capitals", "institutions", "centroids", "urban", "zeros")
    } else {
      cc_tests
    }
    cc_result <- CoordinateCleaner::clean_coordinates(
      occ,
      lon = "longitude",
      lat = "latitude",
      species = NULL,
      tests = cc_tests_active,
      value = "spatialvalid"
    )
    occ$cc_flag <- !cc_result$.summary
    cc_test_map <- c(.sea = "cc_test_sea", .cap = "cc_test_capitals",
                    .inst = "cc_test_institutions", .cen = "cc_test_centroids",
                    .otl = "cc_test_urban", .zer = "cc_test_zero",
                    .equ = "cc_test_equal", .gbf = "cc_test_gbif")
    for (col in names(cc_result)) {
      if (col %in% names(cc_test_map)) {
        occ[[cc_test_map[[col]]]] <- !cc_result[[col]]
      }
    }
    n_flagged <- sum(!cc_result$.summary, na.rm = TRUE)
    log_message(log_fun, "CoordinateCleaner flagged ", n_flagged, " of ", nrow(occ), " records")
  } else if (use_cc && !requireNamespace("CoordinateCleaner", quietly = TRUE)) {
    warning("CoordinateCleaner not installed. Install with: install.packages('CoordinateCleaner')")
  }

  log_message(log_fun, "Cleaned occurrences: ", format(nrow(occ), big.mark = ","),
              " valid records from ", length(source_counts), " sources; removed ",
              format(removed_bad, big.mark = ","), " invalid coordinates and ",
              format(removed_dupes, big.mark = ","), " duplicates")

  list(raw = raw, occ = occ, source_counts = source_counts,
       removed_bad_coordinates = removed_bad, removed_duplicates = removed_dupes,
       original_rows = original_n,
       n_absent_excluded = n_absent_excluded,
       has_occurrence_status = !is.na(status_col),
       columns = list(longitude = lon_col, latitude = lat_col, source = src_col, country = country_col))
}

make_training_extent <- function(occ, buffer = 2) {
  xmin <- max(-180, floor(min(occ$longitude, na.rm = TRUE) - buffer))
  xmax <- min(180, ceiling(max(occ$longitude, na.rm = TRUE) + buffer))
  ymin <- max(-90, floor(min(occ$latitude, na.rm = TRUE) - buffer))
  ymax <- min(90, ceiling(max(occ$latitude, na.rm = TRUE) + buffer))
  if ((xmax - xmin) < 1) { xmin <- max(-180, xmin - 0.5); xmax <- min(180, xmax + 0.5) }
  if ((ymax - ymin) < 1) { ymin <- max(-90, ymin - 0.5); ymax <- min(90, ymax + 0.5) }
  c(xmin, xmax, ymin, ymax)
}

thin_occurrences_by_cell <- function(occ, raster_template, by_source = FALSE, log_fun = NULL) {
  cells <- terra::cellFromXY(raster_template, occ[, c("longitude", "latitude")])
  inside <- !is.na(cells)
  removed_outside <- sum(!inside)
  occ <- occ[inside, , drop = FALSE]
  cells <- cells[inside]
  key <- if (by_source) paste(cells, occ$source, sep = "_") else as.character(cells)
  keep <- !duplicated(key)
  removed_duplicates <- sum(!keep)
  occ <- occ[keep, , drop = FALSE]
  if (removed_outside > 0 || removed_duplicates > 0) {
    log_message(log_fun, "Raster thinning removed ", removed_outside, " records outside raster extent and ", removed_duplicates, " duplicate cell records")
  }
  occ
}

#' Fetch GBIF occurrence records via public API (occ_search)
#'
#' @param taxon Species name to search for (e.g., "Acacia mearnsii")
#' @param country Optional country code filter (e.g., "AU")
#' @param max_records Maximum number of records to fetch (up to 10,000 for public API)
#' @param token Optional GBIF API token (not required for public searches)
#' @param log_fun Optional logging function
#' @return data.frame with columns: longitude, latitude, species, source, gbif_key, gbif_doi
#' @examples
#' \dontrun{
#' records <- read_gbif_records("Acacia mearnsii", country = "AU", max_records = 100)
#' }
read_gbif_records <- function(taxon, country = NULL, max_records = 100,
                              token = NULL, log_fun = NULL) {
  if (!requireNamespace("rgbif", quietly = TRUE)) {
    stop("rgbif package required for GBIF fetching. Install with: install.packages('rgbif')")
  }

  log_message(log_fun, "Fetching GBIF records for: ", taxon)

  taxon_key <- rgbif::name_backbone(taxon)$speciesKey

  result <- rgbif::occ_search(
    taxonKey = taxon_key,
    country = country,
    limit = min(max_records, 10000),
    hasCoordinate = TRUE,
    decimalLatitude = "present",
    decimalLongitude = "present"
  )

  if (is.null(result$data) || nrow(result$data) == 0) {
    log_message(log_fun, "No GBIF records found for: ", taxon)
    return(data.frame(
      longitude = numeric(),
      latitude = numeric(),
      species = character(),
      source = character(),
      gbif_key = character(),
      stringsAsFactors = FALSE
    ))
  }

  doi <- result$meta$doi
  if (is.null(doi)) doi <- NA_character_

  data.frame(
    longitude = result$data$decimalLongitude,
    latitude = result$data$decimalLatitude,
    species = if (!is.null(result$data$species)) result$data$species else taxon,
    source = "GBIF",
    gbif_key = as.character(result$data$key),
    gbif_doi = doi,
    stringsAsFactors = FALSE
  )
}

#' Download GBIF occurrence records via authenticated API (occ_download)
#'
#' @param taxon Species name to search for
#' @param country Optional country code filter
#' @param token GBIF API token for authenticated downloads
#' @param max_attempts Maximum polling attempts for download completion
#' @param poll_interval Seconds between status polls
#' @param ... Additional arguments passed to rgbif::occ_download
#' @return list with occurrences data.frame, doi character, and gbif_key
#' @examples
#' \dontrun{
#' result <- read_gbif_download("Acacia mearnsii", token = "YOUR_TOKEN")
#' }
read_gbif_download <- function(taxon, country = NULL, token,
                               max_attempts = 30, poll_interval = 10, ...) {
  if (!requireNamespace("rgbif", quietly = TRUE)) {
    stop("rgbif package required for GBIF downloading. Install with: install.packages('rgbif')")
  }

  taxon_key <- rgbif::name_backbone(taxon)$speciesKey

  pred_list <- list(
    rgbif::pred("taxonKey", taxon_key),
    rgbif::pred("hasCoordinate", TRUE)
  )
  if (!is.null(country)) {
    pred_list <- c(pred_list, rgbif::pred("country", country))
  }

  download_key <- rgbif::occ_download(
    !!!pred_list,
    user = "token",
    pwd = token,
    email = "user@example.com"
  )

  status <- "running"
  attempts <- 0
  while (status == "running" && attempts < max_attempts) {
    Sys.sleep(poll_interval)
    status_info <- rgbif::occ_download_meta(download_key)
    status <- status_info$status
    attempts <- attempts + 1
    log_message(NULL, "GBIF download status: ", status, " (attempt ", attempts, "/", max_attempts, ")")
  }

  if (status != "succeeded") {
    stop("GBIF download failed or timed out after ", max_attempts, " attempts")
  }

  doi <- rgbif::occ_download_meta(download_key)$doi

  occ_data <- rgbif::occ_download_get(download_key, path = tempdir())

  list(
    occurrences = occ_data,
    doi = doi,
    gbif_key = download_key
  )
}
