handle_job_status <- function(req, res, job_id, app_dir) {
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

  sdm_redis_cancel_set(basename(job_id))

  entry <- sdm_process_registry[[basename(job_id)]]
  proc <- sdm_registry_proc(entry)
  killed <- FALSE
  if (!is.null(proc) && inherits(proc, "Process") && proc$is_alive()) {
    proc$kill()
    killed <- TRUE
    Sys.sleep(3)
    if (proc$is_alive()) {
      pid <- proc$get_pid()
      tryCatch({
        if (file.exists("/proc") && !is.na(suppressWarnings(as.numeric(pid)))) {
          cmdline <- tryCatch(readLines(file.path("/proc", pid, "cmdline"), warn = FALSE), error = function(e) "")
          if (length(cmdline) == 0 || identical(cmdline, "")) stop("PID not found")
        }
        tools::pskill(pid, signal = 9)
      }, error = function(e) NULL)
    }
    rm(list = basename(job_id), envir = sdm_process_registry)
  }

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$status) && meta$status %in% c("completed", "failed", "cancelled")) {
      return(list(ok = TRUE, message = "Job already terminated"))
    }
    if (!killed && !is.null(meta$process_pid)) {
      pid <- meta$process_pid
      tryCatch({
        if (file.exists("/proc") && !is.na(suppressWarnings(as.numeric(pid)))) {
          cmdline <- tryCatch(readLines(file.path("/proc", pid, "cmdline"), warn = FALSE), error = function(e) "")
          if (length(cmdline) == 0 || identical(cmdline, "")) stop("PID not found")
        }
        tools::pskill(pid, signal = 9)
        killed <- TRUE
      }, error = function(e) NULL)
    }
    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
  }

  list(ok = TRUE, message = if (killed) "Job cancelled and process terminated" else "Job cancelled (process not found)")
}
