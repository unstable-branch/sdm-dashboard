# SDM Compute-only Module Loader
# Identical to load.R but excludes Shiny UI modules (not needed for background computation).

mod_dir <- file.path(sdm_project_root(), "R")

if (!dir.exists(mod_dir)) {
  stop("Module directory not found: ", mod_dir, call. = FALSE)
}

if (!exists("sdm_resolve_module", mode = "function")) {
  sdm_resolve_module <- function(m) {
    mod_dir <- file.path(sdm_project_root(), "R")
    subdirs <- c("core", "data", "covariates", "models", "ecology", "ui", "modules", "xai", "output")
    for (sub in subdirs) {
      p <- file.path(mod_dir, sub, m)
      if (file.exists(p)) return(p)
    }
    p <- file.path(mod_dir, m)
    if (file.exists(p)) return(p)
    NULL
  }
}

modules <- c(
  # --- core ---
  "bootstrap.R",
  "config.R",
  "packages.R",
  "logging.R",
  "model_payload_normalizer.R",
  "crypto.R",
  "validation.R",
  "app_helpers.R",
  "optimized_sdm.R",
  "sdm_config.R",
  "run_sdm.R",

  # --- data ---
  "occurrences.R",
  "occurrences_dwca.R",
  "occurrences_detection.R",
  "community_matrix.R",

  # --- covariates ---
  "covariates_climate.R",
  "covariates_elevation.R",
  "covariates_soil.R",
  "covariates_stack.R",
  "predictor_selection.R",
  "boundary.R",
  "ne_boundary.R",
  "download_helper.R",
  "verify_cache.R",
  "future_projection.R",
  "extrapolation.R",
  # extras
  "covariates_ndvi.R",
  "covariates_uv.R",
  "covariates_vegetation.R",
  "covariates_drought.R",
  "covariates_human_footprint.R",
  "covariates_lulc.R",
  "covariates_bioclim_seasonality.R",
  "covariates_climate_future.R",

  # --- models ---
  "model_helpers.R",
  "inla_mesh.R",
  "model_inla.R",
  "model_bart.R",
  "model_unmarked.R",
  "model_brms.R",
  "model_python.R",
  "model_gbm.R",
  "model_rpart.R",
  "model_earth.R",
  "model_mda.R",
  "model_nnet.R",
  "model_bioclim.R",
  "model_glm.R",
  "model_gam.R",
  "model_rangebag.R",
  "model_ensemble.R",
  "model_maxnet.R",
  "model_rf.R",
  "model_xgboost.R",
  "model_multi_ensemble.R",
  "model_esm.R",
  "model_dnn.R",
  "model_dnn_multispecies.R",
  "model_registry.R",
  "model_biomod2.R",
  "biomod2_compat.R",
  "torch_setup.R",
  "cv_folds.R",
  "cv_engine.R",
  "blockcv.R",
  "importance.R",
  "calibration.R",
  "ensemble_importance.R",
  "hyperparameter_tuning.R",
  "prediction.R",

  # --- output ---
  "compare.R",

  # --- ecology ---
  "climate_matching.R",
  "eoo_aoo.R",
  "aoa.R",
  "niche_overlap.R",
  "species_richness.R",
  "dispersal.R",
  "climex.R",

  # --- output ---
  "metrics_binary.R",
  "metrics_helper.R",
  "response_curves.R",

  # --- xai ---
  "ale.R",
  "shap.R",
  "climate_driver.R",
  "xai_methods.R",
  "plots.R",
  "report.R",
  "report_odmap.R",
  "manifest.R",
  "diagnostics_plots.R",
  "batch_runner.R",
  "python_setup.R",
  "script_export.R",
  "tile_generator.R"
)

sdm_heartbeat_file <- Sys.getenv("SDM_HEARTBEAT_FILE", NA_character_)
for (i in seq_along(modules)) {
  m <- modules[i]
  if (m %in% c("bootstrap.R", "optimized_sdm.R") && exists("sdm_project_root", mode = "function")) next
  p <- sdm_resolve_module(m)
  if (!is.null(p)) {
    tryCatch(source(p, local = TRUE), error = function(e) {
      stop("Failed to source ", m, ": ", e$message, call. = FALSE)
    })
  } else {
    stop("Missing required module: ", m, call. = FALSE)
  }
  if (!is.na(sdm_heartbeat_file) && i %% 10L == 0L) {
    cat(format(Sys.time(), "%Y-%m-%dT%H:%M:%S"), "|loading_modules:", i, "\n",
      sep = "", file = sdm_heartbeat_file, append = FALSE)
  }
}
