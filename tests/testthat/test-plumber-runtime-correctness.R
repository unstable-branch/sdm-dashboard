testthat::test_that("database pool startup retries and recovers", {
  pool_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "db_pool.R"), envir = pool_env)

  old_url <- Sys.getenv("DATABASE_URL", unset = NA_character_)
  on.exit(if (is.na(old_url)) Sys.unsetenv("DATABASE_URL") else Sys.setenv(DATABASE_URL = old_url), add = TRUE)
  Sys.setenv(DATABASE_URL = "postgresql://example.invalid/db")

  calls <- 0L
  fake_pool <- structure(list(), class = "Pool")
  result <- pool_env$sdm_connect_db_pool(
    attempts = 3L,
    delay_seconds = 0,
    create_pool = function() {
      calls <<- calls + 1L
      if (calls < 3L) stop("not ready")
      fake_pool
    },
    sleep = function(...) NULL,
    log = function(...) NULL
  )

  testthat::expect_identical(result, fake_pool)
  testthat::expect_equal(calls, 3L)
})

testthat::test_that("missing async jobs set a controlled 404", {
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "jobs_helpers.R"), envir = helper_env)

  res <- new.env(parent = emptyenv())
  req <- list(user_id = "user-1")
  status <- helper_env$handle_job_status(req, res, "missing-job", tempdir())

  testthat::expect_equal(res$status, 404L)
  testthat::expect_equal(status$error, "Job not found")
  testthat::expect_equal(
    helper_env$handle_job_status(req, NULL, "missing-job", tempdir())$error,
    "Job not found"
  )
})

testthat::test_that("crashed async job diagnostics remain pollable", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)
  helper_env$sdm_redis_progress_clear <- function(...) NULL
  helper_env$sdm_redis_cancel_clear <- function(...) NULL
  helper_env$sdm_redis_cancel_check <- function(...) FALSE

  app_dir <- tempfile("sdm-runtime-")
  job_dir <- file.path(app_dir, "outputs", "jobs", "failed-job")
  dir.create(job_dir, recursive = TRUE)
  helper_env$sdm_write_json(
    list(id = "failed-job", status = "running", process_pid = 99999999L),
    file.path(job_dir, "meta.json")
  )
  writeLines("diagnostic detail", file.path(job_dir, "stderr.log"))

  first <- helper_env$handle_async_status(new.env(parent = emptyenv()), "failed-job", app_dir)
  second <- helper_env$handle_async_status(new.env(parent = emptyenv()), "failed-job", app_dir)

  testthat::expect_equal(first$status, "failed")
  testthat::expect_equal(first$error_code, "PROCESS_CRASH")
  testthat::expect_true(dir.exists(job_dir))
  testthat::expect_true(file.exists(file.path(job_dir, "stderr.log")))
  testthat::expect_equal(second$status, "failed")
  testthat::expect_match(second$error, "Process crashed")
  unlink(app_dir, recursive = TRUE)
})

testthat::test_that("DATABASE_URL is converted to explicit RPostgres connection arguments", {
  pool_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "db_pool.R"), envir = pool_env)

  args <- pool_env$sdm_database_connect_args(
    "postgresql://sdm%2Bworker:p%40ss%3Aword@[2001:db8::1]:5544/sdm%2Dplatform?sslmode=require&application_name=plumber"
  )

  testthat::expect_identical(args$user, "sdm+worker")
  testthat::expect_identical(args$password, "p@ss:word")
  testthat::expect_identical(args$host, "2001:db8::1")
  testthat::expect_identical(args$port, 5544L)
  testthat::expect_identical(args$dbname, "sdm-platform")
  testthat::expect_identical(args$sslmode, "require")
  testthat::expect_identical(args$application_name, "plumber")
})

testthat::test_that("DATABASE_URL parser defaults PostgreSQL port and rejects malformed URLs", {
  pool_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "db_pool.R"), envir = pool_env)

  args <- pool_env$sdm_database_connect_args("postgres://user:pass@postgres/database")
  testthat::expect_identical(args$host, "postgres")
  testthat::expect_identical(args$port, 5432L)
  testthat::expect_identical(args$dbname, "database")
  testthat::expect_error(pool_env$sdm_database_connect_args("postgres://missing-host"), "Cannot parse")
})
