# Python environment setup for the Python executor bridge.

sdm_python_models_dir <- function() {
  file.path(sdm_project_root(), "python_models")
}

sdm_python_path <- function() {
  Sys.getenv("SDM_PYTHON", unset = "python3")
}

discover_python_models <- function() {
  models_dir <- sdm_python_models_dir()
  if (!dir.exists(models_dir)) return(character(0))

  subdirs <- list.dirs(models_dir, recursive = FALSE)
  manifests <- character(0)

  for (dir in subdirs) {
    manifest_path <- file.path(dir, "manifest.json")
    if (file.exists(manifest_path)) {
      manifests <- c(manifests, manifest_path)
    }
  }
  manifests
}

read_python_model_manifest <- function(manifest_path) {
  jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
}

ensure_python_deps <- function(requirements, log_fun = NULL) {
  req_file <- tempfile(fileext = ".txt")
  writeLines(requirements, req_file)
  on.exit(unlink(req_file))

  result <- tryCatch({
    system2(sdm_python_path(), c("-m", "pip", "install", "-r", req_file,
      "--quiet", "--no-cache-dir"),
      stdout = TRUE, stderr = TRUE)
  }, error = function(e) conditionMessage(e))

  if (is.character(result) && any(grepl("ERROR|error", result, ignore.case = TRUE))) {
    log_message(log_fun, "Python dep installation issue: ", paste(result[grepl("ERROR|error", result)], collapse = "; "))
    FALSE
  } else {
    TRUE
  }
}

check_python_module <- function(module_name) {
  stopifnot(is.character(module_name), length(module_name) == 1L)
  safe_name <- gsub("[^a-zA-Z0-9._-]", "", module_name)
  if (!nzchar(safe_name)) return(FALSE)
  # system2() hands args to a shell unquoted: quote the program text, or
  # "import x; print('ok')" is split by the shell and every module looks
  # missing. safe_name is restricted to [A-Za-z0-9._-] above.
  result <- suppressWarnings(system2(sdm_python_path(),
    c("-c", shQuote(sprintf("import %s; print('ok')", safe_name))),
    stdout = TRUE, stderr = FALSE))
  identical(trimws(result[1]), "ok")
}
