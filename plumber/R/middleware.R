# Plumber middleware registration
# Source this before defining API routes

#' @filter authenticate
#' @param req Plumber request
#' @param res Plumber response
#' @return NULL to continue, or response object to short-circuit
function(req, res) {
  source(file.path(app_dir, "plumber", "R", "auth.R"), local = TRUE)

  path <- req$PATH_INFO %||% req$PATH

  # Skip auth for open endpoints (read-only, no state change)
  if (!requires_auth(path)) {
    return(NULL)
  }

  # Check for Hono internal proxy header (requests already authenticated by Hono JWT)
  internal_key <- Sys.getenv("PLUMBER_INTERNAL_KEY", "")
  if (nzchar(internal_key)) {
    hono_internal <- req$HEADERS[["x-hono-internal"]]
    if (!is.null(hono_internal) && identical(hono_internal, internal_key)) {
      forwarded_user <- req$HEADERS[["x-forwarded-user"]]
      if (!is.null(forwarded_user) && nzchar(forwarded_user)) {
        req$user_id <- forwarded_user
      }
      return(NULL)
    }
  }

  # Check API key
  api_key <- req$HEADERS[["x-api-key"]]
  if (is.null(api_key) || !nzchar(api_key)) {
    res$status <- 401L
    res$body <- '{"error":"API key required. Provide X-API-Key header."}'
    return(res)
  }

  user_info <- validate_api_key(api_key, app_dir)
  if (is.null(user_info)) {
    res$status <- 401L
    res$body <- '{"error":"Invalid or expired API key."}'
    return(res)
  }

  req$user_id <- user_info$user_id
  req$user_email <- user_info$email
  req$user_role <- user_info$role

  NULL
}