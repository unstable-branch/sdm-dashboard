#!/usr/bin/env Rscript
# Plumber server startup with authentication middleware

app_dir <- if (dir.exists("/app/R")) "/app" else normalizePath(file.path(getwd(), ".."), winslash = "/")

# Load authentication middleware
source(file.path(app_dir, "plumber", "R", "auth.R"), local = FALSE)

# Create the plumber router
pr <- plumber::pr(app_dir)

# The filter is applied automatically via source above - however we need
# to handle the filter at router creation time. The cleanest approach in Plumber
# is to use a custom router that wraps the existing plumber.R.

# Alternative: source the plumber.R file inside the router context
# by setting a global app_dir that auth.R can access
assign("app_dir", app_dir, envir = .GlobalEnv)

# Register the global filter using plumber's filter mechanism
# This applies to all endpoints
pr <- plumber::pr_filter(pr, "authenticate", function(req, res) {
  path <- req$PATH

  if (!requires_auth(path)) {
    return(NULL)
  }

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
})

# Now load the plumber.R routes into this router
source(file.path(app_dir, "plumber", "R", "plumber.R"), local = FALSE)

# Run the server
plumber::pr_run(pr, host = "0.0.0.0", port = 8000)