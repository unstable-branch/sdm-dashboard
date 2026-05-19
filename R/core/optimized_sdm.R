# Compatibility loader for the refactored SDM engine.
# Delegates project-root detection to bootstrap.R.

find_bootstrap <- function() {
  candidates <- c(
    file.path(getwd(), "R", "core", "bootstrap.R"),
    file.path(getwd(), "R", "bootstrap.R"),
    file.path(getwd(), "bootstrap.R")
  )
  script <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(script) > 0) {
    script_dir <- dirname(sub("^--file=", "", script[1]))
    candidates <- c(candidates, file.path(script_dir, "R", "core", "bootstrap.R"), file.path(script_dir, "R", "bootstrap.R"), file.path(script_dir, "bootstrap.R"))
  }
  existing <- candidates[file.exists(candidates)]
  if (length(existing) == 0) {
    stop("Could not find R/core/bootstrap.R. Current working directory: ", getwd(), call. = FALSE)
  }
  existing[1]
}

source(find_bootstrap(), local = FALSE)
sdm_set_project_root(NULL)
source(file.path(sdm_project_root(), "R", "load.R"), local = FALSE)
