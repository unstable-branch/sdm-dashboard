# Tests for handle_climate_cancel error handling.
#
# Before this fix, handle_climate_cancel referenced res$status to set a 503 on
# meta.json read failure, but 'res' was not in the function signature (the route
# wrapper passes only req and job_id). This caused R to throw
#   Error: object 'res' not found
# instead of returning a clean error response.
#
# The fix: remove the res$status <- 503L lines and return the error list
# directly, which is what the callers of handle_climate_cancel already do.
#
# These tests stub Redis and process-registry dependencies so they run
# without a live Redis connection.

root <- normalizePath(file.path("..", ".."), winslash = "/")

# Stub out Redis and registry dependencies before sourcing (order matters: plumber_helpers
# defines helpers that climate_helpers needs; error_codes must precede climate_helpers)
assign("sdm_redis_cancel_set", function(job_id) message("stub: sdm_redis_cancel_set ", job_id), globalenv())
assign("sdm_process_registry", new.env(parent = emptyenv()), globalenv())
assign("sdm_registry_proc", function(entry) NULL, globalenv())
assign("sdm_read_meta_json", function(path, default = NULL) NULL, globalenv())
assign("sdm_error_code", function(req, code_key, detail_msg = NULL) {
  list(error = code_key, detail = detail_msg)
}, globalenv())
assign("sdm_error_code_direct", function(code_key, detail_msg = NULL) {
  list(error = code_key, detail = detail_msg)
}, globalenv())
source(file.path(root, "plumber", "R", "helpers", "plumber_helpers.R"), local = FALSE)
source(file.path(root, "plumber", "R", "redis.R"), local = FALSE)
source(file.path(root, "plumber", "R", "error_codes.R"), local = FALSE)
source(file.path(root, "plumber", "R", "helpers", "climate_helpers.R"), local = FALSE)

make_req <- function(user_id = NULL) {
  list(user_id = user_id)
}

test_that("handle_climate_cancel does not throw 'res not found' when meta.json is unreadable", {
  # Before the fix, this threw: Error: object 'res' not found
  app_dir <- tempdir()
  job_dir <- file.path(app_dir, "outputs", "jobs", "test-cancel-job")
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)
  meta_file <- file.path(job_dir, "meta.json")
  writeLines("not valid json{", meta_file)

  req <- make_req("test-user")
  result <- tryCatch(
    handle_climate_cancel(req, "test-cancel-job", app_dir),
    error = function(e) list(error = conditionMessage(e))
  )

  # Must return an error list, NOT throw "object 'res' not found"
  expect_type(result, "list")
  expect_true("error" %in% names(result))
  expect_match(result$error, "unreadable|retry", ignore.case = TRUE)
  unlink(meta_file, recursive = TRUE)
})

test_that("handle_climate_cancel returns ACCESS_DENIED for wrong owner", {
  app_dir <- tempdir()
  job_dir <- file.path(app_dir, "outputs", "jobs", "test-owner-job")
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)
  meta_file <- file.path(job_dir, "meta.json")
  writeLines(jsonlite::toJSON(list(
    user_id = "other-user",
    status = "running"
  ), auto_unbox = TRUE), meta_file)

  req <- make_req("attacker-user")
  result <- handle_climate_cancel(req, "test-owner-job", app_dir)

  expect_type(result, "list")
  expect_true("error" %in% names(result))
  expect_match(result$error, "ACCESS_DENIED|permission", ignore.case = TRUE)
  unlink(meta_file, recursive = TRUE)
})
