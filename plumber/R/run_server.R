#!/usr/bin/env Rscript
# Plumber server entry point with global authentication filter
# All computation endpoints require either:
#   - X-API-Key header (direct API key auth)
#   - X-Hono-Internal header + X-Forwarded-User (Hono-proxied requests with valid JWT)
# Open endpoints (health, reads) bypass auth

# Fatal error handler: dump stack + variables to crash log so OOM/segfault leaves a trail
# Ignores REQUEST_REJECTED (normal Plumber auth rejection — not a crash)
options(error = function() {
  # Plumber preroute hook calls stop("REQUEST_REJECTED") for auth failures.
  # These are expected and must not trigger crash logging or health-check alarms.
  if (identical(geterrmessage(), "REQUEST_REJECTED")) return(invisible(NULL))
  crash_file <- file.path(tempdir(), "sdm_crash_dump.rda")
  tryCatch({
    dump.frames("sdm_crash_dump", to.file = TRUE)
    cat("FATAL: R process crashed at", format(Sys.time()), "\n",
      "  Error:", geterrmessage(), "\n",
      "  Dump written to:", crash_file, "\n",
      file = file.path(Sys.getenv("SDM_CRASH_LOG", tempdir()), "sdm_crash.log"),
      append = TRUE)
  }, error = function(e) NULL)
  # Signal to the Plumber health check process monitor
  cat("FATAL: Unrecoverable R error — process terminating\n")
})

SDM_PROJECT_ROOT <- Sys.getenv("SDM_PROJECT_ROOT", "/app")
app_dir <- if (dir.exists(file.path(SDM_PROJECT_ROOT, "R"))) {
  SDM_PROJECT_ROOT
} else if (dir.exists(file.path(getwd(), "R"))) {
  normalizePath(getwd(), winslash = "/")
} else {
  normalizePath(file.path(getwd(), ".."), winslash = "/")
}

# Source auth helpers (must be in global env before sourcing plumber.R)
source(file.path(app_dir, "plumber", "R", "auth.R"), local = FALSE)

# Source Redis helper
source(file.path(app_dir, "plumber", "R", "redis.R"), local = FALSE)

# Source shared plumber helpers used by route handlers
source(file.path(app_dir, "plumber", "R", "helpers", "plumber_helpers.R"), local = FALSE)

# Source error codes and classification
source(file.path(app_dir, "plumber", "R", "error_codes.R"), local = FALSE)

# Load .env before connecting so local deployments use the same retry path as containers.
env_file <- file.path(app_dir, ".env")
if (file.exists(env_file)) {
  lines <- readLines(env_file, warn = FALSE)
  for (line in lines) {
    if (grepl("^[A-Za-z_][A-Za-z0-9_]*=", line)) {
      kv <- strsplit(sub("^([A-Za-z_][A-Za-z0-9_]*)=(.*)", "\\1\n\\2", line), "\n")[[1]]
      if (length(kv) == 2L && !nzchar(Sys.getenv(kv[1], ""))) {
        do.call(Sys.setenv, stats::setNames(list(kv[2]), kv[1]))
      }
    }
  }
}

# PostgreSQL can lag behind the container process even when Compose is starting
# normally. Retry pool creation instead of permanently disabling pooled access.
library(pool)
source(file.path(app_dir, "plumber", "R", "db_pool.R"), local = FALSE)
db_pool <- sdm_connect_db_pool()
if (!is.null(db_pool)) {
  cat("DB connection pool created (min=1, max=5)\n")
} else if (nzchar(Sys.getenv("DATABASE_URL", ""))) {
  cat("WARNING: DB pool unavailable after startup retries; direct DB connections remain enabled.\n")
}

# Create plumber router (this sets global `pr`)
pr <- plumber::pr(file.path(app_dir, "plumber", "R", "plumber.R"))

# Unbox single-element vectors so JSON primitives are returned instead of arrays
# e.g. "file_path" remains string, "n_rows" remains number, not [value]
# na="null" preserves NA values as JSON null instead of omitting them
pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))

# Disable OpenAPI docs in production (they reveal the API surface)
# Re-enable with PLUMBER_DOCS_ENABLED=true for development
if (tolower(Sys.getenv("PLUMBER_DOCS_ENABLED", "false")) == "true") {
  cat("OpenAPI docs enabled at /openapi.json\n")
} else {
  tryCatch(pr$setDocs(FALSE), error = function(e) NULL)
}

# Internal auth key set by Hono when proxying authenticated requests
internal_key <- Sys.getenv("PLUMBER_INTERNAL_KEY", "")
data_encryption_key <- Sys.getenv("DATA_ENCRYPTION_KEY", "")

# In production, refuse to start if required secrets are missing or weak.
if (identical(Sys.getenv("NODE_ENV"), "production")) {
  issues <- character(0)
  if (!nzchar(internal_key) || nchar(internal_key) < 32L) {
    issues <- c(issues, "PLUMBER_INTERNAL_KEY (>=32 chars)")
  }
  if (!nzchar(data_encryption_key) || nchar(data_encryption_key) < 32L) {
    issues <- c(issues, "DATA_ENCRYPTION_KEY (>=32 chars)")
  }
  if (length(issues) > 0L) {
    cat("FATAL: missing or weak required secrets in production:", paste(issues, collapse = ", "), "\n")
    cat("  Set these environment variables before starting Plumber.\n")
    quit(status = 1)
  }
}

# Auth helper: stop request with error response
auth_fail <- function(res, status, msg) {
  tryCatch(res$status <- status, error = function(e) NULL)
  stop("REQUEST_REJECTED", call. = FALSE)
}

# Helper to safely read headers
get_hdr <- function(req, name) {
  tryCatch({
    hdrs <- req$HEADERS
    if (is.null(hdrs) || length(hdrs) == 0L) return(NULL)
    name_lower <- tolower(name)
    for (h in names(hdrs)) {
      if (tolower(h) == name_lower) return(hdrs[[h]])
    }
    NULL
  }, error = function(e) NULL)
}

# Global preroute hook - runs before every endpoint
# Throws an error to stop processing when auth fails
plumber::pr_hook(pr, "preroute", function(data, req, res) {
  path <- req$PATH_INFO %||% req$PATH

  # Guard against malformed requests
  if (is.null(path) || length(path) == 0L) {
    auth_fail(res, 400L, '{"error":"Malformed request"}')
    return(NULL)
  }

  # Disable auth in dev/test if env var set
  if (identical(Sys.getenv("PLUMBER_AUTH_DISABLED"), "true")) {
    if (identical(Sys.getenv("NODE_ENV"), "production")) {
      cat("FATAL: PLUMBER_AUTH_DISABLED is set in production — refusing to start.\n")
      cat("  Remove PLUMBER_AUTH_DISABLED=true from production environment.\n")
      quit(status = 1)
    }
    if (!nzchar(internal_key)) {
      cat("FATAL: PLUMBER_AUTH_DISABLED=true but PLUMBER_INTERNAL_KEY is not set.\n")
      cat("  Set PLUMBER_INTERNAL_KEY in non-production environments to guard the internal proxy.\n")
      quit(status = 1)
    }
    hono_internal <- get_hdr(req, "x-hono-internal")
    if (is.null(hono_internal) || !identical(hono_internal, internal_key)) {
      auth_fail(res, 401L, '{"error":"Internal system token required. Direct access not allowed."}')
      return(NULL)
    }
    fwd_user <- get_hdr(req, "x-forwarded-user")
    if (!is.null(fwd_user) && nzchar(fwd_user)) {
      req$user_id <- fwd_user
    }
    return(NULL)
  }

  # Open endpoints: read-only, no state change
  if (!requires_auth(path)) {
    return(NULL)
  }

  # Hono internal proxy: Hono has already validated JWT, forward user ID
  if (nzchar(internal_key)) {
    hono_internal <- get_hdr(req, "x-hono-internal")
    if (!is.null(hono_internal) && identical(hono_internal, internal_key)) {
      fwd_user <- get_hdr(req, "x-forwarded-user")
      if (!is.null(fwd_user) && nzchar(fwd_user)) {
        req$user_id <- fwd_user
      }
      return(NULL)
    }
  }

  # Direct API key auth
  api_key <- get_hdr(req, "x-api-key")
  if (is.null(api_key) || !nzchar(api_key)) {
    auth_fail(res, 401L, '{"error":"API key required. Provide X-API-Key header."}')
    return(NULL)
  }

  db_pool <- sdm_get_db_pool(db_pool)
  user_info <- validate_api_key(api_key, pool = db_pool, app_dir = app_dir)
  if (is.null(user_info)) {
    auth_fail(res, 401L, '{"error":"Invalid or expired API key."}')
    return(NULL)
  }

  req$user_id <- user_info$user_id
  req$user_email <- user_info$email
  req$user_role <- user_info$role

  # Rate limit: use hashed API key or user ID as bucket key
  rate_key <- api_key %||% user_info$user_id %||% fwd_user
  if (!is.null(rate_key) && nzchar(rate_key)) {
    if (!sdm_check_rate_limit(rate_key, max_requests = 120, window_seconds = 60)) {
      auth_fail(res, 429L, '{"error":"Rate limit exceeded. Try again in 60 seconds."}')
      return(NULL)
    }
  }

  NULL
})

# Now source the plumber routes - they register with global `pr`
source(file.path(app_dir, "plumber", "R", "plumber.R"), local = FALSE)

# Start server with project root as working directory
setwd(app_dir)

# Preserve crash diagnostics for status polling, then prune failed/cancelled
# scratch jobs after a configurable retention window.
orphan_cleanup <- function() {
  jobs_base <- file.path(app_dir, "outputs", "jobs")
  if (!dir.exists(jobs_base)) return(NULL)
  stale_running_cutoff <- Sys.time() - 86400
  retention_days <- suppressWarnings(as.numeric(Sys.getenv("SDM_FAILED_JOB_RETENTION_DAYS", "7")))
  if (!is.finite(retention_days) || retention_days < 1) retention_days <- 7
  prune_cutoff <- Sys.time() - retention_days * 86400

  for (job_dir in list.dirs(jobs_base, full.names = TRUE, recursive = FALSE)) {
    meta_file <- file.path(job_dir, "meta.json")
    if (!file.exists(meta_file)) next
    meta <- tryCatch(jsonlite::fromJSON(meta_file, simplifyVector = FALSE), error = function(e) NULL)
    if (is.null(meta)) next
    mtime <- file.info(meta_file)$mtime

    if (identical(meta$status, "running") && !is.na(mtime) && mtime < stale_running_cutoff) {
      meta$status <- "failed"
      meta$error <- "Job was orphaned by a previous Plumber process"
      meta$error_code <- "WORKER_ORPHAN"
      meta$error_hint <- "Restart the job. If this recurs, inspect the retained stdout and stderr logs."
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
    } else if (meta$status %in% c("failed", "cancelled") && !is.na(mtime) && mtime < prune_cutoff) {
      unlink(job_dir, recursive = TRUE, force = TRUE)
    }
  }
}
tryCatch({
  cat("Running orphan cleanup (failed-job retention: ",
      Sys.getenv("SDM_FAILED_JOB_RETENTION_DAYS", "7"), " days)...\n", sep = "")
  orphan_cleanup()
}, error = function(e) message("Orphan cleanup skipped: ", conditionMessage(e)))

# Exit handler: kill all background processes on shutdown to prevent orphans
plumber::pr_hook(pr, "exit", function() {
  # Close DB connection pool
  if (!is.null(db_pool)) {
    tryCatch(pool::poolClose(db_pool), error = function(e) NULL)
    cat("DB connection pool closed.\n")
  }
  cat("Plumber shutting down — killing background processes...\n")
  # sdm_process_registry is created in global env by plumber.R
  reg <- tryCatch(get("sdm_process_registry", envir = .GlobalEnv), error = function(e) NULL)
  if (!is.null(reg) && is.environment(reg)) {
    for (job_id in ls(reg)) {
      entry <- reg[[job_id]]
      proc <- sdm_registry_proc(entry)
      if (!is.null(proc) && (inherits(proc, "process") || inherits(proc, "Process")) && proc$is_alive()) {
        cat("Killing background job:", job_id, "\n")
        tryCatch(proc$kill(), error = function(e) NULL)
        tryCatch(proc$wait(timeout = 5000), error = function(e) NULL)
        if (proc$is_alive()) {
          pid <- tryCatch(proc$get_pid(), error = function(e) NULL)
          if (!is.null(pid)) {
            tryCatch(tools::pskill(pid, signal = 9L), error = function(e) NULL)
          }
        }
      }
    }
  }
  # Close Redis connection
  sdm_redis_close()

  # Also kill any leftover processes from meta.json files (SIGTERM + 5s grace)
  jobs_base <- file.path(app_dir, "outputs", "jobs")
  if (dir.exists(jobs_base)) {
    for (jd in list.dirs(jobs_base, full.names = TRUE, recursive = FALSE)) {
      meta_file <- file.path(jd, "meta.json")
      if (file.exists(meta_file)) {
        meta <- tryCatch(jsonlite::fromJSON(meta_file, simplifyVector = FALSE), error = function(e) NULL)
        if (!is.null(meta) && identical(meta$status, "running") && !is.null(meta$process_pid)) {
          pid <- meta$process_pid
          tryCatch(tools::pskill(pid, signal = 15L), error = function(e) NULL)  # SIGTERM
          Sys.sleep(5)
          tryCatch(tools::pskill(pid, signal = 9L), error = function(e) NULL)   # SIGKILL if still alive
        }
      }
    }
  }
  cat("Background process cleanup complete.\n")
})

cat("Starting Plumber on port 8000\n")

# Pre-flight OOM check: warn if available RAM is too low for model runs
tryCatch({
  mem_info <- sdm_mem_info()
  if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
    if (mem_info$memavail < 2.0) {
      cat("WARNING: Available RAM (", sprintf("%.1f GB", mem_info$memavail),
        ") is below 2 GB. Model runs may fail with OOM.\n", sep = "")
    } else {
      cat("Available RAM: ", sprintf("%.1f GB", mem_info$memavail),
        " — sufficient for model runs.\n", sep = "")
    }
  }
}, error = function(e) cat("WARNING: Could not check available RAM:", conditionMessage(e), "\n"))

# Warn if encryption key is not set (dev mode with unencrypted files)
enc_key <- Sys.getenv("SDM_ENCRYPTION_KEY", unset = NA_character_)
if (is.na(enc_key) || !nzchar(enc_key)) {
  cat("NOTE: SDM_ENCRYPTION_KEY not set — occurrence files stored unencrypted.\n",
      "  Set SDM_ENCRYPTION_KEY to a 32+ character secret to enable AES-256-GCM encryption.\n",
      sep = "")
}

plumber::pr_run(pr, host = "0.0.0.0", port = 8000)
