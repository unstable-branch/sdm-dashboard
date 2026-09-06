# Detect available RAM to set R_MAX_VSIZE as 75% of total (cgroup-aware),
# overridable via SDM_CHILD_MAX_VSIZE env var.
#
# Caching behaviour:
# - If SDM_CHILD_MAX_VSIZE is set, that exact value is used, no probing.
# - Otherwise we probe /sys/fs/cgroup/memory.max (cgroup v2) then /proc/meminfo.
#   The result is cached in a module-level variable to avoid hitting the
#   filesystem on every R worker spawn, but the cache TTL is governed by
#   SDM_CHILD_MAX_VSIZE_REFRESH_MS:
#     - 0 (default) = cache forever; first read wins, no refresh.
#     - N > 0      = re-probe every N milliseconds.
#   In container environments with resizable cgroup limits (k8s vertical pod
#   autoscaling), set SDM_CHILD_MAX_VSIZE_REFRESH_MS to a value like 60000
#   so a resized limit is detected within a minute without restarting Plumber.
# Convert sdm_detect_vsize() output ("16Gb") to bytes for callr r_limit_memory.
# Returns NA_integer_ if conversion fails.
# Note: the result is numeric, not integer — as.integer() overflows int32 for
# any vsize >= 2Gb (as.integer(6 * 1024^3) is NA), which silently disabled the
# child memory limit for typical configurations.
sdm_vsize_to_bytes <- function(vsize_str = sdm_detect_vsize()) {
  if (is.null(vsize_str) || !nzchar(vsize_str)) return(NA_integer_)
  num_gb <- suppressWarnings(as.numeric(sub("[^0-9.]+", "", vsize_str, ignore.case = TRUE)))
  if (is.finite(num_gb) && num_gb > 0) {
    num_gb * 1024^3
  } else {
    NA_integer_
  }
}

# Spawn a background R process via callr::r_bg, passing r_limit_memory only
# when the installed callr version supports it. callr 3.8.0 removed the
# r_limit_memory parameter; forwarding it through ... makes the internal spawn
# fail with "unused argument (r_limit_memory = ...)".
# The R_MAX_VSIZE environment variable (set separately by each caller) still
# caps the child's vector heap on callr versions without r_limit_memory.
sdm_spawn_background <- function(fn, args = list(), stdout = NULL, stderr = NULL,
                                 env = NULL, cmdargs = character(0)) {
  # callr >= 3.8.0 validates env as a character vector; NULL (inherit parent)
  # is no longer accepted. Pass the current environment explicitly so the
  # inheritance behaviour matches what NULL gave on older callr.
  if (is.null(env)) env <- Sys.getenv()
  spawn_args <- list(
    func = fn,
    args = args,
    stdout = stdout,
    stderr = stderr,
    cmdargs = cmdargs,
    env = env
  )
  if ("r_limit_memory" %in% names(formals(callr::r_bg))) {
    spawn_args$r_limit_memory <- sdm_vsize_to_bytes()
  }
  do.call(callr::r_bg, spawn_args)
}

# Safely read the child PID from a callr process object. Returns NA_integer_
# when the process object is not a live callr handle (e.g. a spawn failure
# was recorded instead), so callers never crash on proc$get_pid().
sdm_process_pid <- function(proc) {
  tryCatch(
    as.integer(proc$get_pid()),
    error = function(e) NA_integer_
  )
}

sdm_detect_vsize <- local({
  .cached <- NULL
  .cached_at <- 0
  .refresh_ms <- NULL
  function() {
    refresh_ms <- .refresh_ms
    if (is.null(refresh_ms)) {
      raw <- Sys.getenv("SDM_CHILD_MAX_VSIZE_REFRESH_MS", "0")
      refresh_ms <- suppressWarnings(as.integer(raw))
      if (is.na(refresh_ms) || refresh_ms < 0) refresh_ms <- 0L
      .refresh_ms <<- refresh_ms
    }
    if (!is.null(.cached) && (refresh_ms == 0L ||
        (as.numeric(Sys.time()) * 1000 - .cached_at) < refresh_ms)) {
      return(.cached)
    }
    detected <- Sys.getenv("SDM_CHILD_MAX_VSIZE", {
      vsize_gb <- tryCatch({
        cgroup_limit <- NA_real_
        if (file.exists("/sys/fs/cgroup/memory.max")) {
          val <- readLines("/sys/fs/cgroup/memory.max")
          if (!identical(val, "max")) {
            gb <- as.numeric(val) / (1024^3)
            if (is.finite(gb) && gb > 0) cgroup_limit <- gb
          }
        }
        if (is.finite(cgroup_limit)) {
          max(4L, floor(cgroup_limit * 0.75))
        } else {
          mem_total <- readLines("/proc/meminfo", n = 1)
          kb <- as.numeric(gsub(".*:\\s*(\\d+).*", "\\1", mem_total))
          if (is.finite(kb) && kb > 0) max(4L, floor(kb / (1024 * 1024) * 0.75)) else 16L
        }
      }, error = function(e) 16L)
      paste0(vsize_gb, "Gb")
    })
    .cached <<- detected
    .cached_at <<- as.numeric(Sys.time()) * 1000
    .cached
  }
})

# Query NVIDIA GPU VRAM via nvidia-smi.
# Returns: available VRAM in MiB, or NA if no GPU / nvidia-smi unavailable.
.sdm_which_nvidia_smi <- local({
  .cached <- NULL
  function() {
    if (!is.null(.cached)) return(.cached)
    path <- Sys.which("nvidia-smi")
    if (!nzchar(path)) path <- Sys.which("/usr/local/cuda/bin/nvidia-smi")
    if (!nzchar(path) && nzchar(Sys.getenv("CUDA_HOME"))) {
      path <- Sys.which(file.path(Sys.getenv("CUDA_HOME"), "bin", "nvidia-smi"))
    }
    .cached <<- if (nzchar(path)) path else NA_character_
    .cached
  }
})

.sdm_which_rocm_smi <- local({
  .cached <- NULL
  function() {
    if (!is.null(.cached)) return(.cached)
    candidates <- c(Sys.which("rocm-smi"), "/opt/rocm/bin/rocm-smi")
    candidates <- candidates[nzchar(candidates) & file.exists(candidates)]
    .cached <<- if (length(candidates) > 0) candidates[1] else NA_character_
    .cached
  }
})

.sdm_parse_rocm_smi_json <- function(json_text) {
  payload <- jsonlite::fromJSON(json_text, simplifyVector = FALSE)
  cards <- payload[grepl("^card[0-9]+$", names(payload))]
  if (length(cards) == 0) return(NULL)

  card <- cards[[1]]
  as_number <- function(key) {
    value <- suppressWarnings(as.numeric(card[[key]]))
    if (length(value) == 1 && is.finite(value)) value else NA_real_
  }
  total_bytes <- as_number("VRAM Total Memory (B)")
  used_bytes <- as_number("VRAM Total Used Memory (B)")
  total_mib <- total_bytes / (1024^2)
  used_mib <- used_bytes / (1024^2)
  free_mib <- total_mib - used_mib

  list(
    name = card[["Card Series"]] %||% NA_character_,
    vendor = "AMD",
    backend = "rocm",
    architecture = card[["GFX Version"]] %||% NA_character_,
    driver_version = NA_character_,
    cuda_version = NA_character_,
    rocm_version = if (file.exists("/opt/rocm/.info/version")) {
      tryCatch(readLines("/opt/rocm/.info/version", n = 1), error = function(e) NA_character_)
    } else {
      NA_character_
    },
    vram_total_mib = if (is.finite(total_mib)) floor(total_mib) else NA_real_,
    vram_free_mib = if (is.finite(free_mib)) floor(free_mib) else NA_real_,
    vram_used_mib = if (is.finite(used_mib)) floor(used_mib) else NA_real_,
    gpu_utilization_pct = as_number("GPU use (%)"),
    temperature_c = as_number("Temperature (Sensor edge) (C)")
  )
}

.sdm_rocm_gpu_info <- function() {
  smi <- .sdm_which_rocm_smi()
  if (is.na(smi)) return(NULL)
  tryCatch({
    out <- system2(smi, c("--showproductname", "--showmeminfo", "vram", "--showuse", "--showtemp", "--json"),
      stdout = TRUE, stderr = FALSE)
    if (length(out) == 0) return(NULL)
    .sdm_parse_rocm_smi_json(paste(out, collapse = "\n"))
  }, error = function(e) NULL, warning = function(w) NULL)
}

sdm_gpu_available_vram <- function() {
  smi <- .sdm_which_nvidia_smi()
  if (is.na(smi)) {
    rocm <- .sdm_rocm_gpu_info()
    if (!is.null(rocm) && is.finite(rocm$vram_free_mib)) return(rocm$vram_free_mib)
    # Docker without --gpus: nvidia-smi absent; try torch-level query as fallback
    if (requireNamespace("torch", quietly = TRUE) && torch::torch_is_installed()) {
      return(tryCatch({
        stats <- torch::cuda_memory_stats()
        allocated <- stats[["allocated_bytes"]][["current"]] %||% 0
        total <- stats[["reserved_bytes"]][["all"]] %||% 0
        if (total > 0) floor((total - allocated) / (1024 * 1024)) else NA_real_
      }, error = function(e) NA_real_))
    }
    return(NA_real_)
  }
  tryCatch({
    out <- system2(smi, c("--query-gpu=memory.free", "--format=csv,noheader,nounits"),
      stdout = TRUE, stderr = FALSE)
    if (length(out) == 0 || isTRUE(!nzchar(out[1]))) return(NA_real_)
    vals <- suppressWarnings(as.numeric(trimws(out)))
    vals <- vals[is.finite(vals)]
    if (length(vals) == 0) NA_real_ else min(vals)
  }, error = function(e) NA_real_, warning = function(w) NA_real_)
}

# Query total GPU VRAM in MiB
sdm_gpu_total_vram <- function() {
  smi <- .sdm_which_nvidia_smi()
  if (is.na(smi)) {
    rocm <- .sdm_rocm_gpu_info()
    if (!is.null(rocm) && is.finite(rocm$vram_total_mib)) return(rocm$vram_total_mib)
    # Docker without --gpus: try torch-level query as fallback
    if (requireNamespace("torch", quietly = TRUE) && torch::torch_is_installed()) {
      return(tryCatch({
        stats <- torch::cuda_memory_stats()
        total <- stats[["reserved_bytes"]][["all"]] %||% 0
        if (total > 0) floor(total / (1024 * 1024)) else NA_real_
      }, error = function(e) NA_real_))
    }
    return(NA_real_)
  }
  tryCatch({
    out <- system2(smi, c("--query-gpu=memory.total", "--format=csv,noheader,nounits"),
      stdout = TRUE, stderr = FALSE)
    if (length(out) == 0 || isTRUE(!nzchar(out[1]))) return(NA_real_)
    vals <- suppressWarnings(as.numeric(trimws(out)))
    vals <- vals[is.finite(vals)]
    if (length(vals) == 0) NA_real_ else max(vals)
  }, error = function(e) NA_real_, warning = function(w) NA_real_)
}

# Get current process RSS in MB from /proc/self/status (Linux).
# Falls back to gc()["used"] / 1e6 when /proc is unavailable (e.g. Windows).
# Returns a single numeric value in MiB, or NA_real_ if unavailable.
sdm_get_rss_mb <- function() {
  if (.Platform$OS.type != "unix" || !file.exists("/proc/self/status")) {
    gc_info <- gc(verbose = FALSE, full = FALSE)
    if (is.matrix(gc_info) && nrow(gc_info) >= 2) {
      return(sum(gc_info[2, "Used (Mb)"]) %||% NA_real_)
    }
    return(NA_real_)
  }
  tryCatch({
    status <- readLines("/proc/self/status", warn = FALSE)
    rss_line <- grep("^VmRSS:", status, value = TRUE)
    if (length(rss_line) == 0) return(NA_real_)
    rss_kb <- as.numeric(gsub(".*:\\s*(\\d+).*", "\\1", rss_line[1]))
    if (is.finite(rss_kb)) rss_kb / 1024 else NA_real_
  }, error = function(e) NA_real_)
}
sdm_gpu_info <- function() {
  smi_path <- .sdm_which_nvidia_smi()
  if (is.na(smi_path)) return(.sdm_rocm_gpu_info())
  tryCatch({
    name_out <- system2(smi_path, c("--query-gpu=name", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)
    driver_out <- system2(smi_path, c("--query-gpu=driver_version", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)
    util_out <- system2(smi_path, c("--query-gpu=utilization.gpu", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)
    temp_out <- system2(smi_path, c("--query-gpu=temperature.gpu", "--format=csv,noheader"),
      stdout = TRUE, stderr = FALSE)

    gpu_name <- if (length(name_out) > 0) trimws(name_out[1]) else NA_character_
    driver <- if (length(driver_out) > 0) trimws(driver_out[1]) else NA_character_
    util <- if (length(util_out) > 0) suppressWarnings(as.numeric(trimws(gsub(" %", "", util_out[1])))) else NA_real_
    temp <- if (length(temp_out) > 0) suppressWarnings(as.numeric(trimws(temp_out[1]))) else NA_real_

    cuda_ver <- tryCatch({
      cv <- system2(smi_path, "--version", stdout = TRUE, stderr = FALSE)
      cv_line <- grep("CUDA Version", cv, value = TRUE)[1]
      if (!is.na(cv_line)) sub(".*CUDA Version:\\s*", "", cv_line) else NA_character_
    }, error = function(e) NA_character_)

    free_mib <- sdm_gpu_available_vram()
    total_mib <- sdm_gpu_total_vram()
    used_mib <- if (is.finite(total_mib) && is.finite(free_mib)) total_mib - free_mib else NA_real_

    list(
      name = gpu_name,
      vendor = "NVIDIA",
      backend = "cuda",
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
