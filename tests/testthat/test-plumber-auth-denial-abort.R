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

# Handler-level regression (review round 2): the real model/targets handlers
# previously "denied" by setting req$res$status <- 403L and RETURNING a body.
# Under plumber 1.3.3 that is a no-op short-circuit: serve() serializes the
# returned FORBIDDEN body with status 200 and the denied request never aborts.
# The handlers must throw the typed sdm_auth_denial condition instead, so the
# router error handler converts it to 403 before any serializer runs and no
# body parsing / downstream work executes on denial.
test_that("real handle_model_run denial aborts serve() with 403 and no handler body", {
  skip_if_not_installed("plumber")
  skip_if_not_installed("digest")
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)
  # get_hdr normally comes from run_server.R (which sources auth_denial.R);
  # replicate its header lookup so the real handler code can resolve headers.
  assign("get_hdr", function(req, name) {
    hdrs <- req$HEADERS
    if (is.null(hdrs) || length(hdrs) == 0L) return(NULL)
    name_lower <- tolower(name)
    for (h in names(hdrs)) if (tolower(h) == name_lower) return(hdrs[[h]])
    NULL
  }, envir = env)
  if (!exists("%||%", envir = env, inherits = FALSE)) {
    assign("%||%", function(x, y) if (is.null(x)) y else x, envir = env)
  }
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = env)

  nonce_dir <- file.path(tempdir(), paste0("sdm-nonce-test-", as.integer(Sys.time())))
  # Save/restore env manually (withr is not a declared dependency of this repo).
  prev_key <- Sys.getenv("PLUMBER_EXECUTION_KEY")
  prev_nonce_dir <- Sys.getenv("SDM_EXECUTION_NONCE_DIR")
  on.exit({
    do.call(Sys.setenv, as.list(c(PLUMBER_EXECUTION_KEY = prev_key, SDM_EXECUTION_NONCE_DIR = prev_nonce_dir)))
  }, add = TRUE)
  Sys.setenv(PLUMBER_EXECUTION_KEY = "synthetic-test-execution-key", SDM_EXECUTION_NONCE_DIR = nonce_dir)

  handler_calls <- 0L
  pr <- plumber::pr()
  pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))
  pr$setErrorHandler(env$sdm_auth_error_handler)
  # Mirrors the real POST /api/v1/models/run wiring in plumber.R.
  pr$handle("POST", "/api/v1/models/run", function(req) {
    env$handle_model_run(req, app_dir = project_root)
  })

  req <- new.env(parent = emptyenv())
  req$REQUEST_METHOD <- "POST"
  req$PATH_INFO <- "/api/v1/models/run"
  req$HEADERS <- list()
  req$pr <- pr
  req$rook.input <- list(
    read = function() charToRaw('{"species":"synthetic","model_id":"glm","occurrence_file":"synthetic.csv"}'),
    read_lines = function() '{"species":"synthetic","model_id":"glm","occurrence_file":"synthetic.csv"}',
    rewind = function() NULL
  )
  res <- plumber:::PlumberResponse$new()
  pr$serve(req, res)

  body <- as.character(res$body)
  testthat::expect_equal(res$status, 403L,
    info = "handler-level attestation denial must abort serve() with 403, not serialize with 200")
  testthat::expect_match(body, "Canonical execution attestation required", fixed = TRUE)
  testthat::expect_false(grepl("synthetic.csv|PROTECTED_DATA|manifest_path", body),
    info = "denied response must never contain handler or payload data")
  # The denial throws before body parsing/downstream dispatch: no execution
  # nonce may have been recorded (zero side effects on denial).
  nonces <- if (dir.exists(nonce_dir)) list.dirs(nonce_dir, recursive = FALSE) else character(0)
  testthat::expect_length(nonces, 0L,
    info = "denied request must record no execution nonce (no side effects)")
})

test_that("real handle_targets_run denial aborts serve() with 403 and no handler body", {
  skip_if_not_installed("plumber")
  skip_if_not_installed("digest")
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)
  assign("get_hdr", function(req, name) {
    hdrs <- req$HEADERS
    if (is.null(hdrs) || length(hdrs) == 0L) return(NULL)
    name_lower <- tolower(name)
    for (h in names(hdrs)) if (tolower(h) == name_lower) return(hdrs[[h]])
    NULL
  }, envir = env)
  if (!exists("%||%", envir = env, inherits = FALSE)) {
    assign("%||%", function(x, y) if (is.null(x)) y else x, envir = env)
  }
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = env)

  prev_key <- Sys.getenv("PLUMBER_EXECUTION_KEY")
  on.exit(do.call(Sys.setenv, as.list(c(PLUMBER_EXECUTION_KEY = prev_key))), add = TRUE)
  Sys.setenv(PLUMBER_EXECUTION_KEY = "synthetic-test-execution-key")

  pr <- plumber::pr()
  pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))
  pr$setErrorHandler(env$sdm_auth_error_handler)
  pr$handle("POST", "/api/v1/targets/run", function(req) {
    env$handle_targets_run(req, app_dir = project_root)
  })

  req <- new.env(parent = emptyenv())
  req$REQUEST_METHOD <- "POST"
  req$PATH_INFO <- "/api/v1/targets/run"
  req$HEADERS <- list()
  req$pr <- pr
  req$rook.input <- list(
    read = function() charToRaw('{"configs":[{"species":"synthetic"}]}'),
    read_lines = function() '{"configs":[{"species":"synthetic"}]}',
    rewind = function() NULL
  )
  res <- plumber:::PlumberResponse$new()
  pr$serve(req, res)

  body <- as.character(res$body)
  testthat::expect_equal(res$status, 403L,
    info = "targets handler attestation denial must abort serve() with 403")
  testthat::expect_match(body, "Canonical execution attestation required", fixed = TRUE)
  testthat::expect_false(grepl("configs|synthetic", body),
    info = "denied targets response must never contain handler or payload data")
})