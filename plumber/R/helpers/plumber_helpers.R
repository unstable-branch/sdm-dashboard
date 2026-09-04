# Shared helpers for Plumber route handlers. Keep route annotations in plumber.R.

# Structured JSON logging
sdm_log <- function(level, msg, ...) {
  entry <- list(
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3"),
    level = level,
    message = sprintf(msg, ...)
  )
  cat(jsonlite::toJSON(entry, auto_unbox = TRUE), "\n")
}

sdm_log_info <- function(msg, ...) sdm_log("INFO", msg, ...)
sdm_log_warn <- function(msg, ...) sdm_log("WARN", msg, ...)
sdm_log_error <- function(msg, ...) sdm_log("ERROR", msg, ...)

# Count currently running model processes
sdm_count_active_runs <- function() {
  if (!exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) return(0L)
  reg <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.environment(reg)) return(0L)
  count <- 0L
  for (key in ls(reg)) {
    entry <- reg[[key]]
    proc <- if (is.list(entry)) entry$proc else entry
    if (inherits(proc, "process") && tryCatch(proc$is_alive(), error = function(e) FALSE)) {
      count <- count + 1L
    }
  }
  count
}

sdm_registry_device_tag <- function(entry) {
  tolower(as.character(if (is.list(entry) && !inherits(entry, "process")) entry$device else "cpu")[1] %||% "cpu")
}

sdm_registry_process_alive <- function(entry) {
  proc <- if (is.list(entry) && !inherits(entry, "process")) entry$proc else entry
  inherits(proc, "process") && tryCatch(proc$is_alive(), error = function(e) FALSE)
}

# Count all accelerator-tagged model runs, including ROCm and MPS. Older "gpu"
# tags remain supported while workers roll forward.
sdm_count_active_gpu_runs <- function() {
  if (!exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) return(0L)
  reg <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.environment(reg)) return(0L)
  sum(vapply(ls(reg), function(key) {
    entry <- reg[[key]]
    sdm_backend_is_gpu(sdm_registry_device_tag(entry)) && sdm_registry_process_alive(entry)
  }, logical(1)))
}

# CPU-only counts must exclude every accelerator tag, not just CUDA.
sdm_count_active_cpu_runs <- function() {
  if (!exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) return(0L)
  reg <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.environment(reg)) return(0L)
  sum(vapply(ls(reg), function(key) {
    entry <- reg[[key]]
    !sdm_backend_is_gpu(sdm_registry_device_tag(entry)) && sdm_registry_process_alive(entry)
  }, logical(1)))
}
# Check if a background process is still alive by process registry + PID fallback
sdm_check_process_alive <- function(job_id, meta) {
  entry <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv)[[job_id]], error = function(e) NULL)
  proc <- if (is.list(entry)) entry$proc else entry
  process_alive <- FALSE
  if (!is.null(proc)) {
    tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
  }
  if (!process_alive && !is.null(meta$process_pid)) {
    pid <- as.integer(meta$process_pid)
    if (is.finite(pid)) {
      tryCatch({ process_alive <- tools::pskill(pid, signal = 0) }, error = function(e) NULL)
    }
  }
  process_alive
}

# Helper for error responses
sdm_error <- function(req, status, message) {
  res <- tryCatch(req$res, error = function(e) NULL)
  if (!is.null(res)) {
    tryCatch(res$status <- status, error = function(e) NULL)
  }
  list(error = message)
}

sdm_write_json <- function(value, path, ...) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  tmp_path <- paste0(path, ".tmp")
  writeLines(jsonlite::toJSON(value, auto_unbox = TRUE, pretty = TRUE, ...), tmp_path)
  sdm_safe_rename(tmp_path, path)
  invisible(path)
}

# Safe JSON reader: returns NULL on parse failure or missing file instead of
# throwing. Background processes rewrite meta.json concurrently; a partial
# read used to surface as 500 to the client. Use this in any handler that
# reads meta.json or progress.log so a transient I/O error produces a clean
# 503 instead.
sdm_read_meta_json <- function(path, default = NULL) {
  if (!file.exists(path)) return(default)
  tryCatch(
    jsonlite::fromJSON(path, simplifyVector = FALSE),
    error = function(e) default
  )
}

sdm_read_progress_lines <- function(path, n = 50, default = character()) {
  if (!file.exists(path)) return(default)
  tryCatch(
    tail(readLines(path, warn = FALSE), n),
    error = function(e) default
  )
}

# Cached probe for the configured Python interpreter. This deliberately runs only
# for python_torch_dnn scheduling and can be reset/injected in tests.
.sdm_python_torch_capability_cache <- new.env(parent = emptyenv())

sdm_reset_python_torch_capabilities <- function() {
  rm(list = ls(.sdm_python_torch_capability_cache), envir = .sdm_python_torch_capability_cache)
  invisible(NULL)
}

sdm_python_torch_capabilities <- function(capabilities = NULL, refresh = FALSE) {
  normalize <- function(raw) {
    cuda_exec <- isTRUE(raw$cuda)
    rocm <- cuda_exec && isTRUE(raw$rocm)
    list(cuda = cuda_exec && !rocm, cuda_compatible = cuda_exec, rocm = rocm, mps = isTRUE(raw$mps), cpu = TRUE)
  }
  if (!is.null(capabilities)) return(normalize(capabilities))

  python_bin <- if (exists("sdm_python_path", mode = "function")) sdm_python_path() else Sys.getenv("SDM_PYTHON", "python3")
  cache_key <- paste0("capabilities_", gsub("[^A-Za-z0-9]", "_", python_bin))
  ts_key <- paste0(cache_key, "_ts")
  if (!isTRUE(refresh) && exists(cache_key, envir = .sdm_python_torch_capability_cache, inherits = FALSE)) {
    if (exists(ts_key, envir = .sdm_python_torch_capability_cache, inherits = FALSE)) {
      age <- difftime(Sys.time(), get(ts_key, envir = .sdm_python_torch_capability_cache), units = "secs")
      if (as.numeric(age) < 3600) {
        return(get(cache_key, envir = .sdm_python_torch_capability_cache, inherits = FALSE))
      }
    }
  }

  command <- paste0(
    "import json, torch; m=getattr(getattr(torch,'backends',None),'mps',None); ",
    "print(json.dumps({'cuda':bool(torch.cuda.is_available()),'rocm':getattr(torch.version,'hip',None) is not None,'mps':bool(m and m.is_available())}))"
  )
  raw <- tryCatch({
    output <- system2(python_bin, c("-c", shQuote(command)), stdout = TRUE, stderr = FALSE)
    if (!identical(attr(output, "status") %||% 0L, 0L) || length(output) == 0) list() else jsonlite::fromJSON(tail(output, 1))
  }, error = function(e) list())
  result <- normalize(raw)
  assign(cache_key, result, envir = .sdm_python_torch_capability_cache)
  assign(ts_key, Sys.time(), envir = .sdm_python_torch_capability_cache)
  result
}

sdm_model_gpu_backend <- function(model_id, dnn_device = "auto", gpu_enabled = "auto",
                                  capabilities = NULL, python_capabilities = NULL,
                                  python_device = "auto") {
  if (!is.character(model_id) || length(model_id) != 1 || identical(gpu_enabled, "off")) return("cpu")
  model_id <- as.character(model_id)[1]
  if (model_id %in% c("dnn", "dnn_multispecies")) {
    return(sdm_resolve_backend(dnn_device, capabilities = capabilities)$backend)
  }
  if (identical(model_id, "xgboost")) {
    backend <- sdm_resolve_backend("auto", capabilities = capabilities)$backend
    return(if (identical(backend, "cuda")) "cuda" else "cpu")
  }
  if (identical(model_id, "python_torch_dnn")) {
    caps <- sdm_python_torch_capabilities(python_capabilities)
    return(sdm_resolve_backend(python_device, capabilities = caps)$backend)
  }
  "cpu"
}

# Check if a model run is expected to use GPU acceleration.
sdm_is_gpu_model <- function(model_id, dnn_device = "auto", gpu_enabled = "auto",
                             capabilities = NULL, python_capabilities = NULL,
                             python_device = "auto") {
  sdm_backend_is_gpu(sdm_model_gpu_backend(
    model_id, dnn_device, gpu_enabled, capabilities, python_capabilities, python_device
  ))
}
torch_is_available <- function() {
  requireNamespace("torch", quietly = TRUE) &&
    tryCatch(torch::torch_is_installed(), error = function(e) FALSE)
}

# Check if GPU VRAM is sufficient for DNN training.
# Reads SDM_MIN_GPU_VRAM_MIB (default 1500 MiB) to avoid OOM on shared/contended GPUs.
sdm_gpu_vram_is_usable <- function(min_vram_mib = NULL) {
  min_mib <- if (!is.null(min_vram_mib) && is.finite(min_vram_mib)) {
    as.integer(min_vram_mib)
  } else {
    as.integer(Sys.getenv("SDM_MIN_GPU_VRAM_MIB", "1500"))
  }
  free_mib <- sdm_gpu_available_vram()
  if (!is.finite(free_mib) || is.na(free_mib) || free_mib < min_mib) {
    return(FALSE)
  }
  TRUE
}

# Extract process object from registry entry (handles both list and old direct-proc formats)
sdm_registry_proc <- function(entry) {
  if (is.list(entry) && !inherits(entry, "process")) entry$proc else entry
}

# Safe path resolution - restricts access to a base directory
sdm_safe_path <- function(input_path, base_dir) {
  base_dir <- normalizePath(base_dir, winslash = "/", mustWork = FALSE)
  resolved <- normalizePath(file.path(base_dir, basename(input_path)), winslash = "/", mustWork = FALSE)
  base_norm <- normalizePath(base_dir, winslash = "/", mustWork = TRUE)
  if (startsWith(resolved, paste0(base_norm, "/")) || identical(resolved, base_norm)) {
    return(resolved)
  }
  NULL
}

# Safe job directory - ensures run_id stays within outputs/jobs
sdm_safe_job_dir <- function(run_id) {
  jobs_base <- file.path(app_dir, "outputs", "jobs")
  dir.create(jobs_base, recursive = TRUE, showWarnings = FALSE)
  jobs_base <- normalizePath(jobs_base, winslash = "/", mustWork = TRUE)
  resolved <- normalizePath(file.path(jobs_base, basename(run_id)), winslash = "/", mustWork = FALSE)
  if (startsWith(resolved, paste0(jobs_base, "/")) || identical(resolved, jobs_base)) {
    return(resolved)
  }
  NULL
}

# Database connection helper — uses shared pool when available, falls back to direct connection
db_conn <- function() {
  pool <- tryCatch(get("db_pool", envir = .GlobalEnv), error = function(e) NULL)
  if (exists("sdm_get_db_pool", mode = "function")) pool <- sdm_get_db_pool(pool)
  if (!is.null(pool)) {
    tryCatch({
      conn <- pool::poolCheckout(pool)
      return(conn)
  }, error = function(e) {
    sdm_log_error("Failed to read result RDS: %s", conditionMessage(e))
    NULL
  })
  }
  db_connect()
}

db_release <- function(con) {
  if (is.null(con)) return(invisible(NULL))
  pool <- tryCatch(get("db_pool", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.null(pool)) {
    tryCatch(pool::poolReturn(con), error = function(e) NULL)
  } else {
    tryCatch(DBI::dbDisconnect(con), error = function(e) NULL)
  }
  invisible(NULL)
}

# Direct connection helper (fallback when pool unavailable)
db_connect <- function() {
  db_url <- Sys.getenv("DATABASE_URL", "")
  if (!nzchar(db_url)) return(NULL)
  tryCatch({
    sdm_db_connect(db_url)
  }, error = function(e) {
    message("db_connect failed: ", conditionMessage(e))
    NULL
  })
}

parse_db_url <- function(url) {
  sdm_database_connect_args(url)
}

db_insert_upload <- function(con, user_id, file_path, filename, file_size, format, n_rows, species, columns) {
  if (is.null(con)) return(invisible(NULL))
  tryCatch({
    DBI::dbExecute(con,
      "INSERT INTO uploads (user_id, file_path, filename, file_size, format, n_rows, species, columns_detected)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      params = list(user_id, file_path, filename, file_size, format, n_rows, species, columns)
    )
  }, error = function(e) message("Failed to record upload: ", conditionMessage(e)))
}

# Single-entry cache for deserialized result.rds.
# Only one result is ever held unwrapped in memory at a time.
# Keyed by path+mtime so a re-run that overwrites the file is detected.
sdm_result_cache <- new.env(parent = emptyenv())
sdm_result_cache_mtime <- NA

sdm_result_cache_key <- function(path) {
  if (!file.exists(path)) return(paste0("missing:", path))
  as.numeric(file.info(path)$mtime)
}

# Read saved result RDS and unwrap SpatRasters (single-entry cache by file path).
# Always reads fresh; only the last-opened result is retained.
# Callers MUST call sdm_cleanup_result() after use to free SpatRaster memory.
sdm_read_result <- function(path) {
  if (is.null(path) || !file.exists(path)) return(NULL)

  cache_mtime <- sdm_result_cache_key(path)

  # Single-entry cache hit (same file, same mtime)
  if (!identical(cache_mtime, NA) && identical(cache_mtime, sdm_result_cache_mtime)) {
    return(sdm_result_cache[["result"]])
  }

  # Evict previous entry before reading new one
  if (exists("result", envir = sdm_result_cache, inherits = FALSE)) {
    old <- sdm_result_cache[["result"]]
    rm(list = "result", envir = sdm_result_cache)
    # Explicitly clean up unwrapped SpatRasters from previous result
    if (!is.null(old$suitability) && inherits(old$suitability, "SpatRaster")) {
      suppressWarnings(rm(list = "suitability", envir = old))
    }
    if (!is.null(old$future) && is.list(old$future) && !is.null(old$future$suitability) &&
        inherits(old$future$suitability, "SpatRaster")) {
      suppressWarnings(rm(list = "suitability", envir = old$future))
    }
    if (!is.null(old$future2) && is.list(old$future2) && !is.null(old$future2$suitability) &&
        inherits(old$future2$suitability, "SpatRaster")) {
      suppressWarnings(rm(list = "suitability", envir = old$future2))
    }
    if (!is.null(old$climate_match) && is.list(old$climate_match) && !is.null(old$climate_match$similarity) &&
        inherits(old$climate_match$similarity, "SpatRaster")) {
      suppressWarnings(rm(list = "similarity", envir = old$climate_match))
    }
    if (!is.null(old$mess) && is.list(old$mess) && !is.null(old$mess$mess) &&
        inherits(old$mess$mess, "SpatRaster")) {
      suppressWarnings(rm(list = "mess", envir = old$mess))
    }
    if (!is.null(old$aoa) && inherits(old$aoa, "SpatRaster")) {
      suppressWarnings(rm(list = "aoa", envir = old))
    }
    gc(verbose = FALSE)
  }

  tryCatch({
    res <- readRDS(path)
    if (inherits(res$suitability, "PackedSpatRaster")) {
      res$suitability <- terra::unwrap(res$suitability)
    }
    if (!is.null(res$future) && inherits(res$future$suitability, "PackedSpatRaster")) {
      res$future$suitability <- terra::unwrap(res$future$suitability)
    }
    if (!is.null(res$future2) && inherits(res$future2$suitability, "PackedSpatRaster")) {
      res$future2$suitability <- terra::unwrap(res$future2$suitability)
    }
    if (!is.null(res$climate_match) && inherits(res$climate_match$similarity, "PackedSpatRaster")) {
      res$climate_match$similarity <- terra::unwrap(res$climate_match$similarity)
    }
    if (!is.null(res$mess) && inherits(res$mess$mess, "PackedSpatRaster")) {
      res$mess$mess <- terra::unwrap(res$mess$mess)
    }
    if (!is.null(res$aoa) && inherits(res$aoa, "PackedSpatRaster")) {
      res$aoa <- terra::unwrap(res$aoa)
    }

    sdm_result_cache[["result"]] <- res
    sdm_result_cache_mtime <- cache_mtime
    res
  }, error = function(e) {
    sdm_log_error("Failed to read result RDS: %s", conditionMessage(e))
    NULL
  })
}

# Clean up all SpatRaster fields in a result object returned by sdm_read_result().
# MUST be called by every caller after using the result to free memory.
sdm_cleanup_result <- function(res) {
  if (is.null(res) || !is.list(res)) return()
  for (field in c("suitability", "aoa")) {
    if (!is.null(res[[field]]) && inherits(res[[field]], "SpatRaster")) {
      suppressWarnings(rm(list = field, envir = res))
    }
  }
  for (sub_field in c("future", "future2")) {
    if (!is.null(res[[sub_field]]) && is.list(res[[sub_field]])) {
      for (inner in c("suitability", "similarity", "mess")) {
        if (!is.null(res[[sub_field]][[inner]]) && inherits(res[[sub_field]][[inner]], "SpatRaster")) {
          suppressWarnings(rm(list = inner, envir = res[[sub_field]]))
        }
      }
    }
  }
  gc(verbose = FALSE)
}
