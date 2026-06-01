#!/usr/bin/env Rscript
# Background targets pipeline runner.
# Spawned by Plumber's POST /api/v1/models/targets-run.
# Reads config from <job_dir>/config.csv, runs tar_make(), writes results.
`%||%` <- function(a, b) if (!is.null(a)) a else b

if (!exists("job_dir", inherits = FALSE) || is.null(job_dir) || length(job_dir) != 1L ||
    is.na(job_dir) || !nzchar(job_dir)) {
  job_dir <- commandArgs(trailingOnly = TRUE)[1L]
}
if (!exists("app_dir", inherits = FALSE) || is.null(app_dir) || length(app_dir) != 1L ||
    is.na(app_dir) || !nzchar(app_dir)) {
  app_dir <- commandArgs(trailingOnly = TRUE)[2L]
}
if (is.na(job_dir) || !nzchar(job_dir)) stop("job_dir is required")
if (is.na(app_dir) || !nzchar(app_dir)) stop("app_dir is required")

config_csv <- file.path(job_dir, "config.csv")
store_path <- file.path(job_dir, "_targets")
progress_file <- file.path(job_dir, "progress.log")
meta_file <- file.path(job_dir, "meta.json")

log_fun <- function(...) {
  msg <- paste0(format(Sys.time(), "%H:%M:%S"), " ", ...)
  cat(msg, "\n")
  cat(msg, "\n", file = progress_file, append = TRUE)
}

read_meta <- function() {
  jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
}

write_meta <- function(meta) {
  writeLines(jsonlite::toJSON(meta, null = "null", auto_unbox = TRUE, pretty = TRUE), meta_file)
}

source(file.path(app_dir, "R", "core", "bootstrap.R"))
sdm_set_project_root(app_dir)
source(file.path(app_dir, "R", "load.R"))

log_fun("Targets pipeline starting for ", basename(job_dir))

Sys.setenv(SDM_TARGETS_CONFIG = config_csv)
Sys.setenv(SDM_TARGETS_STORE = store_path)

meta <- read_meta()
meta$status <- "running"
write_meta(meta)

tryCatch({
  targets::tar_make(
    store = store_path,
    callr_function = NULL
  )

  meta <- read_meta()
  meta$status <- "completed"
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")

  meta_results <- targets::tar_meta(store = store_path)
  n_completed <- sum(meta_results$status == "completed", na.rm = TRUE)
  n_errored <- sum(meta_results$status == "errored", na.rm = TRUE)
  meta$targets_summary <- list(
    total_targets = nrow(meta_results),
    completed = n_completed,
    errored = n_errored
  )

  log_fun(sprintf("Targets complete: %d done, %d errored", n_completed, n_errored))
  write_meta(meta)
}, error = function(e) {
  meta <- read_meta()
  meta$status <- "failed"
  meta$error <- conditionMessage(e)
  meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  write_meta(meta)
  cat("Targets pipeline failed:", conditionMessage(e), "\n")
})
