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
  is_tab <- grepl("\\.(tsv|txt)$", path, ignore.case = TRUE)
  log_message(log_fun, "Reading occurrences from ", normalizePath(path, winslash = "/", mustWork = FALSE))
  if (is_tab) {
    utils::read.delim(path, quote = "", stringsAsFactors = FALSE, check.names = FALSE)
  } else {
    utils::read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  }
}

clean_occurrences <- function(path, min_source_records = 15, merge_small_sources = TRUE, log_fun = NULL) {
  raw <- read_occurrence_file(path, log_fun = log_fun)
  original_n <- nrow(raw)
  if (original_n == 0) stop("Occurrence file is empty.", call. = FALSE)

  lon_col <- detect_column(names(raw), c("^(lon|longitude|x)$", "decimal.*lon", "decimallongitude", "^long"))
  lat_col <- detect_column(names(raw), c("^(lat|latitude|y)$", "decimal.*lat", "decimallatitude"))
  src_col <- detect_column(names(raw), c("^(source|datasource|data_source|institution|institutioncode|herbarium|provider)$", "basisofrecord", "dataset"))
  country_col <- detect_column(names(raw), c("^(countrycode|country|iso2)$"))

  if (is.na(lon_col) || is.na(lat_col)) {
    stop("Could not find longitude/latitude columns. Expected longitude/latitude, lon/lat, or decimalLongitude/decimalLatitude.", call. = FALSE)
  }

  source <- if (!is.na(src_col)) raw[[src_col]] else rep("Unknown", nrow(raw))
  source <- as.character(source)
  source[is.na(source) | trimws(source) == ""] <- "Unknown"
  source <- trimws(source)
  source <- gsub("[^A-Za-z0-9 _.-]+", "_", source)
  source <- gsub("[ ]+", "_", source)

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
  ok <- complete_ok & finite_ok & bounds_ok
  removed_bad <- sum(!ok)
  occ <- occ[ok, , drop = FALSE]

  duplicated_rows <- duplicated(occ[, c("longitude", "latitude", "source")])
  removed_dupes <- sum(duplicated_rows)
  occ <- occ[!duplicated_rows, , drop = FALSE]
  occ$source[is.na(occ$source) | occ$source == "" | occ$source == "NA"] <- "Unknown"

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

  log_message(log_fun, "Cleaned occurrences: ", format(nrow(occ), big.mark = ","),
              " valid records from ", length(source_counts), " sources; removed ",
              format(removed_bad, big.mark = ","), " invalid coordinates and ",
              format(removed_dupes, big.mark = ","), " duplicates")

  list(raw = raw, occ = occ, source_counts = source_counts,
       removed_bad_coordinates = removed_bad, removed_duplicates = removed_dupes,
       original_rows = original_n,
       columns = list(longitude = lon_col, latitude = lat_col, source = src_col, country = country_col))
}

make_training_extent <- function(occ, buffer = 2, latitude_limits = c(-60, 60)) {
  latitude_limits <- sort(as.numeric(latitude_limits))[1:2]
  xmin <- max(-180, floor(min(occ$longitude, na.rm = TRUE) - buffer))
  xmax <- min(180, ceiling(max(occ$longitude, na.rm = TRUE) + buffer))
  ymin <- max(latitude_limits[1], floor(min(occ$latitude, na.rm = TRUE) - buffer))
  ymax <- min(latitude_limits[2], ceiling(max(occ$latitude, na.rm = TRUE) + buffer))
  if ((xmax - xmin) < 1) { xmin <- max(-180, xmin - 0.5); xmax <- min(180, xmax + 0.5) }
  if ((ymax - ymin) < 1) { ymin <- max(latitude_limits[1], ymin - 0.5); ymax <- min(latitude_limits[2], ymax + 0.5) }
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
