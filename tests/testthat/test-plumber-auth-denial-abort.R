# tests/testthat/test-plumber-auth-denial-abort.R
#
# Built-runtime regression: a preroute auth denial must abort the router so the
# denied route never executes and never serializes protected data.
#
# Root cause (verified against plumber 1.3.3 source): `serve()` runs preroute,
# route, and serialize steps unconditionally (R/async.R runSteps always
# continues; R/hookable.R runHooks only threads hook return values through as
# `value`), so a preroute hook that "returns FALSE" after setting res$status
# does NOT stop the request — the route handler runs and the handler body's
# protected payload was serialized with the denial status attached.
#
# The denial therefore throws a typed `sdm_auth_denial` condition from the
# preroute hook (plumber/R/auth_denial.R), which short-circuits the step
# pipeline via the router error handler (pr$setErrorHandler) before routeStep
# and serializeSteps run.

test_that("sdm_auth_deny stamps the response and throws a typed denial condition", {
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)

  res <- new.env(parent = emptyenv())
  expect_error(
    env$sdm_auth_deny(res, 401L, '{"error":"Unauthorized"}'),
    class = "sdm_auth_denial"
  )
  expect_equal(res$status, 401L)
  expect_equal(res$body, '{"error":"Unauthorized"}')
})

test_that("a preroute denial aborts the router before the denied route executes", {
  skip_if_not_installed("plumber")
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)

  handler_calls <- 0L
  pr <- plumber::pr()
  pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))
  pr$setErrorHandler(env$sdm_auth_error_handler)
  pr$registerHook("preroute", function(data, req, res) {
    env$sdm_auth_deny(res, 401L, '{"error":"Unauthorized"}')
  })
  pr$handle("GET", "/protected", function() {
    handler_calls <<- handler_calls + 1L
    list(secret = "PROTECTED_DATA", manifest_path = "/app/secret/manifest.json")
  })

  req <- new.env(parent = emptyenv())
  req$REQUEST_METHOD <- "GET"
  req$PATH_INFO <- "/protected"
  req$HEADERS <- list()
  req$pr <- pr
  res <- plumber:::PlumberResponse$new()
  pr$serve(req, res)

  testthat::expect_equal(res$status, 401L,
    info = "denied request must be rejected with the denial status")
  testthat::expect_equal(as.character(res$body), '{"error":"Unauthorized"}',
    info = "denied request must not serialize protected route output")
  testthat::expect_false(grepl("PROTECTED_DATA|manifest_path", as.character(res$body), fixed = TRUE),
    info = "denied response body must not contain handler output")
  testthat::expect_equal(handler_calls, 0L,
    info = "denied route handler must never execute (zero reads/spawns on denial)")
})

test_that("a non-denied request still executes its route normally", {
  skip_if_not_installed("plumber")
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)

  handler_calls <- 0L
  pr <- plumber::pr()
  pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))
  pr$setErrorHandler(env$sdm_auth_error_handler)
  pr$registerHook("preroute", function(data, req, res) {
    path <- req$PATH_INFO %||% req$PATH
    if (!is.null(path) && path == "/open") return(NULL)
    env$sdm_auth_deny(res, 401L, '{"error":"Unauthorized"}')
  })
  pr$handle("GET", "/open", function() {
    handler_calls <<- handler_calls + 1L
    list(ok = TRUE)
  })

  req <- new.env(parent = emptyenv())
  req$REQUEST_METHOD <- "GET"
  req$PATH_INFO <- "/open"
  req$HEADERS <- list()
  req$pr <- pr
  req$rook.input <- list(read = function() raw(0), read_lines = function() character(0), rewind = function() NULL)
  res <- plumber:::PlumberResponse$new()
  pr$serve(req, res)

  testthat::expect_equal(res$status, 200L)
  testthat::expect_equal(handler_calls, 1L)
})

test_that("genuine route crashes stay redacted through the denial error handler", {
  skip_if_not_installed("plumber")
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)

  pr <- plumber::pr()
  pr$setErrorHandler(env$sdm_auth_error_handler)
  pr$handle("GET", "/boom", function() stop("handler detail provider=https://secret.example"))

  req <- new.env(parent = emptyenv())
  req$REQUEST_METHOD <- "GET"
  req$PATH_INFO <- "/boom"
  req$HEADERS <- list()
  req$pr <- pr
  req$rook.input <- list(read = function() raw(0), read_lines = function() character(0), rewind = function() NULL)
  res <- plumber:::PlumberResponse$new()
  pr$serve(req, res)

  testthat::expect_equal(res$status, 500L)
  body <- as.character(res$body)
  testthat::expect_match(body, "Internal server error", fixed = TRUE)
  testthat::expect_false(grepl("secret.example", body, fixed = TRUE),
    info = "error details must not reach the response without debug mode")
})