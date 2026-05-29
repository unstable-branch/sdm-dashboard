#!/usr/bin/env Rscript
# Plumber server entry point with global authentication filter
# All computation endpoints require either:
#   - X-API-Key header (direct API key auth)
#   - X-Hono-Internal header + X-Forwarded-User (Hono-proxied requests with valid JWT)
# Open endpoints (health, reads) bypass auth

app_dir <- if (dir.exists("/app/R")) {
  "/app"
} else if (dir.exists(file.path(getwd(), "R"))) {
  normalizePath(getwd(), winslash = "/")
} else {
  normalizePath(file.path(getwd(), ".."), winslash = "/")
}

# Source auth helpers (must be in global env before sourcing plumber.R)
source(file.path(app_dir, "plumber", "R", "auth.R"), local = FALSE)

# Source Redis helper
source(file.path(app_dir, "plumber", "R", "redis.R"), local = FALSE)

# Set up DB connection pool for auth and other DB queries
library(pool)
db_pool <- tryCatch({
  db_url <- Sys.getenv("DATABASE_URL", "")
  if (nzchar(db_url)) {
    clean_url <- sub("^postgresql://", "postgres://", db_url)
    parts <- regmatches(clean_url, regexec("postgres://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+)", clean_url))[[1]]
    if (length(parts) == 6) {
      dbPool(
        RPostgres::Postgres(),
        host = parts[4],
        port = as.integer(parts[5]),
        dbname = parts[6],
        user = parts[2],
        password = parts[3],
        minSize = 1,
        maxSize = 5,
        idleTimeout = 60000
      )
    } else {
      masked <- sub("://[^:]+:[^@]+@", "://USER:PASSWORD@", db_url)
      cat("WARNING: Could not parse DATABASE_URL:", masked, "\n")
      NULL
    }
  } else {
    NULL
  }
}, error = function(e) {
  cat("WARNING: Failed to create DB connection pool:", conditionMessage(e), "\n")
  NULL
})
if (!is.null(db_pool)) {
  cat("DB connection pool created (min=1, max=5)\n")
}

# Load .env file for env vars (PLUMBER_INTERNAL_KEY, DATABASE_URL, etc.)
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

# Create plumber router (this sets global `pr`)
pr <- plumber::pr(file.path(app_dir, "plumber", "R", "plumber.R"))

# Unbox single-element vectors so JSON primitives are returned instead of arrays
# e.g. "file_path" remains string, "n_rows" remains number, not [value]
# na="null" preserves NA values as JSON null instead of omitting them
pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))

# Disable OpenAPI docs in production (they reveal the API surface)
# Re-enable with PLUMBER_DOCS_ENABLED=true for development
if (identical(Sys.getenv("PLUMBER_DOCS_ENABLED"), "true")) {
  cat("OpenAPI docs enabled at /__docs__/\n")
} else {
  tryCatch(pr$setDocs(FALSE), error = function(e) NULL)
}

# Internal auth key set by Hono when proxying authenticated requests
internal_key <- Sys.getenv("PLUMBER_INTERNAL_KEY", "")

# Auth helper: stop request with error response
auth_fail <- function(res, status, msg) {
  tryCatch(res$status <- status, error = function(e) NULL)
  res$body <- msg
  # Signal an error to stop Plumber from calling the handler
  stop(msg, call. = FALSE)
}

# Helper to safely read headers
get_hdr <- function(req, name) {
  tryCatch(req$HEADERS[[name]], error = function(e) NULL)
}

# Global preroute hook - runs before every endpoint
# Throws an error to stop processing when auth fails
plumber::pr_hook(pr, "preroute", function(data, req, res) {
  path <- req$PATH_INFO %||% req$PATH

  # Guard against malformed requests
  if (is.null(path) || length(path) == 0L) {
    auth_fail(res, 400L, '{"error":"Malformed request"}')
  }

  # Disable auth in dev/test if env var set
  if (identical(Sys.getenv("PLUMBER_AUTH_DISABLED"), "true")) {
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
  }

  user_info <- validate_api_key(api_key, pool = db_pool, app_dir = app_dir)
  if (is.null(user_info)) {
    auth_fail(res, 401L, '{"error":"Invalid or expired API key."}')
  }

  req$user_id <- user_info$user_id
  req$user_email <- user_info$email
  req$user_role <- user_info$role

  # Rate limit: use hashed API key or user ID as bucket key
  rate_key <- api_key %||% user_info$user_id %||% fwd_user
  if (!is.null(rate_key) && nzchar(rate_key)) {
    if (!sdm_check_rate_limit(rate_key, max_requests = 120, window_seconds = 60)) {
      auth_fail(res, 429L, '{"error":"Rate limit exceeded. Try again in 60 seconds."}')
    }
  }

  NULL
})

# Now source the plumber routes - they register with global `pr`
source(file.path(app_dir, "plumber", "R", "plumber.R"), local = FALSE)

# Start server with project root as working directory
setwd(app_dir)

# Orphan job cleanup: remove stale job directories from previous crashed sessions
orphan_cleanup <- function() {
  jobs_base <- file.path(app_dir, "outputs", "jobs")
  if (!dir.exists(jobs_base)) return(NULL)
  cutoff <- Sys.time() - 86400
  stale <- list.dirs(jobs_base, full.names = TRUE, recursive = FALSE)
  for (jd in stale) {
    mtime <- file.info(jd)$mtime
    if (!is.na(mtime) && mtime < cutoff) {
      meta_file <- file.path(jd, "meta.json")
      if (file.exists(meta_file)) {
        meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
        if (identical(meta$status, "running")) {
          # Kill the process if PID is known, then remove directory
          if (!is.null(meta$process_pid)) {
            tryCatch(tools::pskill(meta$process_pid, signal = 9), error = function(e) NULL)
          }
          unlink(jd, recursive = TRUE, force = TRUE)
        }
      }
    }
  }
}
tryCatch({
  cat("Running orphan cleanup (stale jobs >24h)...\n")
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
      proc <- reg[[job_id]]
      if (inherits(proc, "process") && proc$is_alive()) {
        cat("Killing background job:", job_id, "\n")
        tryCatch(proc$kill(), error = function(e) NULL)
      }
    }
  }
  # Close Redis connection
  sdm_redis_close()

  # Also kill any leftover processes from meta.json files
  jobs_base <- file.path(app_dir, "outputs", "jobs")
  if (dir.exists(jobs_base)) {
    for (jd in list.dirs(jobs_base, full.names = TRUE, recursive = FALSE)) {
      meta_file <- file.path(jd, "meta.json")
      if (file.exists(meta_file)) {
        meta <- tryCatch(jsonlite::fromJSON(meta_file, simplifyVector = FALSE), error = function(e) NULL)
        if (!is.null(meta) && identical(meta$status, "running") && !is.null(meta$process_pid)) {
          tryCatch(tools::pskill(meta$process_pid, signal = 9), error = function(e) NULL)
        }
      }
    }
  }
  cat("Background process cleanup complete.\n")
})

cat("Starting Plumber on port 8000\n")

plumber::pr_run(pr, host = "0.0.0.0", port = 8000)