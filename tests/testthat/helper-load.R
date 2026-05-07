<<<<<<< HEAD
project_root <- normalizePath(file.path(dirname(dirname(getwd())), "SDM"), winslash = "/", mustWork = FALSE)
if (!file.exists(file.path(project_root, "R", "optimized_sdm.R"))) {
  project_root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
}
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path("R", "optimized_sdm.R"))
=======
# Find project root by looking for key files
find_project_root <- function(start_dir = getwd()) {
  candidates <- c(
    file.path(start_dir, ".."),
    file.path(start_dir, "..", ".."),
    start_dir
  )
  for (cand in candidates) {
    if (file.exists(file.path(cand, "R", "bootstrap.R")) || 
        file.exists(file.path(cand, "R", "optimized_sdm.R")) ||
        file.exists(file.path(cand, "app.R"))) {
      return(normalizePath(cand, winslash = "/"))
    }
  }
  stop("Cannot find project root")
}

project_root <- find_project_root(getwd())
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "optimized_sdm.R"))
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
