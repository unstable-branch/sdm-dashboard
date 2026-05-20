#* SDM Platform - Plumber Computation API
#* @apiTitle SDM Computation API
#* @apiDescription R-based computation endpoints for the SDM Platform

library(jsonlite)

# Source existing R modules
source("/app/R/load.R")

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
