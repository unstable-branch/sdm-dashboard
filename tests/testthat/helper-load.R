# Resolve the project root from the test path, the current working directory,
# or Rscript's --file path. testthat and CI may change the working directory
# before sourcing helpers, while direct Rscript execution has no testthat path.
find_sdm_root <- function() {
  starts <- c(getwd())
  if (requireNamespace("testthat", quietly = TRUE)) {
    test_path <- tryCatch(testthat::test_path(), error = function(e) NULL)
    if (!is.null(test_path)) starts <- c(starts, test_path)
  }
  script_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (length(script_arg) > 0L) starts <- c(starts, sub("^--file=", "", script_arg[1]))
  source_files <- vapply(sys.frames(), function(frame) {
    if (!is.null(frame$ofile)) frame$ofile else NA_character_
  }, character(1))
  source_files <- source_files[!is.na(source_files)]
  starts <- c(starts, source_files)

  for (start in unique(starts)) {
    candidate <- normalizePath(start, winslash = "/", mustWork = FALSE)
    if (!dir.exists(candidate)) candidate <- dirname(candidate)
    repeat {
      if (file.exists(file.path(candidate, "app.R")) &&
          file.exists(file.path(candidate, "R", "core", "bootstrap.R"))) {
        return(candidate)
      }
      parent <- dirname(candidate)
      if (identical(parent, candidate)) break
      candidate <- parent
    }
  }
  stop("Could not find SDM project root", call. = FALSE)
}
project_root <- find_sdm_root()
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "core", "optimized_sdm.R"))

# Climate-layer matchers (shared module used by find_worldclim_files and the
# modern Plumber helpers). Loaded here so tests can source covariates_climate.R
# and have the matchers available in the calling environment.
source(file.path(project_root, "R", "covariates", "match_climate_layers.R"), local = FALSE)
# Cache manifest helpers (sha256-verified invalidation used by handle_climate_check).
source(file.path(project_root, "R", "covariates", "climate_cache_manifest.R"), local = FALSE)