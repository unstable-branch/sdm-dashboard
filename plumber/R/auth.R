# Plumber API Key Authentication Middleware
# Validates X-API-Key header against PostgreSQL api_keys table

#' Validate an API key against the database
#' @param api_key The raw API key from X-API-Key header
#' @param pool Optional dbPool connection pool
#' @param app_dir Application directory for DB config
#' @return List with user_id if valid, NULL otherwise
validate_api_key <- function(api_key, pool = NULL, app_dir = NULL) {
  if (is.null(api_key) || !nzchar(api_key)) {
    return(NULL)
  }

  # Hash the incoming API key (same as Hono's auth middleware)
  key_hash <- digest::digest(api_key, algo = "sha256", serialize = FALSE)

  # Use connection pool if available, otherwise create single connection
  tryCatch({
    if (!is.null(pool) && inherits(pool, "Pool")) {
      con <- pool::poolCheckout(pool)
      on.exit(pool::poolReturn(con), add = TRUE)
    } else {
      db_url <- Sys.getenv("DATABASE_URL", "")
      if (!nzchar(db_url)) return(NULL)
      con <- sdm_db_connect(db_url)
      on.exit(DBI::dbDisconnect(con), add = TRUE)
    }

    query <- "SELECT u.id, u.email, u.name, u.role, ak.created_at as key_created
              FROM api_keys ak
              JOIN users u ON u.id = ak.user_id
              WHERE ak.key_hash = $1
                AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
              LIMIT 1"

    result <- DBI::dbGetQuery(con, query, params = list(key_hash))

    if (nrow(result) == 0) {
      return(NULL)
    }

    list(
      user_id = result$id,
      email = result$email,
      name = result$name,
      role = result$role
    )
  }, error = function(e) {
    warning("API key validation error: ", conditionMessage(e))
    NULL
  })
}

#' Check if request requires authentication
#' @param path Request path
#' @return TRUE if auth required, FALSE if open
requires_auth <- function(path) {
  # Guard against empty/invalid path - require auth as safety measure
  if (is.null(path) || length(path) == 0L || !is.character(path)) {
    return(TRUE)
  }

  # Open endpoints: read-only infrastructure, discovery, and climate availability checks.
  # Ecology and diagnostics endpoints return per-run scientific outputs and now require
  # authentication (api key or forwarded user) — see GC-09.
  open_patterns <- c(
    "^/health$",
    "^/ready$",
    "^/api/v1/climate/scenarios$",
    "^/api/v1/climate/check$",
    "^/api/v1/config/defaults$",
    "^/api/v1/models$",
    "^/api/v1/future/scenarios$",
    "^/api/v1/covariates/check$"
  )

  if (tolower(Sys.getenv("PLUMBER_DOCS_ENABLED", "false")) == "true") {
    open_patterns <- c(
      open_patterns,
      "^/openapi[.]json$",
      "^/__openapi__/?$"
    )
  }

  for (pattern in open_patterns) {
    result <- grepl(pattern, path)
    if (length(result) > 0 && isTRUE(result)) {
      return(FALSE)
    }
  }
  TRUE
}

# Simple in-memory rate limiter for Plumber auth filter
# Tracks request counts per unique key (API key hash or user ID)
rate_limit_buckets <- new.env(parent = emptyenv())
rate_limit_check_counter <- 0L

sdm_check_rate_limit <- function(key, max_requests = 60, window_seconds = 60) {
  current <- as.numeric(Sys.time())
  window_start <- current - window_seconds

  # Periodic cleanup (every ~50 calls) to prevent memory leak from stale keys
  rate_limit_check_counter <<- rate_limit_check_counter + 1L
  if (rate_limit_check_counter %% 50L == 0L) {
    threshold <- current - 3600
    for (k in ls(envir = rate_limit_buckets)) {
      ts <- rate_limit_buckets[[k]]
      ts <- ts[ts > threshold]
      if (length(ts) == 0) {
        rm(list = k, envir = rate_limit_buckets)
      } else {
        rate_limit_buckets[[k]] <- ts
      }
    }
  }

  if (exists(key, envir = rate_limit_buckets)) {
    timestamps <- rate_limit_buckets[[key]]
    timestamps <- timestamps[timestamps > window_start]
    if (length(timestamps) >= max_requests) {
      return(FALSE)
    }
    rate_limit_buckets[[key]] <- c(timestamps, current)
  } else {
    rate_limit_buckets[[key]] <- current
  }
  TRUE
}

# validate_api_key now accepts an optional pool argument for connection pooling
# (pool is set up in run_server.R and passed as an option)

# Verify that the requesting user owns the run referenced by `run_id`.
# Returns NULL on success, or an error list (with `status` already set on `res`)
# on ownership failure / missing run.
# Admin role bypasses the ownership check (consistent with runs-table admin bypass).




# Typed, fail-closed resource loader used by every protected job endpoint.
# Validation happens before the admin membership bypass. A malformed principal,
# missing owner metadata, unreadable metadata, or storage error is never treated
# as an anonymous or admin request.
sdm_load_authorized_job <- function(req, res, job_id, app_dir = NULL) {
  deny <- function(status, message) {
    if (!is.null(res)) res$status <- as.integer(status)
    list(ok = FALSE, error = message, status = as.integer(status))
  }

  user_id <- tryCatch(as.character(req$user_id %||% "")[1], error = function(e) "")
  user_role <- tryCatch(as.character(req$user_role %||% "")[1], error = function(e) "")
  if (!nzchar(user_id) || !nzchar(user_role) ||
      !user_role %in% c("admin", "editor", "viewer")) {
    return(deny(401L, "Authenticated principal required"))
  }

  job_dir <- tryCatch(sdm_safe_job_dir(job_id), error = function(e) NULL)
  if (is.null(job_dir) || !is.character(job_dir) || length(job_dir) != 1L ||
      !nzchar(job_dir) || !dir.exists(job_dir)) {
    return(deny(404L, "Job not found"))
  }

  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file) || file.access(meta_file, 4L) != 0L) {
    return(deny(404L, "Job metadata unavailable"))
  }
  meta <- tryCatch(sdm_read_meta_json(meta_file), error = function(e) NULL)
  if (is.null(meta) || !is.list(meta)) {
    return(deny(503L, "Job metadata is unreadable"))
  }

  owner_id <- tryCatch(as.character(meta$user_id %||% "")[1], error = function(e) "")
  if (!nzchar(owner_id)) {
    return(deny(503L, "Job owner metadata is unavailable"))
  }

  # Admin bypasses membership only after the resource and owner metadata have
  # been validated above.
  if (identical(user_role, "admin") || identical(owner_id, user_id)) {
    return(list(ok = TRUE, job_dir = job_dir, meta_file = meta_file,
                meta = meta, owner_id = owner_id))
  }
  deny(403L, "You do not have permission to access this job")
}

# Compatibility adapter for existing handlers. The loader above is the single
# authorization implementation; callers still receive NULL on success or the
# typed HTTP error object expected by legacy handlers.
sdm_verify_run_owner <- function(req, res, run_id, app_dir) {
  auth <- sdm_load_authorized_job(req, res, run_id, app_dir)
  if (isTRUE(auth$ok)) return(NULL)
  list(error = auth$error)
}
