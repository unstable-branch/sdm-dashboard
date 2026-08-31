handle_health <- function(res, app_dir) {
  mem_avail <- tryCatch(terra::mem_info()$memavail, error = function(e) NULL)
  list(
    status = "ok",
    r_version = R.version.string,
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    active_runs = sdm_count_active_runs(),
    max_concurrent_runs = SDM_MAX_CONCURRENT_RUNS,
    memory_gb = if (is.numeric(mem_avail)) mem_avail else NULL
  )
}

handle_ready <- function(res) {
  active_runs <- sdm_count_active_runs()
  mem_avail <- tryCatch(terra::mem_info()$memavail, error = function(e) NULL)
  mem_ok <- is.numeric(mem_avail) && is.finite(mem_avail) && mem_avail > 1
  runs_ok <- active_runs < SDM_MAX_CONCURRENT_RUNS
  if (!runs_ok || !mem_ok) {
    res$status <- 503L
    return(list(
      status = "busy",
      active_runs = active_runs,
      max_concurrent_runs = SDM_MAX_CONCURRENT_RUNS,
      memory_gb = if (is.numeric(mem_avail)) mem_avail else NULL,
      reason = if (!runs_ok) "at_max_capacity" else "low_memory",
      timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    ))
  }
  list(
    status = "ready",
    active_runs = active_runs,
    max_concurrent_runs = SDM_MAX_CONCURRENT_RUNS,
    memory_gb = mem_avail,
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  )
}

handle_gpu_status <- function(res) {
  gpu <- sdm_gpu_info()
  if (is.null(gpu)) {
    list(
      available = FALSE,
      message = "No supported GPU telemetry detected (NVIDIA nvidia-smi or AMD rocm-smi)",
      timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    )
  } else {
    active_gpu_jobs <- sdm_count_active_gpu_runs()
    c(gpu, list(
      available = TRUE,
      active_gpu_runs = active_gpu_jobs,
      max_gpu_concurrent = SDM_MAX_GPU_CONCURRENT_RUNS %||% 1L,
      timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    ))
  }
}
