# Source all SDM modules in deterministic dependency order.

sdm_module_dir <- if (exists(".__sdm_module_dir", inherits = TRUE)) {
  get(".__sdm_module_dir", inherits = TRUE)
} else {
  file.path(getwd(), "R")
}

source_sdm_module <- function(filename, required = TRUE) {
  path <- file.path(sdm_module_dir, filename)
  if (!file.exists(path)) {
    if (isTRUE(required)) {
      stop("Missing SDM module: ", filename, call. = FALSE)
    }
    return(invisible(FALSE))
  }
  source(path, local = FALSE)
  invisible(TRUE)
}

sdm_modules <- c(
  "bootstrap.R",
  "config.R",
  "packages.R",
  "logging.R",
  "validation.R",
  "metrics_binary.R",
  "metrics_helper.R",
  "cv_folds.R",
  "occurrences.R",
  "covariates_climate.R",
  "covariates_elevation.R",
  "covariates_soil.R",
  "covariates_stack.R",
  "predictor_selection.R",
  "boundary.R",
  "model_glm.R",
  "model_gam.R",
  "model_rangebag.R",
  "model_ensemble.R",
  "model_maxnet.R",
  "biomod2_compat.R",
  "model_biomod2.R",
  "model_dnn.R",
  "torch_setup.R",
  "model_registry.R",
  "prediction.R",
  "future_projection.R",
  "extrapolation.R",
  "plots.R",
  "report.R",
  "report_odmap.R",
  "run_sdm.R",
  "app_helpers.R"
)

for (module in sdm_modules) source_sdm_module(module)

rm(source_sdm_module, sdm_modules, sdm_module_dir)
