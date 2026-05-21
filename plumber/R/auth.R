# Plumber API Key Authentication Middleware
# Validates X-API-Key header against PostgreSQL api_keys table

library(httr)

#' Validate an API key against the database
#' @param api_key The raw API key from X-API-Key header
#' @param app_dir Application directory for DB config
#' @return List with user_id if valid, NULL otherwise
validate_api_key <- function(api_key, app_dir = NULL) {
  if (is.null(api_key) || !nzchar(api_key)) {
    return(NULL)
  }

  # Resolve app_dir
  if (is.null(app_dir)) {
    app_dir <- if (dir.exists("/app/R")) "/app" else normalizePath(file.path(getwd(), ".."), winslash = "/")
  }

  # Get DB config from environment or .env
  db_url <- Sys.getenv("DATABASE_URL", "")
  if (!nzchar(db_url)) {
    env_file <- file.path(app_dir, ".env")
    if (file.exists(env_file)) {
      lines <- readLines(env_file, warn = FALSE)
      for (line in lines) {
        if (grepl("^DATABASE_URL=", line)) {
          db_url <- sub("^DATABASE_URL=", "", line)
          break
        }
      }
    }
  }

  if (!nzchar(db_url)) {
    warning("DATABASE_URL not set, cannot validate API key")
    return(NULL)
  }

  # Hash the incoming API key (same as Hono's auth middleware)
  key_hash <- digest::digest(api_key, algo = "sha256", serialize = FALSE)

  # Connect and query
  tryCatch({
    con <- DBI::dbConnect(
      RPostgres::Postgres(),
      url = db_url
    )
    on.exit(DBI::dbDisconnect(con), add = TRUE)

    query <- sprintf(
      "SELECT u.id, u.email, u.name, u.role, ak.created_at as key_created
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1
         AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
       LIMIT 1",
      key_hash
    )

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
  # Open endpoints: health, ready, list endpoints
  open_patterns <- c(
    "^/health$",
    "^/ready$",
    "^/api/v1/models/runs$",
    "^/api/v1/climate/scenarios$",
    "^/api/v1/config/defaults$",
    "^/api/v1/models$",
    "^/api/v1/future/scenarios$",
    "^/api/v1/ecology/[^/]+$",
    "^/api/v1/ecology/[^/]+/eoo-aoo$",
    "^/api/v1/ecology/[^/]+/aoa$",
    "^/api/v1/ecology/[^/]+/report$",
    "^/api/v1/diagnostics/"
  )

  for (pattern in open_patterns) {
    if (grepl(pattern, path)) {
      return(FALSE)
    }
  }
  TRUE
}

#' Plumber request filter to enforce API key auth on computation endpoints
#' @param req Plumber request object
#' @param res Plumber response object
plumber_auth_filter <- function(req, res) {
  path <- req$PATH

  # Skip auth for open endpoints
  if (!requires_auth(path)) {
    return(NULL)
  }

  # Get API key from header
  api_key <- req$HEADERS[["x-api-key"]]

  # Also accept X-Hono-Internal for requests proxied from Hono with valid JWT
  hono_internal <- req$HEADERS[["x-hono-internal"]]

  if (!is.null(hono_internal) && nzchar(hono_internal)) {
    # Hono has already authenticated this request (JWT path)
    # Verify the internal token matches our configured internal key
    internal_key <- Sys.getenv("PLUMBER_INTERNAL_KEY", "")
    if (nzchar(internal_key) && identical(hono_internal, internal_key)) {
      # Extract user_id from X-Forwarded-User if present
      forwarded_user <- req$HEADERS[["x-forwarded-user"]]
      if (!is.null(forwarded_user) && nzchar(forwarded_user)) {
        req$user_id <- forwarded_user
      }
      return(NULL)  # Allow through
    }
    # Fall through to API key check if internal key doesn't match
  }

  if (is.null(api_key) || !nzchar(api_key)) {
    res$status <- 401L
    res$body <- '{"error":"API key required. Provide X-API-Key header."}'
    return(res)
  }

  # Validate API key
  user_info <- validate_api_key(api_key)

  if (is.null(user_info)) {
    res$status <- 401L
    res$body <- '{"error":"Invalid or expired API key."}'
    return(res)
  }

  # Attach user info to request for downstream handlers
  req$user_id <- user_info$user_id
  req$user_email <- user_info$email
  req$user_role <- user_info$role

  NULL  # Continue to handler
}