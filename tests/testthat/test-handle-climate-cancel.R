# Tests for handle_climate_cancel error handling.
#
# Before this fix, handle_climate_cancel referenced res$status to set a 503 on
# meta.json read failure, but 'res' was not in the function signature. This caused R to throw
#   Error: object 'res' not found
# instead of returning a clean error response.
#
# The fix: remove the res$status <- 503L lines and return the error list
# directly, which is what the callers of handle_climate_cancel already do.
#
# These tests stub Redis and process-registry dependencies so they run
# without a live Redis connection.

root <- if (exists("find_sdm_root", mode = "function")) {
  find_sdm_root()
} else {
  starts <- c(getwd())
  script_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (length(script_arg) > 0L) starts <- c(starts, sub("^--file=", "", script_arg[1]))
  source_files <- vapply(sys.frames(), function(frame) {
    if (!is.null(frame$ofile)) frame$ofile else NA_character_
  }, character(1))
  starts <- c(starts, source_files[!is.na(source_files)])
  resolved <- NULL
  for (start in unique(starts)) {
    candidate <- normalizePath(start, winslash = "/", mustWork = FALSE)
    if (!dir.exists(candidate)) candidate <- dirname(candidate)
    repeat {
      if (file.exists(file.path(candidate, "app.R")) &&
          file.exists(file.path(candidate, "R", "core", "bootstrap.R"))) {
        resolved <- candidate
        break
      }
      parent <- dirname(candidate)
      if (identical(parent, candidate)) break
      candidate <- parent
    }
    if (!is.null(resolved)) break
  }
  if (is.null(resolved)) stop("Could not find SDM project root", call. = FALSE)
  resolved
}

# Load the same authorization dependency chain as run_server.R. Stubs are
# installed after sourcing so the runtime definitions cannot overwrite them.
source(file.path(root, "plumber", "R", "auth.R"), local = FALSE)
source(file.path(root, "plumber", "R", "redis.R"), local = FALSE)
source(file.path(root, "plumber", "R", "helpers", "plumber_helpers.R"), local = FALSE)
source(file.path(root, "plumber", "R", "error_codes.R"), local = FALSE)
source(file.path(root, "plumber", "R", "helpers", "climate_helpers.R"), local = FALSE)
assign("sdm_redis_cancel_set", function(job_id) invisible(NULL), globalenv())
assign("sdm_process_registry", new.env(parent = emptyenv()), globalenv())
assign("sdm_registry_proc", function(entry) NULL, globalenv())
assign("sdm_read_meta_json", function(path, default = NULL) {
  if (!file.exists(path)) return(default)
  tryCatch(jsonlite::fromJSON(path, simplifyVector = FALSE), error = function(e) default)
}, globalenv())

make_req <- function(user_id = NULL) {
  list(user_id = user_id, user_role = "viewer")
}

test_that("handle_climate_cancel does not throw 'res not found' when meta.json is unreadable", {
  # Before the fix, this threw: Error: object 'res' not found
  app_dir <- tempdir()
  job_dir <- file.path(app_dir, "outputs", "jobs", "test-cancel-job")
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)
  meta_file <- file.path(job_dir, "meta.json")
  writeLines("not valid json{", meta_file)

  req <- make_req("test-user")
  old_app_dir <- if (exists("app_dir", envir = .GlobalEnv, inherits = FALSE)) get("app_dir", envir = .GlobalEnv) else NULL
  assign("app_dir", app_dir, envir = .GlobalEnv)
  on.exit(if (is.null(old_app_dir)) rm("app_dir", envir = .GlobalEnv) else assign("app_dir", old_app_dir, envir = .GlobalEnv), add = TRUE)
  res <- new.env(parent = emptyenv())
  result <- tryCatch(
    handle_climate_cancel(req, res, "test-cancel-job", app_dir),
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
  old_app_dir <- if (exists("app_dir", envir = .GlobalEnv, inherits = FALSE)) get("app_dir", envir = .GlobalEnv) else NULL
  assign("app_dir", app_dir, envir = .GlobalEnv)
  on.exit(if (is.null(old_app_dir)) rm("app_dir", envir = .GlobalEnv) else assign("app_dir", old_app_dir, envir = .GlobalEnv), add = TRUE)
  result <- handle_climate_cancel(req, new.env(parent = emptyenv()), "test-owner-job", app_dir)

  expect_type(result, "list")
  expect_true("error" %in% names(result))
  expect_match(result$error, "ACCESS_DENIED|permission", ignore.case = TRUE)
  unlink(meta_file, recursive = TRUE)
})
