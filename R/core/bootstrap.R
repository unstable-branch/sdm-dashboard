# Project-root and path helpers shared by app, CLI, scripts, and setup.

sdm_normalize_path <- function(path, mustWork = FALSE) {
  normalizePath(path, winslash = "/", mustWork = mustWork)
}

sdm_script_path <- function() {
  file_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(file_arg) > 0) {
    return(sdm_normalize_path(sub("^--file=", "", file_arg[1]), mustWork = TRUE))
  }

  ofiles <- vapply(sys.frames(), function(frame) {
    if (!is.null(frame$ofile)) frame$ofile else NA_character_
  }, character(1))
  ofiles <- ofiles[!is.na(ofiles)]
  if (length(ofiles) > 0) {
    return(sdm_normalize_path(ofiles[length(ofiles)], mustWork = FALSE))
  }

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

# Resolve configurable data paths consistently. Absolute environment values are
# preserved; relative values are always anchored at the project root rather
# than the caller's working directory (for example /app/plumber/R in callr).
sdm_resolve_project_path <- function(path, root = sdm_project_root()) {
  if (is.null(path) || length(path) == 0L || is.na(path[1L]) || !nzchar(trimws(path[1L]))) {
    return(path)
  }
  path <- path.expand(trimws(as.character(path[1L])))
  is_absolute <- grepl("^(/|[A-Za-z]:[/\\]|\\\\)", path)
  resolved <- if (is_absolute) path else file.path(root, path)
  sdm_normalize_path(resolved, mustWork = FALSE)
}

sdm_ensure_project_dirs <- function(dirs = NULL) {
  if (is.null(dirs)) {
    dirs <- if (exists("sdm_default_dirs", inherits = TRUE)) get("sdm_default_dirs", inherits = TRUE) else c("outputs", "covariates")
  }
  for (dir in dirs) dir.create(sdm_project_path(dir), recursive = TRUE, showWarnings = FALSE)
  invisible(dirs)
}

# Safe file rename with cross-device fallback.
# On Docker, /tmp is often a separate tmpfs mount and file.rename() fails
# with EXDEV ("Invalid cross-device link"). Falls back to copy + delete.
sdm_safe_rename <- function(from, to) {
  if (file.exists(to)) unlink(to, force = TRUE)
  if (!file.rename(from, to)) {
    file.copy(from, to, overwrite = TRUE)
    unlink(from, force = TRUE)
  }
  invisible(TRUE)
}

# Atomic write: write to tmp file in the same directory, then rename.
# Prevents readers from seeing partial content if the process crashes mid-write.
sdm_atomic_write_lines <- function(text, path) {
  tmp <- paste0(path, ".tmp.", Sys.getpid(), ".", as.integer(Sys.time()))
  writeLines(text, tmp)
  sdm_safe_rename(tmp, path)
  invisible(NULL)
}

sdm_atomic_saveRDS <- function(object, path) {
  tmp <- paste0(path, ".tmp.", Sys.getpid(), ".", as.integer(Sys.time()))
  saveRDS(object, tmp)
  sdm_safe_rename(tmp, path)
  invisible(NULL)
}
