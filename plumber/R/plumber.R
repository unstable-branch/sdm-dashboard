#* SDM Platform - Plumber Computation API
#* @apiTitle SDM Computation API
#* @apiDescription R-based computation endpoints for the SDM Platform

library(jsonlite)

# Resolve project root: Docker uses /app, local uses parent of plumber/R/
app_dir <- if (dir.exists("/app/R")) "/app" else normalizePath(file.path(getwd(), ".."), winslash = "/")

# Source existing R modules
load_path <- file.path(app_dir, "R", "load.R")
if (!file.exists(load_path)) {
  stop("Could not find R/load.R at: ", load_path, call. = FALSE)
}
source(load_path)

# Source data endpoints
source(file.path(app_dir, "plumber", "R", "endpoints-data.R"))

# Source model endpoints
source(file.path(app_dir, "plumber", "R", "endpoints-model.R"))

#* Health check
#* @get /health
function() {
  list(
    status = "ok",
    r_version = R.version.string,
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
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
    extent_presets = sdm_extent_choices
  )
}

#* List available models
#* @get /api/v1/models
function() {
  ids <- sdm_model_ids()
  choices <- sdm_model_choices()
  lapply(ids, function(id) {
    list(id = id, label = choices[id])
  })
}
