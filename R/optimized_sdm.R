# Compatibility loader for the refactored SDM engine.

.__sdm_ofiles <- vapply(sys.frames(), function(frame) {
  if (!is.null(frame$ofile)) frame$ofile else NA_character_
}, character(1))
.__sdm_ofile_dirs <- dirname(normalizePath(.__sdm_ofiles[!is.na(.__sdm_ofiles)], winslash = "/", mustWork = FALSE))

already_rooted <- if (exists(".__sdm_project_root", envir = .GlobalEnv, inherits = FALSE)) {
  get(".__sdm_project_root", envir = .GlobalEnv)
} else {
  NULL
}

search_paths <- if (!is.null(already_rooted)) {
  c(already_rooted, file.path(already_rooted, "R"))
} else {
  c(file.path(getwd(), "R"), getwd(), .__sdm_ofile_dirs)
}
.__sdm_module_dir <- search_paths[file.exists(file.path(search_paths, "load.R"))][1]
if (is.na(.__sdm_module_dir) || is.null(.__sdm_module_dir)) {
  stop(
    "Could not locate R/load.R. Searched: ",
    paste(unique(search_paths), collapse = ", "),
    ". Current: ", getwd(),
    call. = FALSE
  )
}
# If the found path is itself an R/ subdirectory, go up one level to the actual project root.
# This handles the case where script runs from project_root/ and search_paths
# finds project_root/R/load.R before project_root/load.R.
if (identical(basename(.__sdm_module_dir), "R")) {
  .__sdm_actual_root <- dirname(.__sdm_module_dir)
} else {
  .__sdm_actual_root <- .__sdm_module_dir
}

if (!is.null(already_rooted)) {
  message("Using existing project root: ", already_rooted)
} else {
  message("Setting project root to: ", .__sdm_actual_root)
}
source(file.path(.__sdm_actual_root, "R", "bootstrap.R"), local = FALSE)
sdm_set_project_root(.__sdm_actual_root)
source(file.path(.__sdm_actual_root, "R", "load.R"), local = FALSE)
rm(.__sdm_ofile_dirs, .__sdm_ofiles, already_rooted, search_paths, .__sdm_actual_root)
