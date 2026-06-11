# Detect available RAM to set R_MAX_VSIZE as 75% of total (cgroup-aware),
# overridable via SDM_CHILD_MAX_VSIZE env var.
sdm_detect_vsize <- local({
  .cached <- NULL
  function() {
    if (!is.null(.cached)) return(.cached)
    .cached <<- Sys.getenv("SDM_CHILD_MAX_VSIZE", {
      vsize_gb <- tryCatch({
        mem_total <- readLines("/proc/meminfo", n = 1)
        kb <- as.numeric(gsub(".*:\\s*(\\d+).*", "\\1", mem_total))
        if (is.finite(kb) && kb > 0) max(4L, floor(kb / (1024 * 1024) * 0.75)) else 16L
      }, error = function(e) 16L)
      paste0(vsize_gb, "Gb")
    })
    .cached
  }
})

# Query NVIDIA GPU VRAM via nvidia-smi.
# Returns: available VRAM in MiB, or NA if no GPU / nvidia-smi unavailable.
sdm_gpu_available_vram <- function() {
  tryCatch({
    out <- system2("nvidia-smi", c("--query-gpu=memory.free", "--format=csv,noheader,nounits"),
      stdout = TRUE, stderr = FALSE)
    if (length(out) == 0 || isTRUE(!nzchar(out[1]))) return(NA_real_)
    vals <- suppressWarnings(as.numeric(trimws(out)))
    vals <- vals[is.finite(vals)]
    if (length(vals) == 0) NA_real_ else min(vals)
  }, error = function(e) NA_real_, warning = function(w) NA_real_)
}

# Query total GPU VRAM in MiB
sdm_gpu_total_vram <- function() {
  tryCatch({
    out <- system2("nvidia-smi", c("--query-gpu=memory.total", "--format=csv,noheader,nounits"),
      stdout = TRUE, stderr = FALSE)
    if (length(out) == 0 || isTRUE(!nzchar(out[1]))) return(NA_real_)
    vals <- suppressWarnings(as.numeric(trimws(out)))
    vals <- vals[is.finite(vals)]
    if (length(vals) == 0) NA_real_ else max(vals)
  }, error = function(e) NA_real_, warning = function(w) NA_real_)
}

# Get full GPU info as a list for the health endpoint
sdm_gpu_info <- function() {
  if (!nzchar(Sys.which("nvidia-smi"))) return(NULL)
  tryCatch({
    name_out <- system2("nvidia-smi", c("--query-gpu=name", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)
    driver_out <- system2("nvidia-smi", c("--query-gpu=driver_version", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)
    util_out <- system2("nvidia-smi", c("--query-gpu=utilization.gpu", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)
    temp_out <- system2("nvidia-smi", c("--query-gpu=temperature.gpu", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)

    gpu_name <- if (length(name_out) > 0) trimws(name_out[1]) else NA_character_
    driver <- if (length(driver_out) > 0) trimws(driver_out[1]) else NA_character_
    util <- if (length(util_out) > 0) suppressWarnings(as.numeric(trimws(gsub(" %", "", util_out[1])))) else NA_real_
    temp <- if (length(temp_out) > 0) suppressWarnings(as.numeric(trimws(temp_out[1]))) else NA_real_

    cuda_ver <- tryCatch({
      cv <- system2("nvidia-smi", "--version", stdout = TRUE, stderr = FALSE)
      cv_line <- grep("CUDA Version", cv, value = TRUE)[1]
      if (!is.na(cv_line)) sub(".*CUDA Version:\\s*", "", cv_line) else NA_character_
    }, error = function(e) NA_character_)

    free_mib <- sdm_gpu_available_vram()
    total_mib <- sdm_gpu_total_vram()
    used_mib <- if (is.finite(total_mib) && is.finite(free_mib)) total_mib - free_mib else NA_real_

    list(
      name = gpu_name,
      driver_version = driver,
      cuda_version = cuda_ver,
      vram_total_mib = if (is.finite(total_mib)) total_mib else NA_real_,
      vram_free_mib = if (is.finite(free_mib)) free_mib else NA_real_,
      vram_used_mib = if (is.finite(used_mib)) used_mib else NA_real_,
      gpu_utilization_pct = if (is.finite(util)) util else NA_real_,
      temperature_c = if (is.finite(temp)) temp else NA_real_
    )
  }, error = function(e) NULL)
}
