# Source all SDM modules in dependency order.

sdm_module_dir <- if (exists(".__sdm_module_dir", inherits = TRUE)) {
  get(".__sdm_module_dir", inherits = TRUE)
} else {
  file.path(getwd(), "R")
}

source_sdm_module <- function(filename) {
  source(file.path(sdm_module_dir, filename), local = FALSE)
}

source_sdm_module("bootstrap.R")
source_sdm_module("config.R")
source_sdm_module("packages.R")
source_sdm_module("logging.R")
source_sdm_module("validation.R")
source_sdm_module("occurrences.R")
source_sdm_module("covariates_climate.R")
source_sdm_module("covariates_elevation.R")
source_sdm_module("covariates_soil.R")
source_sdm_module("covariates_stack.R")
source_sdm_module("model_glm.R")
source_sdm_module("model_gam.R")
source_sdm_module("model_rangebag.R")
source_sdm_module("model_ensemble.R")
source_sdm_module("model_registry.R")
source_sdm_module("prediction.R")
source_sdm_module("future_projection.R")
source_sdm_module("plots.R")
source_sdm_module("report.R")
source_sdm_module("run_sdm.R")
source_sdm_module("app_helpers.R")

rm(source_sdm_module)
