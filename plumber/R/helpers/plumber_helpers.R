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

# Count GPU-using model runs
sdm_count_active_gpu_runs <- function() {
  if (!exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) return(0L)
  reg <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.environment(reg)) return(0L)
  count <- 0L
  for (key in ls(reg)) {
    entry <- reg[[key]]
    device <- if (is.list(entry)) entry$device else "cpu"
    proc <- if (is.list(entry)) entry$proc else entry
    if (identical(device, "cuda") && inherits(proc, "process") &&
        tryCatch(proc$is_alive(), error = function(e) FALSE)) {
      count <- count + 1L
    }
  }
  count
}

# Count CPU-only model runs
sdm_count_active_cpu_runs <- function() {
  if (!exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) return(0L)
  reg <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.environment(reg)) return(0L)
  count <- 0L
  for (key in ls(reg)) {
    entry <- reg[[key]]
    device <- if (is.list(entry)) entry$device else "cpu"
    proc <- if (is.list(entry)) entry$proc else entry
    if (!identical(device, "cuda") && inherits(proc, "process") &&
        tryCatch(proc$is_alive(), error = function(e) FALSE)) {
      count <- count + 1L
    }
  }
  count
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

# Check if a model run is expected to use GPU acceleration
sdm_is_gpu_model <- function(model_id, dnn_device = "auto") {
  if (!is.character(model_id) || length(model_id) != 1) return(FALSE)
  gpu_models <- c("dnn", "dnn_multispecies")
  if (!model_id %in% gpu_models) return(FALSE)
  if (identical(dnn_device, "cpu")) return(FALSE)
  if (!torch_is_available()) return(FALSE)
  tryCatch(torch::cuda_is_available(), error = function(e) FALSE)
}

torch_is_available <- function() {
  requireNamespace("torch", quietly = TRUE) &&
    tryCatch(torch::torch_is_installed(), error = function(e) FALSE)
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
  if (!is.null(pool)) {
    tryCatch({
      conn <- pool::poolCheckout(pool)
      return(conn)
    }, error = function(e) NULL)
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
    parts <- parse_db_url(db_url)
    DBI::dbConnect(RPostgres::Postgres(),
      dbname = parts$dbname, host = parts$host,
      port = parts$port, user = parts$user, password = parts$password
    )
  }, error = function(e) {
    message("db_connect failed: ", conditionMessage(e))
    NULL
  })
}

parse_db_url <- function(url) {
  m <- regexec("postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)", url)
  parts <- regmatches(url, m)[[1]]
  if (length(parts) < 6) stop("Cannot parse DATABASE_URL")
  list(user = parts[2], password = parts[3], host = parts[4], port = as.integer(parts[5]), dbname = parts[6])
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

# Read saved result RDS and unwrap SpatRasters
sdm_read_result <- function(path) {
  if (is.null(path) || !file.exists(path)) return(NULL)
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
    res
  }, error = function(e) NULL)
}
