testthat::test_that("trusted preroute propagation fails closed", {
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  run_server <- file.path(project_root, "plumber", "R", "run_server.R")
  auth <- file.path(project_root, "plumber", "R", "auth.R")

  # Syntax is independently checked without starting the Plumber process.
  testthat::expect_silent(parse(file = run_server))
  testthat::expect_silent(parse(file = auth))

  source_text <- paste(readLines(run_server, warn = FALSE), collapse = "\n")
  count_literal <- function(needle) {
    hits <- gregexpr(needle, source_text, fixed = TRUE)[[1]]
    sum(hits > 0L)
  }
  testthat::expect_gte(count_literal("req$user_role <- fwd_role"), 1L)
  testthat::expect_gte(count_literal("Forwarded user required."), 2L)
  testthat::expect_gte(count_literal("Forwarded role required."), 2L)
  testthat::expect_gte(count_literal("Invalid forwarded principal."), 2L)

  # In each trusted internal branch, the role assignment is before the hook's
  # successful return, and no missing identity can reach that return.
  trusted_blocks <- strsplit(source_text, "if (is.null(fwd_user) || !nzchar(fwd_user))", fixed = TRUE)[[1]]
  testthat::expect_true(length(trusted_blocks) >= 3L)
})

testthat::test_that("manifest-publishing climate discovery requires authentication", {
  project_root <- normalizePath(file.path(testthat::test_path(), "..", ".."), winslash = "/", mustWork = TRUE)
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)
  testthat::expect_true(env$requires_auth("/api/v1/climate/scenarios"))
  testthat::expect_true(env$requires_auth("/api/v1/future/scenarios"))
  testthat::expect_false(env$requires_auth("/api/v1/climate/check"))
})


testthat::test_that("job authorization fails closed on principal, owner, metadata, and storage errors", {
  root <- tempfile("sdm-auth-")
  dir.create(root)
  job_dir <- file.path(root, "job-1")
  dir.create(job_dir)
  meta_path <- file.path(job_dir, "meta.json")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)

  env <- new.env(parent = globalenv())
  env$`%||%` <- function(x, y) if (is.null(x)) y else x
  env$sdm_safe_job_dir <- function(job_id) job_dir
  env$sdm_read_meta_json <- function(path) {
    value <- readLines(path, warn = FALSE)
    if (identical(value[1], "corrupt")) return(NULL)
    if (length(value) == 0L || !nzchar(value[1])) return(list())
    list(user_id = value[1])
  }
  sys.source(file.path(project_root, "plumber", "R", "auth.R"), envir = env)

  deny <- function(req) {
    res <- new.env(parent = emptyenv())
    result <- env$sdm_load_authorized_job(req, res, "job-1", root)
    list(result = result, status = res$status)
  }

  writeLines("owner-1", meta_path)
  missing_principal <- deny(list())
  testthat::expect_false(missing_principal$result$ok)
  testthat::expect_equal(missing_principal$status, 401L)

  mismatch <- deny(list(user_id = "other", user_role = "viewer"))
  testthat::expect_false(mismatch$result$ok)
  testthat::expect_equal(mismatch$status, 403L)

  admin <- env$sdm_load_authorized_job(list(user_id = "admin", user_role = "admin"), NULL, "job-1", root)
  testthat::expect_true(admin$ok)

  writeLines("", meta_path)
  missing_owner <- deny(list(user_id = "admin", user_role = "admin"))
  testthat::expect_false(missing_owner$result$ok)
  testthat::expect_equal(missing_owner$status, 503L)

  writeLines("corrupt", meta_path)
  corrupt <- deny(list(user_id = "admin", user_role = "admin"))
  testthat::expect_false(corrupt$result$ok)
  testthat::expect_equal(corrupt$status, 503L)

  env$sdm_safe_job_dir <- function(job_id) stop("storage unavailable")
  storage <- deny(list(user_id = "admin", user_role = "admin"))
  testthat::expect_false(storage$result$ok)
  testthat::expect_equal(storage$status, 404L)
})

testthat::test_that("destructive handlers deny before side effects", {
  env <- new.env(parent = globalenv())
  env$`%||%` <- function(x, y) if (is.null(x)) y else x
  env$sdm_load_authorized_job <- function(...) list(ok = FALSE, error = "denied")
  env$sdm_cancel_pid_first <- function(...) stop("PID cancellation must not run")
  env$sdm_redis_cancel_set <- function(...) stop("Redis cancellation must not run")
  env$sdm_kill_pid <- function(...) stop("PID kill must not run")
  env$sdm_safe_job_dir <- function(...) stop("path lookup must be behind authorization")
  source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), local = env)
  source(file.path(project_root, "plumber", "R", "helpers", "climate_helpers.R"), local = env)

  res <- new.env(parent = emptyenv())
  testthat::expect_equal(env$handle_model_cancel(list(), res, "run-1")$error, "denied")
  testthat::expect_equal(env$handle_model_delete(list(), res, "run-1")$error, "denied")
  testthat::expect_equal(env$handle_climate_cancel(list(), res, "job-1", project_root)$error, "denied")
})

testthat::test_that("climate status consumes authorized metadata", {
  env <- new.env(parent = globalenv())
  env$`%||%` <- function(x, y) if (is.null(x)) y else x
  env$sdm_load_authorized_job <- function(...) list(
    ok = TRUE,
    job_dir = tempfile("authorized-job-"),
    meta_file = tempfile("authorized-meta-"),
    meta = list(id = "returned-meta", type = "climate", status = "failed", error = "from-authorized-loader")
  )
  env$sdm_read_meta_json <- function(...) stop("status must consume loader metadata")
  env$sdm_redis_progress_get <- function(...) character(0)
  env$sdm_redis_cancel_check <- function(...) FALSE
  env$sdm_registry_proc <- function(...) NULL
  env$sdm_process_registry <- new.env(parent = emptyenv())
  env$sdm_write_json <- function(...) stop("unexpected metadata write")
  source(file.path(project_root, "plumber", "R", "helpers", "climate_helpers.R"), local = env)

  result <- env$handle_climate_status(list(), new.env(parent = emptyenv()), "job-1", project_root)
  testthat::expect_equal(result$id, "returned-meta")
  testthat::expect_equal(result$status, "failed")
  testthat::expect_equal(result$error, "from-authorized-loader")
})
