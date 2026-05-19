# SDM Module Loader - sources all modules in dependency order

mod_dir <- file.path(sdm_project_root(), "R")

if (!dir.exists(mod_dir)) {
  stop("Module directory not found: ", mod_dir, call. = FALSE)
}

modules <- c(
  "bootstrap.R",
  "config.R",
  "packages.R",
  "logging.R",
  "validation.R",
  "occurrences.R",
  "covariates_climate.R",
  "covariates_elevation.R",
  "covariates_soil.R",
  "covariates_stack.R",
  "predictor_selection.R",
  "metrics_binary.R",
  "cv_folds.R",
  "cv_engine.R",
  "importance.R",
  "boundary.R",
  "model_helpers.R",
  "model_glm.R",
  "model_gam.R",
  "model_rangebag.R",
  "model_ensemble.R",
  "model_maxnet.R",
  "model_rf.R",
  "model_multi_ensemble.R",
  "model_esm.R",
  "model_registry.R",
  "prediction.R",
  "future_projection.R",
  "extrapolation.R",
  "plots.R",
  "sdm_config.R",
  "report.R",
  "report_odmap.R",
  "run_sdm.R",
  "app_helpers.R",
  # --- extras (formerly auto-sourced) in dependency order ---
  "torch_setup.R",
  "manifest.R",
  "metrics_helper.R",
  "covariates_ndvi.R",
  "covariates_uv.R",
  "covariates_vegetation.R",
  "covariates_drought.R",
  "covariates_human_footprint.R",
  "covariates_lulc.R",
  "covariates_bioclim_seasonality.R",
  "covariates_climate_future.R",
  "response_curves.R",
  "download_helper.R",
  "occurrences_dwca.R",
  "biomod2_compat.R",
  "model_biomod2.R",
  "model_dnn.R",
  "verify_cache.R",
  "batch_runner.R",
  "script_export.R",
  "mod_get_data.R",
  "mod_model_run.R",
  "mod_results.R",
  "mod_readiness.R",
  "ui_header.R",
  "ui_sidebar_controls.R",
  "ui_main_tabs.R"
)

for (m in modules) {
  p <- file.path(mod_dir, m)
  if (file.exists(p)) {
    tryCatch(source(p, local = TRUE), error = function(e) {
      stop("Failed to source ", m, ": ", e$message, call. = FALSE)
    })
  } else {
    stop("Missing required module: ", m, call. = FALSE)
  }
}
