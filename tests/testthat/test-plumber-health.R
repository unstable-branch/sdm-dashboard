# tests/testthat/test-plumber-health.R
#
# Regression test for the /health endpoint returning populated JSON.
#
# Before the revert of d3b96e49 (which converted the preroute hook to
# @filter Auth), /health returned an empty {} body in Plumber 1.3.3 due
# to a C++ serializer bug triggered by the @filter decorator path.
# After restoring the preroute hook from abcd2432, the body is
# populated as expected.
#
# Related: rstudio/plumber#1022

make_health_req <- function() {
  list(
    REQUEST_METHOD = "GET",
    PATH_INFO = "/health",
    PATH = "/health",
    QUERY_STRING = "",
    HEADERS = list(),
    body = raw(0)
  )
}

test_that("/health returns 200 with populated JSON body", {
  skip_if_not_installed("plumber")
  skip_if_not_installed("jsonlite")
  skip_if_not_installed("withr")

  withr::local_envvar(
    .local_envir = parent.frame(),
    PLUMBER_AUTH_DISABLED = "true",
    PLUMBER_INTERNAL_KEY = paste(rep("a", 32), collapse = ""),
    NODE_ENV = "test",
    SDM_PROJECT_ROOT = normalizePath(".", winslash = "/")
  )

  pr <- plumber::pr("plumber/R/plumber.R")
  res <- pr$call(make_health_req())

  expect_equal(res$status, 200L)

  body <- rawToChar(res$body)
  parsed <- jsonlite::fromJSON(body, simplifyVector = FALSE)

  # All required fields present
  expect_true("status" %in% names(parsed))
  expect_true("active_runs" %in% names(parsed))
  expect_true("max_concurrent_runs" %in% names(parsed))
  expect_true("memory_gb" %in% names(parsed))
  expect_true("r_version" %in% names(parsed))
  expect_true("timestamp" %in% names(parsed))

  # Stable field values
  expect_equal(parsed$status, "ok")
  expect_equal(parsed$active_runs, 0L)
})

test_that("/health is open (not auth-gated)", {
  skip_if_not_installed("plumber")
  skip_if_not_installed("jsonlite")
  skip_if_not_installed("withr")

  withr::local_envvar(
    .local_envir = parent.frame(),
    NODE_ENV = "test",
    SDM_PROJECT_ROOT = normalizePath(".", winslash = "/")
    # NOTE: PLUMBER_AUTH_DISABLED not set; /health must still respond
    # without a 401 because it is in the open_patterns list.
  )

  pr <- plumber::pr("plumber/R/plumber.R")
  res <- pr$call(make_health_req())

  expect_false(res$status == 401L)
})
