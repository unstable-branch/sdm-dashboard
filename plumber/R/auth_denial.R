# Typed auth-denial mechanism for the Plumber router.
#
# Plumber 1.3.x `serve()` executes preroute, route, and serialize steps
# unconditionally: a preroute hook cannot short-circuit a request by returning
# FALSE (its return value is only pass-through plumbing in runHooks), so a
# denial that merely sets res$status/res$body still lets the denied route
# execute and serialize protected data. Denials must therefore ABORT the step
# pipeline by throwing, and the router error handler converts the typed
# condition into the denial response before any route or serializer runs.

# Deny a request: stamp the response and abort the request pipeline with a
# typed condition that sdm_auth_error_handler() turns into the HTTP denial.
sdm_auth_deny <- function(res, status, msg) {
  res$status <- status
  res$body <- msg
  stop(structure(
    list(message = msg, status = status, body = msg),
    class = c("sdm_auth_denial", "error", "condition")
  ))
}

# Router error handler: convert `sdm_auth_denial` conditions into their denial
# response and reproduce plumber's redacted default behavior for genuine errors
# — never serialize error details to the HTTP response unless debug is enabled.
sdm_auth_error_handler <- function(req, res, err) {
  if (inherits(err, "sdm_auth_denial")) {
    res$serializer <- plumber::serializer_unboxed_json()
    res$status <- err$status
    return(err$body)
  }
  res$serializer <- plumber::serializer_unboxed_json()
  # Match plumber's default handler observability: the raw condition goes to
  # the process log, never to the response body.
  print(err)
  if (identical(res$status, 200L)) {
    res$status <- 500L
    err_body <- list(error = "500 - Internal server error")
  } else {
    err_body <- list(error = "Internal error")
  }
  debug <- tryCatch(
    is.function(req$pr$getDebug) && isTRUE(req$pr$getDebug()),
    error = function(e) FALSE
  )
  if (debug) err_body["message"] <- as.character(err)
  err_body
}