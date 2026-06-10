handle_job_status <- function(req, res, job_id, app_dir) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        res$status <- 403L
        return(list(error = "Access denied"))
      }
    }
  }
  status <- handle_async_status(NULL, job_id, app_dir)
  if (!status$available) {
    res$status <- 404L
    return(list(error = "Job not found"))
  }
  status
}

handle_job_cancel <- function(req, job_id, app_dir) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this job"))
      }
    }
  }

  proc <- sdm_process_registry[[basename(job_id)]]
  killed <- FALSE
  if (!is.null(proc) && inherits(proc, "Process") && proc$is_alive()) {
    proc$kill()
    killed <- TRUE
    rm(list = basename(job_id), envir = sdm_process_registry)
  }

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!killed && !is.null(meta$process_pid)) {
      tryCatch({ tools::pskill(meta$process_pid, signal = 9); killed <- TRUE }, error = function(e) NULL)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_redis_cancel_set(basename(job_id))
  }

  list(ok = TRUE, message = if (killed) "Job cancelled" else "Job not found")
}
