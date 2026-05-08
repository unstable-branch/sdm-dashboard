# Project-root and path helpers shared by app, CLI, scripts, and setup.

sdm_normalize_path <- function(path, mustWork = FALSE) {
  normalizePath(path, winslash = "/", mustWork = mustWork)
}

sdm_script_path <- function() {
  file_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(file_arg) > 0) return(sdm_normalize_path(sub("^--file=", "", file_arg[1]), mustWork = TRUE))

  ofiles <- vapply(sys.frames(), function(frame) {
    if (!is.null(frame$ofile)) frame$ofile else NA_character_
  }, character(1))
  ofiles <- ofiles[!is.na(ofiles)]
  if (length(ofiles) > 0) return(sdm_normalize_path(ofiles[length(ofiles)], mustWork = FALSE))

  NA_character_
}

sdm_find_project_root <- function(start = NULL) {
  script_path <- sdm_script_path()
  starts <- unique(c(
    start,
    if (!is.na(script_path)) dirname(script_path),
    getwd()
  ))
  starts <- starts[!is.na(starts) & nzchar(starts)]

  for (path in starts) {
    current <- if (dir.exists(path)) path else dirname(path)
    current <- sdm_normalize_path(current, mustWork = FALSE)
    repeat {
      if (file.exists(file.path(current, "app.R")) && file.exists(file.path(current, "R", "load.R"))) {
        return(sdm_normalize_path(current, mustWork = TRUE))
      }
      parent <- dirname(current)
      if (identical(parent, current)) break
      current <- parent
    }
  }

  stop("Could not locate the SDM project root. Expected app.R and R/load.R.", call. = FALSE)
}

sdm_set_project_root <- function(start = NULL) {
  if (!is.null(start) && length(start) > 0 && !is.na(start) && nzchar(start)) {
    root <- normalizePath(start, winslash = "/", mustWork = TRUE)
  } else {
    root <- sdm_find_project_root(start)
  }
  setwd(root)
  assign(".__sdm_project_root", root, envir = .GlobalEnv)
  invisible(root)
}

sdm_project_root <- function() {
  if (exists(".__sdm_project_root", envir = .GlobalEnv, inherits = FALSE)) {
    return(get(".__sdm_project_root", envir = .GlobalEnv, inherits = FALSE))
  }
  sdm_find_project_root()
}

sdm_project_path <- function(...) {
  file.path(sdm_project_root(), ...)
}

sdm_ensure_project_dirs <- function(dirs = NULL) {
  if (is.null(dirs)) {
    dirs <- if (exists("sdm_default_dirs", inherits = TRUE)) get("sdm_default_dirs", inherits = TRUE) else c("outputs", "covariates")
  }
  for (dir in dirs) dir.create(sdm_project_path(dir), recursive = TRUE, showWarnings = FALSE)
  invisible(dirs)
}
