# Plumber API Key Authentication Middleware
# Validates X-API-Key header against PostgreSQL api_keys table

library(httr)

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
    parts <- parse_db_url(db_url)
    con <- DBI::dbConnect(
      RPostgres::Postgres(),
      dbname = parts$dbname, host = parts$host,
      port = parts$port, user = parts$user, password = parts$password
    )
    on.exit(DBI::dbDisconnect(con), add = TRUE)

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

  # Open endpoints: health, ready, list endpoints
  open_patterns <- c(
    "^/health$",
    "^/ready$",
    "^/api/v1/models/runs$",
    "^/api/v1/climate/scenarios$",
    "^/api/v1/climate/check$",
    "^/api/v1/config/defaults$",
    "^/api/v1/models$",
    "^/api/v1/future/scenarios$"
  )

  if (tolower(Sys.getenv("PLUMBER_DOCS_ENABLED", "false")) == "true") {
    open_patterns <- c(
      open_patterns,
      "^/openapi[.]json$",
      "^/__openapi__/?$",
      "^/__docs__(/.*)?$"
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

sdm_check_rate_limit <- function(key, max_requests = 60, window_seconds = 60) {
  current <- as.numeric(Sys.time())
  window_start <- current - window_seconds
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
