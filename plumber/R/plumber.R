#* SDM Platform - Plumber Computation API
#* @apiTitle SDM Computation API
#* @apiDescription R-based computation endpoints for the SDM Platform

library(jsonlite)

# Resolve project root: Docker uses SDM_PROJECT_ROOT (default /app), local uses tree-walk
SDM_PROJECT_ROOT <- Sys.getenv("SDM_PROJECT_ROOT", "/app")
app_dir <- if (dir.exists(file.path(SDM_PROJECT_ROOT, "R"))) {
  SDM_PROJECT_ROOT
} else {
  d <- getwd()
  for (i in 1:10) {
    if (file.exists(file.path(d, "R", "core", "bootstrap.R"))) {
      break
    }
    d <- dirname(d)
  }
  normalizePath(d, winslash = "/")
}

# Guard against double-loading when run_server.R sources plumber.R twice
if (is.null(.GlobalEnv$.sdm_plumber_initialized)) {
  source(file.path(app_dir, "R", "core", "bootstrap.R"))
  sdm_set_project_root(app_dir)

  load_path <- file.path(app_dir, "R", "engine_load.R")
    if (!file.exists(load_path)) {
      load_path <- file.path(app_dir, "R", "load.R")
    }
    if (!file.exists(load_path)) {
      stop("Could not find R/load.R at: ", load_path, call. = FALSE)
  }
  source(load_path)

  source(file.path(app_dir, "plumber", "R", "helpers", "plumber_helpers.R"))
  source(file.path(app_dir, "plumber", "R", "helpers", "vsize.R"))

  # Source all domain helper files
  helper_files <- c(
    "occurrences_helpers.R", "models_helpers.R", "diagnostics_helpers.R",
    "ecology_helpers.R", "climate_helpers.R", "config_helpers.R",
    "output_helpers.R", "covariates_helpers.R", "boundary_helpers.R",
    "health_helpers.R", "jobs_helpers.R",
    "ensemble_helpers.R", "synthetic_helpers.R"
  )
  for (hf in helper_files) {
    hf_path <- file.path(app_dir, "plumber", "R", "helpers", hf)
    if (file.exists(hf_path)) source(hf_path)
  }

  .GlobalEnv$.sdm_plumber_initialized <- TRUE
}

SDM_MAX_CONCURRENT_RUNS <- as.integer(Sys.getenv("SDM_MAX_CONCURRENT_RUNS", "2"))
SDM_MAX_GPU_CONCURRENT_RUNS <- as.integer(Sys.getenv("SDM_MAX_GPU_CONCURRENT_RUNS", "1"))

#* Upload occurrence file (CSV/TSV/ZIP)
#* @param file The occurrence file to upload
#* @post /api/v1/occurrences/upload
function(req) handle_occurrences_upload(req, app_dir)

#* List uploaded files (persisted across sessions)
#* @get /api/v1/occurrences/uploads
function(req, limit = 50) handle_occurrences_uploads(req, app_dir, limit)

#* Clean occurrence data with configurable options
#* @param file_id The uploaded file path or ID
#* @param min_source_records Minimum records per source to keep (default: 15)
#* @param merge_small_sources Merge small sources (default: true)
#* @param use_cc Run CoordinateCleaner (default: false)
#* @param cc_tests CC tests to run: all, sea, capitals, centroids, institutions, urban, zero (default: all)
#* @param max_coordinate_uncertainty Max coordinate uncertainty in meters (default: no filter)
#* @param max_records Maximum records to process (default: 200000)
#* @post /api/v1/occurrences/clean
function(req, file_id, min_source_records = 15, merge_small_sources = TRUE, use_cc = FALSE, cc_tests = "all", max_coordinate_uncertainty = NULL, max_records = 200000L)
  handle_occurrences_clean(req, app_dir, file_id, min_source_records, merge_small_sources, use_cc, cc_tests, max_coordinate_uncertainty, max_records)

#* Search GBIF for occurrence records
#* @param taxon Species name (e.g., "Acacia mearnsii")
#* @param country Country code filter (e.g., "AU")
#* @param max_records Maximum records to fetch (default: 100)
#* @param use_auth If true, use authenticated download (unlimited records)
#* @param gbif_user GBIF username for authenticated download (DEPRECATED: use X-Gbif-User header)
#* @param gbif_pwd GBIF password for authenticated download (DEPRECATED: use X-Gbif-Pwd header)
#* @param gbif_email GBIF email for authenticated download (DEPRECATED: use X-Gbif-Email header)
#* @post /api/v1/occurrences/gbif/search
#* @security GBIF credentials should be passed via X-Gbif-User, X-Gbif-Pwd, X-Gbif-Email headers to avoid exposure in request logs
function(req, taxon, country = NULL, max_records = 100, use_auth = NULL, gbif_user = NULL, gbif_pwd = NULL, gbif_email = NULL)
  handle_occurrences_gbif_search(req, app_dir, taxon, country, max_records, use_auth, gbif_user, gbif_pwd, gbif_email)

#* Search ALA for occurrence records
#* @param taxon Species name (e.g., "Acacia mearnsii")
#* @param country Country filter (e.g., "Australia")
#* @param max_records Maximum records to fetch (default: 100)
#* @param api_key ALA API key for authenticated access (optional)
#* @post /api/v1/occurrences/ala/search
function(req, taxon, country = NULL, max_records = 100, api_key = NULL)
  handle_occurrences_ala_search(req, app_dir, taxon, country, max_records, api_key)

#* Parse a Darwin Core Archive (.zip) file
#* @param file_id Path to the uploaded .zip file
#* @param species_filter Optional species name filter
#* @param max_coord_uncertainty_m Max coordinate uncertainty in meters
#* @param basis_of_record_filter Basis of record values to include (comma-separated)
#* @post /api/v1/occurrences/dwca
function(req, file_id, species_filter = NULL, max_coord_uncertainty_m = NULL, basis_of_record_filter = NULL)
  handle_occurrences_dwca(req, app_dir, file_id, species_filter, max_coord_uncertainty_m, basis_of_record_filter)

#* Run a single-species SDM model in the background
#* @param species Species name
#* @param model_id Model identifier (e.g., "glm", "maxnet", "rf")
#* @post /api/v1/models/run
function(req) handle_model_run(req, app_dir)

#* Run a multi-species batch via targets pipeline
#* @post /api/v1/models/targets-run
function(req) handle_targets_run(req, app_dir)

#* Get targets pipeline status
#* @get /api/v1/models/targets-status/<job_id>
function(res, job_id) handle_targets_status(res, job_id)

#* Get targets pipeline results
#* @get /api/v1/models/targets-results/<job_id>
function(res, job_id) handle_targets_results(res, job_id)

#* Get job logs (stderr, stdout, progress)
#* @get /api/v1/models/logs/<job_id>
function(res, job_id) handle_model_logs(res, job_id)

#* Get model run status
#* @get /api/v1/models/status/<job_id>
function(res, job_id) handle_model_status(res, job_id)

#* Cancel a running model run
#* @post /api/v1/models/cancel/<job_id>
function(req, job_id) handle_model_cancel(req, job_id)

#* Delete model run output files
#* @post /api/v1/models/delete/<job_id>
function(req, job_id) handle_model_delete(req, job_id)

#* List model runs (optionally filtered by user)
#* @get /api/v1/models/runs
function(req) handle_models_runs(req, app_dir)

#* Get async job status (data/ecology jobs, not model runs)
#* @get /api/v1/jobs/status/<job_id>
function(req, res, job_id) handle_job_status(req, res, job_id, app_dir)

#* Cancel an async data job
#* @post /api/v1/jobs/cancel/<job_id>
function(req, job_id) handle_job_cancel(req, job_id, app_dir)

#* Health check
#* @get /health
function(res) handle_health(res, app_dir)

#* GPU status
#* @get /api/v1/gpu/status
function(res) handle_gpu_status(res)

#* Readiness probe
#* @get /ready
function(res) handle_ready(res)

#* List available future climate scenarios
#* @get /api/v1/future/scenarios
function(res) handle_future_scenarios(res, app_dir)

#* Download climate data for a scenario
#* @post /api/v1/climate/download
function(req) handle_climate_download(req, app_dir)

#* Get climate download job status
#* @get /api/v1/climate/status/<job_id>
function(res, job_id) handle_climate_status(res, job_id, app_dir)

#* List downloaded climate scenarios
#* @get /api/v1/climate/scenarios
function(res) handle_climate_scenarios(res, app_dir)

#* Delete a climate scenario
#* @post /api/v1/climate/delete/<scenario_id>
function(res, scenario_id) handle_climate_delete(res, scenario_id, app_dir)

#* Cancel a climate download
#* @post /api/v1/climate/cancel/<job_id>
function(req, job_id) handle_climate_cancel(req, job_id, app_dir)

#* Get ecology data for a run
#* @get /api/v1/ecology/<run_id>
function(res, run_id) handle_ecology_run(res, run_id, app_dir)

#* Get EOO/AOO data for a run
#* @get /api/v1/ecology/<run_id>/eoo-aoo
function(res, run_id) handle_ecology_eoo_aoo(res, run_id, app_dir)

#* Get Area of Applicability data
#* @get /api/v1/ecology/<run_id>/aoa
function(res, run_id) handle_ecology_aoa(res, run_id, app_dir)

#* Get conservation status report
#* @get /api/v1/ecology/<run_id>/report
function(res, run_id) handle_ecology_report(res, run_id, app_dir)

#* Compute niche overlap between two runs
#* @post /api/v1/ecology/niche-overlap
function(req) handle_ecology_niche_overlap(req, app_dir)

#* Get model config defaults
#* @get /api/v1/config/defaults
function(res) handle_config_defaults(res, app_dir)

#* List available model backends
#* @get /api/v1/models
function(res) handle_models_list(res, app_dir)

#* Compare two completed model runs
#* @get /api/v1/output/compare/<run_id1>/<run_id2>
function(res, run_id1, run_id2) handle_output_compare(res, run_id1, run_id2, app_dir)

#* Export reproducible R script for a run
#* @get /api/v1/output/script/<run_id>
function(res, run_id) handle_output_script(res, run_id, app_dir)

#* Generate JSON manifest for a run
#* @get /api/v1/output/manifest/<run_id>
function(res, run_id) handle_output_manifest(res, run_id, app_dir)

#* Get VIF screening results
#* @get /api/v1/diagnostics/vif/<run_id>
function(res, run_id) handle_diagnostics_vif(res, run_id)

#* Get response curves data
#* @get /api/v1/diagnostics/response-curves/<run_id>
function(res, run_id) handle_diagnostics_response_curves(res, run_id)

#* Get Accumulated Local Effects (ALE) data
#* @get /api/v1/diagnostics/ale/<run_id>
function(res, run_id) handle_diagnostics_ale(res, run_id)

#* Get variable importance data
#* @get /api/v1/diagnostics/importance/<run_id>
function(res, run_id) handle_diagnostics_importance(res, run_id)

#* Compute per-cell SHAP explanation
#* @post /api/v1/diagnostics/shap/cell
function(res, run_id = "", longitude = NULL, latitude = NULL) handle_diagnostics_shap_cell(res, run_id, longitude, latitude)

#* Get climate driver attribution
#* @get /api/v1/diagnostics/climate-drivers/<run_id>
function(res, run_id) handle_diagnostics_climate_drivers(res, run_id)

#* Get Continuous Boyce Index (CBI) data
#* @get /api/v1/diagnostics/cbi/<run_id>
function(res, run_id) handle_diagnostics_cbi(res, run_id)

#* Get MESS extrapolation summary
#* @get /api/v1/diagnostics/mess/<run_id>
function(res, run_id) handle_diagnostics_mess(res, run_id)

#* Get combined diagnostics summary
#* @get /api/v1/diagnostics/summary/<run_id>
function(res, run_id) handle_diagnostics_summary(res, run_id)

#* Get ROC curve data
#* @get /api/v1/diagnostics/roc/<run_id>
function(res, run_id) handle_diagnostics_roc(res, run_id)

#* Get calibration curve data
#* @get /api/v1/diagnostics/calibration/<run_id>
function(res, run_id) handle_diagnostics_calibration(res, run_id)

#* Get per-fold CV metrics
#* @get /api/v1/diagnostics/cv-folds/<run_id>
function(res, run_id) handle_diagnostics_cv_folds(res, run_id)

#* Get threshold performance data
#* @get /api/v1/diagnostics/threshold/<run_id>
function(res, run_id) handle_diagnostics_threshold(res, run_id)

#* Get presence vs background density data
#* @get /api/v1/diagnostics/density/<run_id>
function(res, run_id) handle_diagnostics_density(res, run_id)

#* Generate diagnostic PNG plots
#* @post /api/v1/diagnostics/plots/<run_id>
function(res, run_id) handle_diagnostics_plots(res, run_id)

#* Download diagnostics data as CSV
#* @get /api/v1/diagnostics/data/<run_id>/<type>
function(res, run_id, type) handle_diagnostics_data(res, run_id, type)

#* Check BIO variable availability
#* @param source Climate data source (worldclim, chelsa)
#* @param resolution Raster resolution
#* @param biovars Comma-separated BIO variable numbers
#* @param gcm GCM name for future scenarios
#* @param ssp SSP scenario
#* @param period Time period
#* @get /api/v1/climate/check
function(res, source = "worldclim", resolution = "10", biovars = "", gcm = "", ssp = "", period = "")
  handle_climate_check(res, app_dir, source, resolution, biovars, gcm, ssp, period)

#* Check covariate availability
#* @get /api/v1/covariates/check
function(res) handle_covariates_check(res, app_dir)

#* Download a non-climate covariate
#* @parser json
#* @post /api/v1/covariates/download
function(req) handle_covariates_download(req, app_dir)

#* Download a non-climate covariate in background
#* @post /api/v1/covariates/download_bg
function(req) handle_covariates_download_bg(req, app_dir)

#* Serve XYZ tile from COG
#* @get /api/v1/results/tiles/cog/<run_id>/<z>/<x>/<y>
#* @serializer contentType list(type="image/png")
function(res, run_id, z, x, y) handle_tile_serve(res, run_id, z, x, y, app_dir)

#* Serve default boundary GeoJSON
#* @param resolution Boundary resolution
#* @param type Boundary type (admin0, admin1)
#* @param country Country name or code
#* @post /api/v1/data/boundary/default
function(res, resolution = NULL, type = NULL, country = NULL)
  handle_boundary_default(res, app_dir, resolution, type, country)

#* Upload a custom boundary file
#* @param file_name Name for the boundary file
#* @param file_content Base64-encoded file content
#* @post /api/v1/data/boundary/upload
function(req, res) handle_boundary_upload(req, res, app_dir)

#* List custom boundaries
#* @post /api/v1/data/boundary/list
function(res) handle_boundary_list(res, app_dir)

#* Delete a custom boundary
#* @param file_path Path to the boundary file to delete
#* @post /api/v1/data/boundary/delete
function(req, res) handle_boundary_delete(req, res, app_dir)

#* List country names
#* @post /api/v1/data/boundary/countries
function(res) handle_boundary_countries(res, app_dir)

#* Compute bounding box extent
#* @param file_path Path to boundary file
#* @param type Boundary type (admin0, admin1)
#* @param resolution Boundary resolution
#* @param country Country name
#* @param buffer_deg Buffer in degrees
#* @post /api/v1/data/boundary/extent
function(res, file_path = NULL, type = NULL, resolution = NULL, country = NULL, buffer_deg = 2)
  handle_boundary_extent(res, app_dir, file_path, type, resolution, country, buffer_deg)

#* Download Natural Earth boundary
#* @param type Boundary type (admin0, admin1)
#* @param resolution Boundary resolution (10m, 50m, 110m)
#* @param country Country name
#* @post /api/v1/data/boundary/download
function(res, type = "admin0", resolution = "110m", country = "all")
  handle_boundary_download(res, app_dir, type, resolution, country)

#* Generate ensemble summary rasters from component TIFFs
#* @post /api/v1/models/ensemble-rasters/<job_id>
function(res, job_id) handle_ensemble_rasters(res, job_id, app_dir)

#* Generate synthetic multi-species occurrence data for stress testing
#* @post /api/v1/occurrences/synthetic
function(req, res) handle_synthetic_occurrences(req, res, app_dir)
