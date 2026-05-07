find_project_root <- function(start = getwd()) {
  current <- normalizePath(start, winslash = "/", mustWork = TRUE)
  repeat {
    if (file.exists(file.path(current, "R", "bootstrap.R")) &&
        file.exists(file.path(current, "R", "optimized_sdm.R"))) {
      return(current)
    }
    parent <- dirname(current)
    if (identical(parent, current)) break
    current <- parent
  }
  stop("Could not locate project root from ", start, call. = FALSE)
}

project_root <- find_project_root()
sdm_test_path <- function(...) file.path(project_root, ...)
source(sdm_test_path("R", "bootstrap.R"))
sdm_set_project_root(project_root)
source(sdm_test_path("R", "optimized_sdm.R"))
