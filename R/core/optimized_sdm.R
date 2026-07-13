# Compatibility loader for the refactored SDM engine.
# Delegates project-root detection to bootstrap.R.

find_bootstrap <- function() {
  if (exists(".__sdm_project_root", envir = .GlobalEnv, inherits = FALSE)) {
    root <- get(".__sdm_project_root", envir = .GlobalEnv, inherits = FALSE)
    bp <- file.path(root, "R", "core", "bootstrap.R")
    if (file.exists(bp)) return(bp)
  }

  start <- getwd()
  repeat {
    bp <- file.path(start, "R", "core", "bootstrap.R")
    if (file.exists(bp)) return(bp)
    bp <- file.path(start, "R", "bootstrap.R")
    if (file.exists(bp)) return(bp)
    bp <- file.path(start, "bootstrap.R")
    if (file.exists(bp)) return(bp)
    parent <- dirname(start)
    if (identical(parent, start)) break
    start <- parent
  }

  script <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(script) > 0) {
    script_dir <- dirname(sub("^--file=", "", script[1]))
    start <- script_dir
    repeat {
      bp <- file.path(start, "R", "core", "bootstrap.R")
      if (file.exists(bp)) return(bp)
      bp <- file.path(start, "R", "bootstrap.R")
      if (file.exists(bp)) return(bp)
      bp <- file.path(start, "bootstrap.R")
      if (file.exists(bp)) return(bp)
      parent <- dirname(start)
      if (identical(parent, start)) break
      start <- parent
    }
  }

  stop("Could not find R/core/bootstrap.R. Current working directory: ", getwd(), call. = FALSE)
}

source(find_bootstrap(), local = FALSE)

if (!exists(".__sdm_project_root", envir = .GlobalEnv, inherits = FALSE)) {
  sdm_set_project_root(NULL)
}
source(file.path(sdm_project_root(), "R", "load.R"), local = FALSE)
