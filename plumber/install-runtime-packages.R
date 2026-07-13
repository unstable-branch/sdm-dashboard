#!/usr/bin/env Rscript

# Install the Plumber runtime package surface from a dated Posit Package
# Manager snapshot. PPM selects Linux binaries from the R user agent; R 4.6's
# default user agent omits the leading R/<version> token, so add it explicitly.
repo <- Sys.getenv("R_CRAN_REPO", unset = NA_character_)
if (is.na(repo) || !nzchar(repo)) {
  stop("R_CRAN_REPO must name a dated package repository snapshot.", call. = FALSE)
}

options(
  timeout = 900,
  repos = c(CRAN = repo),
  HTTPUserAgent = paste0("R/", getRversion(), " ", getOption("HTTPUserAgent")),
  Ncpus = max(1L, parallel::detectCores() - 1L)
)

runtime_packages <- c(
  "arrow", "reticulate", "jsonlite", "plumber", "httr", "callr",
  "bslib", "curl", "DT", "geodata", "leaflet", "sf", "shiny",
  "shinyjs", "terra", "data.table", "glmnet", "caret", "randomForest",
  "gbm", "maxnet", "nnet", "mgcv", "earth", "rpart", "mda", "gam",
  "xgboost", "ranger", "PresenceAbsence", "pROC", "ecospat",
  "marginaleffects", "plotrix", "ggplot2", "CAST", "blockCV",
  "CoordinateCleaner", "rgbif", "finch", "future", "future.apply", "DBI",
  "RPostgres", "digest", "Rook", "openssl", "pool", "uuid", "targets",
  "tarchetypes", "geotargets"
)

missing_before <- setdiff(runtime_packages, rownames(installed.packages()))
if (length(missing_before)) {
  install.packages(missing_before)
}

installed <- installed.packages()
missing_after <- setdiff(runtime_packages, rownames(installed))
if (length(missing_after)) {
  stop(
    "Runtime package installation incomplete; missing: ",
    paste(missing_after, collapse = ", "),
    call. = FALSE
  )
}

manifest <- installed[, c("Package", "Version", "Built"), drop = FALSE]
dir.create("/opt/sdm", recursive = TRUE, showWarnings = FALSE)
write.table(
  manifest[order(manifest[, "Package"]), , drop = FALSE],
  file = "/opt/sdm/r-runtime-packages.tsv",
  sep = "\t",
  row.names = FALSE,
  quote = FALSE
)
cat(sprintf("Verified %d direct runtime packages from %s\n", length(runtime_packages), repo))
