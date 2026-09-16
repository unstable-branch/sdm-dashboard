handle_job_status <- function(req, res, job_id, app_dir) {
  own_err <- sdm_verify_run_owner(req, res, job_id, app_dir)
  if (!is.null(own_err)) return(own_err)
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  if (file.exists(meta_file)) {
    meta <- tryCatch(jsonlite::fromJSON(meta_file, simplifyVector = FALSE), error = function(e) NULL)
    if (!is.null(meta) && !is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        res$status <- 403L
        return(list(error = "Access denied"))
      }
    }
  }
  status <- handle_async_status(res, job_id, app_dir)
  if (!isTRUE(status$available)) {
    if (!is.null(res) && is.null(res$status)) res$status <- 404L
    return(list(error = status$error %||% "Job not found"))
  }
  status
}

handle_job_cancel <- function(req, res, job_id, app_dir) {
  own_err <- sdm_verify_run_owner(req, res, job_id, app_dir)
  if (!is.null(own_err)) return(own_err)
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- sdm_read_meta_json(meta_file)
    if (is.null(meta)) { if (!is.null(res)) res$status <- 503L; return(list(error = "meta.json is unreadable; retry shortly")) }
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this job"))
      }
    }
  }

  sdm_redis_cancel_set(basename(job_id))

  cancel_result <- sdm_cancel_pid_first(basename(job_id), meta_file)
  killed <- cancel_result$killed
  if (cancel_result$from_registry) {
    sdm_registry_remove(basename(job_id), "cancelled")
  }

  if (file.exists(meta_file)) {
    meta <- sdm_read_meta_json(meta_file)
    if (is.null(meta)) { if (!is.null(res)) res$status <- 503L; return(list(error = "meta.json is unreadable; retry shortly")) }
    if (!is.null(meta$status) && meta$status %in% c("completed", "failed", "cancelled")) {
      return(list(ok = TRUE, message = "Job already terminated"))
    }
    if (!killed) {
      killed <- sdm_kill_pid(meta$process_pid)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
  }

  list(ok = TRUE, message = if (killed) "Job cancelled and process terminated" else "Job cancelled (process not found)")
}
