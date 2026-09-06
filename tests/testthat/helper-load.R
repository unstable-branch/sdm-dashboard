# Look for project root by checking for app.R in parent directories
find_sdm_root <- function() {
  candidates <- c(
    ".",
    "..",
    file.path("..", ".."),
    file.path("..", "..", ".."),
    file.path("..", "..", "..", "..")
  )
  for (c in candidates) {
    candidate <- normalizePath(c, winslash = "/", mustWork = FALSE)
    if (file.exists(file.path(candidate, "app.R"))) {
      return(candidate)
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