project_root <- normalizePath(file.path(dirname(dirname(getwd())), "SDM"), winslash = "/", mustWork = FALSE)
if (!file.exists(file.path(project_root, "R", "optimized_sdm.R"))) {
  project_root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
}
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path("R", "optimized_sdm.R"))
