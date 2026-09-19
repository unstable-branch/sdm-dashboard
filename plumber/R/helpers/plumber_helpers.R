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
    pid <- sdm_normalize_pid(meta$process_pid)
    if (!is.na(pid)) {
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
  json_args <- list(x = value, null = "null", auto_unbox = TRUE, pretty = TRUE)
  overrides <- list(...)
  if (length(overrides) > 0L) json_args[names(overrides)] <- overrides
  writeLines(do.call(jsonlite::toJSON, json_args), tmp_path)
  sdm_safe_rename(tmp_path, path)
  invisible(path)
}

sdm_normalize_pid <- function(value) {
  pid <- suppressWarnings(as.integer(unlist(value, recursive = TRUE, use.names = FALSE)))
  if (length(pid) != 1L || !is.finite(pid) || pid <= 0L) return(NA_integer_)
  pid
}

# Serialize terminal metadata transitions across the Plumber request process and
# the background model process. A lock is only reclaimed after its owner process
# is dead; the ownership token prevents an old holder from deleting a successor.
sdm_with_meta_lock <- function(meta_file, action, wait_seconds = 5, stale_seconds = 30) {
  lock_dir <- paste0(meta_file, ".lock")
  owner_file <- file.path(lock_dir, "owner")
  token <- paste(Sys.getpid(), format(Sys.time(), "%Y%m%d%H%M%OS6"),
                 sprintf("%08x", sample.int(.Machine$integer.max, 1L)), sep = "-")
  deadline <- Sys.time() + wait_seconds

  release_owned_lock <- function() {
    owner <- tryCatch(readLines(owner_file, warn = FALSE, n = 1L), error = function(e) character())
    if (length(owner) == 1L && identical(owner, token)) {
      unlink(lock_dir, recursive = TRUE, force = TRUE)
    }
  }

  repeat {
    if (dir.create(lock_dir, showWarnings = FALSE)) {
      writeLines(token, owner_file)
      break
    }

    lock_age <- tryCatch(
      as.numeric(difftime(Sys.time(), file.info(lock_dir)$mtime, units = "secs")),
      error = function(e) 0
    )
    owner <- tryCatch(readLines(owner_file, warn = FALSE, n = 1L), error = function(e) character())
    owner_pid <- if (length(owner) == 1L) sdm_normalize_pid(strsplit(owner, "-", fixed = TRUE)[[1L]][1L]) else NA_integer_
    owner_alive <- if (is.na(owner_pid)) FALSE else tryCatch(
      isTRUE(tools::pskill(owner_pid, signal = 0)),
      error = function(e) FALSE
    )

    if (length(lock_age) == 1L && is.finite(lock_age) && lock_age > stale_seconds && !owner_alive) {
      stale_dir <- paste0(lock_dir, ".stale-", token)
      if (file.rename(lock_dir, stale_dir)) {
        unlink(stale_dir, recursive = TRUE, force = TRUE)
        next
      }
    }
    if (Sys.time() >= deadline) stop("Timed out acquiring model metadata lock")
    Sys.sleep(0.01)
  }
  on.exit(release_owned_lock(), add = TRUE)
  action()
}

# Whichever terminal transition acquires the lock first wins; later
# completion/cancellation/error writers return the committed state instead of
# overwriting it.
sdm_commit_terminal_meta <- function(meta_file, proposed_meta, wait_seconds = 5, stale_seconds = 30) {
  sdm_with_meta_lock(meta_file, function() {
    current <- tryCatch(jsonlite::fromJSON(meta_file, simplifyVector = FALSE), error = function(e) NULL)
    terminal <- c("completed", "failed", "cancelled")
    if (!is.null(current) && as.character(current$status %||% "") %in% terminal) {
      return(list(meta = current, committed = FALSE))
    }

    sdm_write_json(proposed_meta, meta_file)
    list(meta = proposed_meta, committed = TRUE)
  }, wait_seconds = wait_seconds, stale_seconds = stale_seconds)
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
  if (!isTRUE(refresh) && exists(cache_key, envir = .sdm_python_torch_capability_cache, inherits = FALSE)) {
    return(get(cache_key, envir = .sdm_python_torch_capability_cache, inherits = FALSE))
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

# LRU cache for deserialized result.rds — avoids re-reading the same
# multi-MB RDS file on every diagnostic endpoint call.
sdm_result_cache <- new.env(parent = emptyenv())
sdm_result_cache_max <- 10L

# Read saved result RDS and unwrap SpatRasters (cached by file path)
sdm_read_result <- function(path) {
  if (is.null(path) || !file.exists(path)) return(NULL)

  # Check cache
  cached <- sdm_result_cache[[path]]
  if (!is.null(cached)) {
    attr(sdm_result_cache[[path]], "accessed") <- Sys.time()
    return(cached)
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

    # Evict LRU if cache is full
    cached_keys <- ls(sdm_result_cache)
    if (length(cached_keys) >= sdm_result_cache_max) {
      access_times <- sapply(cached_keys, function(k) {
        attr(sdm_result_cache[[k]], "accessed") %||% 0
      })
      n_excess <- length(cached_keys) - sdm_result_cache_max + 1L
      to_remove <- names(sort(unlist(access_times)))[seq_len(n_excess)]
      rm(list = to_remove, envir = sdm_result_cache)
      gc(verbose = FALSE)
    }

    attr(res, "accessed") <- Sys.time()
    sdm_result_cache[[path]] <- res
    res
  }, error = function(e) {
    sdm_log_error("Failed to read result RDS: %s", conditionMessage(e))
    NULL
  })
}
