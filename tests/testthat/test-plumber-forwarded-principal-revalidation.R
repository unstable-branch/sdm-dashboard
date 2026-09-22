# tests/testthat/test-plumber-forwarded-principal-revalidation.R
#
# Built-runtime regression for the AGENTS.md current-principal contract at the
# Plumber boundary (review round 3, CRITICAL finding): a forwarded identity
# (X-Forwarded-User / X-Forwarded-Role behind the shared internal secret) must
# be rechecked against CURRENT database state before any protected handling.
# Deleted / nonexistent users and stale roles are denied; genuine DB
# unavailability fails closed (503); a denial aborts the router before the
# protected handler executes.
#
# Assertions go through the local `.t` indirection so the file runs under real
# testthat (CI: `Rscript tests/testthat.R`) and under the minimal shim used to
# execute it inside the pinned plumber acceptance image (the shim defines
# expect_* / test_path / skip_if_not_installed in the sourcing environment).
# The indirection prefers the SHIM's counter-based expects when they are
# visible, so pass/fail accounting works in both runners.
.t <- if (requireNamespace("testthat", quietly = TRUE)) getNamespace("testthat") else {
  list(expect_true = function(object, info = NULL) stopifnot(isTRUE(object)),
       expect_false = function(object, info = NULL) stopifnot(!isTRUE(object)),
       expect_equal = function(object, expected, info = NULL) stopifnot(isTRUE(all.equal(object, expected))),
       expect_match = function(object, regexp, fixed = FALSE, info = NULL) stopifnot(isTRUE(grepl(regexp, as.character(object), fixed = fixed))))
}
if (!requireNamespace("testthat", quietly = TRUE) && exists("expect_true", envir = environment(), inherits = TRUE)) {
  # Rebind to the shim's counter-based assertions for accurate accounting.
  .t$expect_true <- expect_true
  .t$expect_false <- expect_false
  .t$expect_equal <- expect_equal
  .t$expect_match <- expect_match
}

test_that("sdm_validate_forwarded_principal rejects malformed identities without any DB access", {
  project_root <- normalizePath(file.path(test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)

  for (bad in list(c("", "editor"),
                   c("not-a-uuid", "admin"),
                   c("00000000-0000-0000-0000-0000000000", "editor"),
                   c("00000000-0000-0000-0000-0000000000aa", "superuser"),
                   c("00000000-0000-0000-0000-0000000000aa", ""),
                   list(NULL, NULL))) {
    verdict <- env$sdm_validate_forwarded_principal(bad[[1]], bad[[2]], pool = NULL, app_dir = project_root)
    .t$expect_false(isTRUE(verdict$ok),
      info = paste("malformed identity must deny:", paste(unlist(bad), collapse = "/")))
    .t$expect_equal(verdict$status, 401L)
  }
})

test_that("sdm_validate_forwarded_principal fails closed when the principal store is unavailable", {
  project_root <- normalizePath(file.path(test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)

  prev <- Sys.getenv("DATABASE_URL")
  on.exit(if (nzchar(prev)) Sys.setenv(DATABASE_URL = prev) else Sys.unsetenv("DATABASE_URL"), add = TRUE)

  # No DATABASE_URL and no pool: the principal store cannot be consulted, so
  # the request must be denied closed rather than trusted.
  Sys.unsetenv("DATABASE_URL")
  verdict <- env$sdm_validate_forwarded_principal(
    "00000000-0000-0000-0000-0000000000aa", "editor", pool = NULL, app_dir = project_root)
  .t$expect_false(isTRUE(verdict$ok))
  .t$expect_equal(verdict$status, 503L)

  # A DATABASE_URL that cannot connect (error path) also denies closed.
  Sys.setenv(DATABASE_URL = "postgresql://127.0.0.1:1/no_such_db")
  verdict2 <- env$sdm_validate_forwarded_principal(
    "00000000-0000-0000-0000-0000000000aa", "editor", pool = NULL, app_dir = project_root)
  .t$expect_false(isTRUE(verdict2$ok))
  .t$expect_equal(verdict2$status, 503L)
})

test_that("sdm_validate_forwarded_principal denies a deleted (absent) user", {
  project_root <- normalizePath(file.path(test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)

  # Deleted-user world: the current-principal lookup returns zero rows.
  queries <- character(0)
  verdict <- env$sdm_validate_forwarded_principal(
    "00000000-0000-0000-0000-0000000000bb", "editor", app_dir = project_root,
    query_fn = function(uid) {
      queries <<- c(queries, uid)
      data.frame(role = character(0))
    })
  .t$expect_false(isTRUE(verdict$ok))
  .t$expect_equal(verdict$status, 401L)
  .t$expect_match(verdict$message, "no longer exists", fixed = TRUE)
  .t$expect_equal(queries, "00000000-0000-0000-0000-0000000000bb",
    info = "the lookup must have been issued for exactly the forwarded id")
})

test_that("a stale forwarded role is denied even when the user still exists", {
  project_root <- normalizePath(file.path(test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)

  # User exists but their CURRENT role is viewer, while the request claims editor.
  verdict <- env$sdm_validate_forwarded_principal(
    "00000000-0000-0000-0000-0000000000cc", "editor", app_dir = project_root,
    query_fn = function(uid) data.frame(role = "viewer"))
  .t$expect_false(isTRUE(verdict$ok))
  .t$expect_equal(verdict$status, 401L)
  .t$expect_match(verdict$message, "Stale forwarded principal", fixed = TRUE)

  # A forwarded identity matching current storage is the normal happy path.
  verdict_ok <- env$sdm_validate_forwarded_principal(
    "00000000-0000-0000-0000-0000000000cc", "viewer", app_dir = project_root,
    query_fn = function(uid) data.frame(role = "viewer"))
  .t$expect_true(isTRUE(verdict_ok$ok),
    info = "a forwarded identity matching current storage must be accepted")
})

test_that("preroute denies a deleted forwarded principal before the protected handler runs", {
  skip_if_not_installed("plumber")
  project_root <- normalizePath(file.path(test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)
  sys.source(file.path(project_root, "plumber", "R", "auth_denial.R"), envir = env)

  deleted_user <- "00000000-0000-0000-0000-0000000000bb"
  handler_calls <- 0L

  pr <- plumber::pr()
  pr$setSerializer(plumber::serializer_json(auto_unbox = TRUE, na = "null"))
  pr$setErrorHandler(env$sdm_auth_error_handler)
  pr$registerHook("preroute", function(data, req, res) {
    # Mirrors run_server.R's internal-principal branch with the real validator.
    internal_key <- "synthetic-internal-key"
    fwd_user <- req$HEADERS[["x-forwarded-user"]]
    fwd_role <- req$HEADERS[["x-forwarded-role"]]
    if (!identical(req$HEADERS[["x-hono-internal"]], internal_key)) {
      env$sdm_auth_deny(res, 401L, '{"error":"Internal system token required. Direct access not allowed."}')
    }
    verdict <- env$sdm_validate_forwarded_principal(
      fwd_user, fwd_role, app_dir = project_root,
      query_fn = function(uid) data.frame(role = character(0)))  # deleted
    if (!isTRUE(verdict$ok)) {
      env$sdm_auth_deny(res, verdict$status, verdict$message)
    }
    NULL
  })
  pr$handle("GET", "/api/v1/protected", function(req) {
    handler_calls <<- handler_calls + 1L
    list(secret = "PROTECTED_DATA", manifest_path = "/app/secret/manifest.json")
  })

  req <- new.env(parent = emptyenv())
  req$REQUEST_METHOD <- "GET"
  req$PATH_INFO <- "/api/v1/protected"
  req$HEADERS <- list(
    "x-hono-internal" = "synthetic-internal-key",
    "x-forwarded-user" = deleted_user,
    "x-forwarded-role" = "editor"
  )
  req$pr <- pr
  req$rook.input <- list(read = function() raw(0), read_lines = function() character(0), rewind = function() NULL)
  res <- plumber:::PlumberResponse$new()
  pr$serve(req, res)

  body <- as.character(res$body)
  .t$expect_equal(res$status, 401L,
    info = "deleted forwarded principal must be denied, never accepted")
  .t$expect_match(body, "no longer exists", fixed = TRUE)
  .t$expect_false(grepl("PROTECTED_DATA|manifest_path", body),
    info = "denied response must never contain handler output")
  .t$expect_equal(handler_calls, 0L,
    info = "deleted principal must never reach a protected handler")
})
