# Darwin Core Archive (DwC-A) reader for SDM Dashboard
# Parses GBIF bulk download .zip files and extracts occurrence data

log_msg_dwca <- function(log_fun, ...) {
  msg <- paste0(...)
  if (!is.null(log_fun)) log_fun(msg) else message(msg)
}

#' Read occurrence data from a Darwin Core Archive (.zip file)
#'
#' Extracts the core occurrence data, selects SDM-relevant columns, and
#' captures dataset DOI from EML metadata for ODMAP provenance.
#'
#' @param dwca_path   character — path to .zip DwC-A file (or extracted dir)
#' @param species_filter character — optional; keep only records matching
#'                       this species name (scientificName or species term)
#' @param max_coord_uncertainty_m numeric — drop records with coordinate
#'                       uncertainty above this threshold (default: Inf)
#' @param basis_of_record_filter character vector — basisOfRecord values to
#'                       include (default: all)
#' @param log_fun     optional progress logger
#'
#' @return list(
#'   occurrences  = data.frame with columns x, y, species, date, ...,
#'   doi         = character; GBIF dataset DOI or NA,
#'   n_raw       = integer; total records before any filtering,
#'   n_returned  = integer; records after optional filters,
#'   datasets    = character vector; contributing dataset keys,
#'   issues_flagged = data.frame; records with GBIF quality issue flags
#' )

read_dwca <- function(dwca_path,
                      species_filter            = NULL,
                      max_coord_uncertainty_m   = Inf,
                      basis_of_record_filter    = NULL,
                      log_fun                   = NULL) {

  configure_user_library()
  if (!requireNamespace("finch", quietly = TRUE)) {
    msg <- paste0(
      "Package 'finch' is required for Darwin Core Archive input.\n",
      "Library paths: ", paste(.libPaths(), collapse = " | "), "\n",
      "finch installed at: ", find.package("finch", quiet = TRUE, verbose = FALSE)[1]
    )
    stop(msg, "\nInstall with: install.packages('finch')")
  }

  if (!file.exists(dwca_path)) stop("DwC-A file not found: ", dwca_path)
  if (!grepl("\\.zip$", dwca_path, ignore.case = TRUE)) {
    stop("Expected a .zip file. Got: ", basename(dwca_path))
  }

  log_msg_dwca(log_fun, "Reading Darwin Core Archive: ", basename(dwca_path))

  archive <- finch::dwca_read(dwca_path, read = TRUE)

  doi <- tryCatch({
    eml <- archive$emlmeta
    pkg_id <- eml$dataset$alternateIdentifier
    doi_match <- grep("^10\\.", pkg_id, value = TRUE)
    if (length(doi_match) > 0) doi_match[1] else NA_character_
  }, error = function(e) NA_character_)

  if (!is.na(doi)) {
    log_msg_dwca(log_fun, "GBIF dataset DOI: ", doi)
  } else {
    log_msg_dwca(log_fun, "No DOI found in archive metadata")
  }

  occ_key <- grep("occurrence", names(archive$data), ignore.case = TRUE,
                  value = TRUE)[1]
  if (is.na(occ_key)) {
    stop("No occurrence core found in DwC-A. ",
         "Files found: ", paste(names(archive$data), collapse = ", "))
  }

  occ_raw <- archive$data[[occ_key]]
  n_raw   <- nrow(occ_raw)
  log_msg_dwca(log_fun, "Raw records in archive: ", n_raw)

  names(occ_raw) <- sub("^[a-z]+:", "", names(occ_raw))
  names(occ_raw) <- tolower(names(occ_raw))
  names(occ_raw) <- sub(".*/", "", names(occ_raw))

  dwc_col_map <- c(
    x                   = "decimallongitude",
    y                   = "decimallatitude",
    species             = "species",
    scientific_name     = "scientificname",
    date                = "eventdate",
    coord_uncertainty_m  = "coordinateuncertaintyinmeters",
    basis_of_record     = "basisofrecord",
    country_code        = "countrycode",
    occurrence_id       = "occurrenceid",
    gbif_id             = "gbifid",
    dataset_key         = "datasetkey",
    issue_flags         = "issue",
    taxon_rank          = "taxonrank",
    institution_code    = "institutioncode",
    collection_code     = "collectioncode"
  )

  present_cols <- dwc_col_map[dwc_col_map %in% names(occ_raw)]
  occ <- occ_raw[, present_cols, drop = FALSE]
  names(occ) <- names(present_cols)

  occ$x <- suppressWarnings(as.numeric(occ$x))
  occ$y <- suppressWarnings(as.numeric(occ$y))
  if ("coord_uncertainty_m" %in% names(occ)) {
    occ$coord_uncertainty_m <- suppressWarnings(
      as.numeric(occ$coord_uncertainty_m)
    )
  }

  if (!is.null(species_filter) && nchar(species_filter) > 0) {
    sp_col <- if ("species" %in% names(occ)) "species" else "scientific_name"
    if (sp_col %in% names(occ)) {
      before <- nrow(occ)
      occ <- occ[grepl(species_filter, occ[[sp_col]], ignore.case = TRUE), ]
      log_msg_dwca(log_fun, "Species filter '", species_filter, "': ",
              before, " -> ", nrow(occ), " records")
    } else {
      warning("No species/scientificName column found; skipping species filter")
    }
  }

  if (is.finite(max_coord_uncertainty_m) && "coord_uncertainty_m" %in% names(occ)) {
    before <- nrow(occ)
    occ <- occ[is.na(occ$coord_uncertainty_m) |
                 occ$coord_uncertainty_m <= max_coord_uncertainty_m, ]
    dropped <- before - nrow(occ)
    if (dropped > 0) {
      log_msg_dwca(log_fun, "Coord uncertainty filter (>", max_coord_uncertainty_m,
              "m): dropped ", dropped, " records")
    }
  }

  if (!is.null(basis_of_record_filter) && "basis_of_record" %in% names(occ)) {
    before <- nrow(occ)
    occ <- occ[occ$basis_of_record %in% basis_of_record_filter, ]
    log_msg_dwca(log_fun, "basisOfRecord filter: ",
            before, " -> ", nrow(occ), " records")
  }

  issues_flagged <- NULL
  if ("issue_flags" %in% names(occ)) {
    flagged_idx <- !is.na(occ$issue_flags) & nchar(occ$issue_flags) > 0
    if (any(flagged_idx)) {
      issues_flagged <- occ[flagged_idx, c("x", "y", "species",
                                            "issue_flags"), drop = FALSE]
      log_msg_dwca(log_fun, nrow(issues_flagged), " records have GBIF quality flags")
    }
  }

  datasets <- character(0)
  if ("dataset_key" %in% names(occ)) {
    datasets <- unique(na.omit(occ$dataset_key))
  }

  log_msg_dwca(log_fun, "DwC-A read complete: ", nrow(occ),
          " records ready for cleaning")

  list(
    occurrences    = occ,
    doi            = doi,
    n_raw          = n_raw,
    n_returned     = nrow(occ),
    datasets       = datasets,
    issues_flagged = issues_flagged
  )
}