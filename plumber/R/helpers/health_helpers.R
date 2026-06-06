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
  list(
    status = "ok",
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  )
}
