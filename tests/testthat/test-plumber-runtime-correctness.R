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

testthat::test_that("model submission keys are stable across BullMQ retries", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)

  run_id <- "3c81b7fa-2f70-4c15-9b01-7e406ff44d99"
  first <- helper_env$sdm_model_request_job_id(list(runId = run_id))
  second <- helper_env$sdm_model_request_job_id(list(runId = run_id))

  testthat::expect_identical(first, paste0("run-", run_id))
  testthat::expect_identical(second, first)
})

testthat::test_that("model submission claims reject duplicates while initialising and resume once persisted", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)

  job_dir <- tempfile("sdm-model-claim-")
  dir.create(job_dir)
  meta_file <- file.path(job_dir, "meta.json")
  helper_env$sdm_write_json(
    list(id = "run-stable", user_id = "user-1", status = "pending", process_pid = NULL),
    meta_file
  )

  initialising <- helper_env$sdm_existing_model_submission(job_dir, "user-1")
  testthat::expect_true(isTRUE(initialising$incomplete_claim))

  helper_env$sdm_write_json(
    list(id = "run-stable", user_id = "user-1", status = "running", process_pid = 123L),
    meta_file
  )
  existing <- helper_env$sdm_existing_model_submission(job_dir, "user-1")
  testthat::expect_identical(existing$job_id, "run-stable")
  testthat::expect_identical(existing$status, "running")
  testthat::expect_true(isTRUE(helper_env$sdm_existing_model_submission(job_dir, "user-2")$access_denied))
  unlink(job_dir, recursive = TRUE)
})

testthat::test_that("shared JSON metadata preserves null PIDs and empty PIDs are safe", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)

  meta_file <- tempfile("sdm-null-pid-", fileext = ".json")
  on.exit(unlink(meta_file), add = TRUE)
  helper_env$sdm_write_json(list(id = "run-null", status = "pending", process_pid = NULL), meta_file)
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

  testthat::expect_null(meta$process_pid)
  testthat::expect_false(helper_env$sdm_check_process_alive("run-null", list(process_pid = list())))
  testthat::expect_true(is.na(helper_env$sdm_normalize_pid(list())))
  testthat::expect_true(is.na(helper_env$sdm_normalize_pid(c(1L, 2L))))
  testthat::expect_identical(helper_env$sdm_normalize_pid(list(123L)), 123L)
})

testthat::test_that("model status handlers normalize empty process PIDs", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)
  helper_env$sdm_redis_progress_clear <- function(...) NULL
  helper_env$sdm_redis_cancel_clear <- function(...) NULL
  helper_env$sdm_redis_cancel_check <- function(...) FALSE

  app_dir <- tempfile("sdm-empty-pids-")
  on.exit(unlink(app_dir, recursive = TRUE), add = TRUE)
  helper_env$app_dir <- app_dir

  for (status in c("pending", "loading", "running")) {
    job_id <- paste0("empty-pid-", status)
    job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
    dir.create(job_dir, recursive = TRUE)
    helper_env$sdm_write_json(
      list(id = job_id, status = status, process_pid = list()),
      file.path(job_dir, "meta.json")
    )
    writeLines(character(), file.path(job_dir, "stderr.log"))

    response <- helper_env$handle_model_status(new.env(parent = emptyenv()), job_id)
    testthat::expect_identical(response$status, "failed", info = status)
  }

  async_id <- "empty-pid-async"
  async_dir <- file.path(app_dir, "outputs", "jobs", async_id)
  dir.create(async_dir, recursive = TRUE)
  helper_env$sdm_write_json(
    list(id = async_id, status = "running", process_pid = list()),
    file.path(async_dir, "meta.json")
  )
  async_response <- helper_env$handle_async_status(new.env(parent = emptyenv()), async_id, app_dir)
  testthat::expect_identical(async_response$status, "failed")
})

testthat::test_that("cancellation and climate status normalize empty process PIDs", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "climate_helpers.R"), envir = helper_env)
  helper_env$sdm_process_registry <- new.env(parent = emptyenv())
  helper_env$sdm_redis_cancel_set <- function(...) NULL
  helper_env$sdm_redis_cancel_check <- function(...) FALSE
  helper_env$sdm_redis_progress_get <- function(...) NULL

  app_dir <- tempfile("sdm-empty-pid-handlers-")
  on.exit(unlink(app_dir, recursive = TRUE), add = TRUE)
  helper_env$app_dir <- app_dir

  model_id <- "empty-pid-cancel"
  model_dir <- file.path(app_dir, "outputs", "jobs", model_id)
  dir.create(model_dir, recursive = TRUE)
  helper_env$sdm_write_json(
    list(id = model_id, user_id = "user-1", status = "running", process_pid = list()),
    file.path(model_dir, "meta.json")
  )
  cancelled <- helper_env$handle_model_cancel(list(user_id = "user-1"), model_id)
  testthat::expect_identical(cancelled$status, "cancelled")

  climate_id <- "empty-pid-climate"
  climate_dir <- file.path(app_dir, "outputs", "jobs", climate_id)
  dir.create(climate_dir, recursive = TRUE)
  helper_env$sdm_write_json(
    list(id = climate_id, status = "running", process_pid = list()),
    file.path(climate_dir, "meta.json")
  )
  climate <- helper_env$handle_climate_status(new.env(parent = emptyenv()), climate_id, app_dir)
  testthat::expect_identical(climate$status, "failed")
})

testthat::test_that("metadata locks preserve successor ownership and only reclaim dead owners", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)

  meta_file <- tempfile("sdm-lock-owner-", fileext = ".json")
  lock_dir <- paste0(meta_file, ".lock")
  on.exit(unlink(c(meta_file, lock_dir, Sys.glob(paste0(lock_dir, ".stale-*"))), recursive = TRUE), add = TRUE)

  helper_env$sdm_with_meta_lock(meta_file, function() {
    writeLines("successor-token", file.path(lock_dir, "owner"))
  })
  testthat::expect_true(dir.exists(lock_dir))
  testthat::expect_identical(readLines(file.path(lock_dir, "owner")), "successor-token")

  unlink(lock_dir, recursive = TRUE)
  dir.create(lock_dir)
  writeLines("99999999-dead-owner", file.path(lock_dir, "owner"))
  Sys.setFileTime(lock_dir, Sys.time() - 60)
  ran <- FALSE
  helper_env$sdm_with_meta_lock(meta_file, function() ran <<- TRUE, wait_seconds = 1, stale_seconds = 0)
  testthat::expect_true(ran)
  testthat::expect_false(dir.exists(lock_dir))
})

testthat::test_that("metadata locks never steal a stale lock from a live owner", {
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)

  meta_file <- tempfile("sdm-live-lock-", fileext = ".json")
  lock_dir <- paste0(meta_file, ".lock")
  on.exit(unlink(c(meta_file, lock_dir), recursive = TRUE), add = TRUE)
  dir.create(lock_dir)
  writeLines(paste0(Sys.getpid(), "-live-owner"), file.path(lock_dir, "owner"))
  Sys.setFileTime(lock_dir, Sys.time() - 60)

  testthat::expect_error(
    helper_env$sdm_with_meta_lock(meta_file, function() NULL, wait_seconds = 0.03, stale_seconds = 0),
    "Timed out acquiring"
  )
  testthat::expect_true(dir.exists(lock_dir))
})

testthat::test_that("terminal metadata transitions are atomic and first writer wins", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)

  meta_file <- tempfile("sdm-terminal-", fileext = ".json")
  on.exit(unlink(c(meta_file, paste0(meta_file, ".lock")), recursive = TRUE), add = TRUE)
  helper_env$sdm_write_json(list(id = "run-race", status = "running"), meta_file)

  cancelled <- helper_env$sdm_commit_terminal_meta(
    meta_file,
    list(id = "run-race", status = "cancelled", completed_at = "2026-07-14T00:00:00Z")
  )
  late_completion <- helper_env$sdm_commit_terminal_meta(
    meta_file,
    list(id = "run-race", status = "completed", completed_at = "2026-07-14T00:00:01Z")
  )

  testthat::expect_true(cancelled$committed)
  testthat::expect_false(late_completion$committed)
  testthat::expect_identical(late_completion$meta$status, "cancelled")
  testthat::expect_identical(jsonlite::fromJSON(meta_file)$status, "cancelled")
})

testthat::test_that("idempotent cancellation never overwrites completed model artifacts", {
  testthat::skip_if_not_installed("jsonlite")
  helper_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"), envir = helper_env)
  sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = helper_env)
  helper_env$sdm_redis_cancel_set <- function(...) NULL

  app_dir <- tempfile("sdm-cancel-")
  job_id <- "run-completed-test"
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE)
  helper_env$app_dir <- app_dir
  artifact <- file.path(job_dir, "result.tif")
  writeBin(as.raw(c(1, 2, 3)), artifact)
  helper_env$sdm_write_json(
    list(id = job_id, user_id = "user-1", status = "completed", output_files = list(tif = artifact)),
    file.path(job_dir, "meta.json")
  )

  first <- helper_env$handle_model_cancel(list(user_id = "user-1"), job_id)
  second <- helper_env$handle_model_cancel(list(user_id = "user-1"), job_id)
  meta <- jsonlite::fromJSON(file.path(job_dir, "meta.json"), simplifyVector = FALSE)

  testthat::expect_equal(first$status, "completed")
  testthat::expect_equal(second$status, "completed")
  testthat::expect_equal(meta$status, "completed")
  testthat::expect_true(file.exists(artifact))
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
