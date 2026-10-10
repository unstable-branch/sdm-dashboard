#!/usr/bin/env Rscript

# Install the Plumber runtime package surface from a dated Posit Package
# Manager snapshot. PPM selects Linux binaries from the R user agent; R 4.6's
# default user agent omits the leading R/<version> token, so add it explicitly.
#
# Build-cache layering: the Dockerfiles run this script twice.
#   1. `Rscript install-runtime-packages.R` installs `runtime_packages` (the
#      large, rarely changed base layer).
#   2. `Rscript install-runtime-packages.R /tmp/runtime-packages-added.txt`
#      installs any packages listed in that file (one per line, `#` comments).
# Add NEW packages to `plumber/runtime-packages-added.txt`, not to the list
# below: that file is copied in a later layer, so a change reinstalls only the
# added packages instead of invalidating the whole base layer. Fold them into
# `runtime_packages` the next time the base layer is rebuilt for another reason.
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
  "crew", "crew.cluster", "crew.aws.batch",
  "CoordinateCleaner", "rgbif", "finch", "future", "future.apply", "DBI",
  "RPostgres", "redux", "digest", "Rook", "openssl", "pool", "uuid", "targets",
  "tarchetypes", "geotargets"
)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) > 1L) {
  stop("Usage: install-runtime-packages.R [added-packages-file]", call. = FALSE)
}
added_packages <- character()
if (length(args) == 1L) {
  lines <- trimws(sub("#.*$", "", readLines(args[[1]], warn = FALSE)))
  added_packages <- unique(lines[nzchar(lines)])
  bad <- added_packages[!grepl("^[A-Za-z][A-Za-z0-9.]*$", added_packages)]
  if (length(bad)) {
    stop("Invalid package names in ", args[[1]], ": ", paste(bad, collapse = ", "), call. = FALSE)
  }
}
required <- union(runtime_packages, added_packages)

missing_before <- setdiff(required, rownames(installed.packages()))
if (length(missing_before)) {
  install.packages(missing_before)
}

installed <- installed.packages()
missing_after <- setdiff(required, rownames(installed))
if (length(missing_after)) {
  stop(
    "Runtime package installation incomplete; missing: ",
    paste(missing_after, collapse = ", "),
    call. = FALSE
  )
}

# Installed is not the same as loadable: binary packages can miss a system
# library (V8 needs libnode, which DwC-A uploads reach via finch). Load-check
# the packages whose shared objects have bitten us before.
load_checked <- intersect(c("V8", "finch", "terra", "sf", "redux", "arrow"), rownames(installed))
for (pkg in load_checked) {
  ok <- tryCatch({ loadNamespace(pkg); TRUE }, error = function(e) {
    message("Cannot load ", pkg, ": ", conditionMessage(e)); FALSE
  })
  if (!ok) stop("Runtime package ", pkg, " is installed but cannot be loaded.", call. = FALSE)
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
cat(sprintf(
  "Verified %d direct runtime packages (%d added) from %s\n",
  length(required), length(added_packages), repo
))
