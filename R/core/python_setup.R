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
  result <- system2(sdm_python_path(), c("-c", shprintf("import %s; print('ok')", module_name)),
    stdout = TRUE, stderr = FALSE)
  identical(trimws(result[1]), "ok")
}

shprintf <- function(fmt, ...) {
  sprintf(fmt, ...)
}
