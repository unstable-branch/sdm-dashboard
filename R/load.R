# SDM Module Loader - sources all modules in dependency order

mod_dir <- file.path(getwd(), "R")

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
  "boundary.R",
  "model_glm.R",
  "model_gam.R",
  "model_rangebag.R",
  "model_ensemble.R",
  "model_maxnet.R",
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

for (m in modules) {
  p <- file.path(mod_dir, m)
  if (file.exists(p)) {
    tryCatch(source(p, local = FALSE), error = function(e) {
      warning("Failed to source ", m, ": ", e$message, call. = FALSE)
    })
  }
}

extra <- setdiff(list.files(mod_dir, pattern = "\\.R$"), c(modules, "load.R", "optimized_sdm.R"))
if (length(extra) > 0) {
  warning("Auto-sourced modules: ", paste(sort(extra), collapse = ", "))
  for (m in sort(extra)) {
    p <- file.path(mod_dir, m)
    tryCatch(source(p, local = FALSE), error = function(e) {
      warning("Failed to source ", m, ": ", e$message, call. = FALSE)
    })
  }
}