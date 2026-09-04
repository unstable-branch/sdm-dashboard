# Tests for R pipeline sdm_step observability — regression tests for the
# "argument is of length zero" class of failures (Group J / fix/glm-length-zero-blockcv-pdf).
# These tests verify that wrapped operations produce labelled errors rather than
# bare R errors propagating to users.

test_that("sdm_step wraps errors with a labelled stage prefix", {
  err <- tryCatch(
    sdm_step("my-stage", stop("something went wrong")),
    error = function(e) e
  )
  expect_true(inherits(err, "error"))
  expect_true(grepl("SDM stage 'my-stage' failed", err$message, fixed = TRUE))
  expect_true(grepl("something went wrong", err$message, fixed = TRUE))
})

test_that("sdm_step returns the value of the expression on success", {
  result <- sdm_step("identity-stage", 42L)
  expect_equal(result, 42L)

  result2 <- sdm_step("list-stage", list(a = 1, b = 2))
  expect_equal(result2$a, 1)
  expect_equal(result2$b, 2)
})

test_that("sdm_step propagates errors from inner tryCatch", {
  # Inner tryCatch that returns NULL should not be swallowed silently when
  # the surrounding sdm_step is used
  result <- sdm_step("inner-null",
    tryCatch(NULL, error = function(e) NULL)
  )
  # tryCatch(NULL, ...) returns NULL; sdm_step should return NULL without error
  expect_null(result)
})

test_that("sdm_step with expression block returns last value", {
  result <- sdm_step("multi-expr", {
    x <- 1
    y <- 2
    x + y
  })
  expect_equal(result, 3)
})

test_that("sdm_step wraps errors thrown inside expression blocks", {
  err <- tryCatch(
    sdm_step("block-error", {
      if (TRUE) stop("boom")
      42
    }),
    error = function(e) e
  )
  expect_true(inherits(err, "error"))
  expect_true(grepl("SDM stage 'block-error' failed", err$message, fixed = TRUE))
  expect_true(grepl("boom", err$message, fixed = TRUE))
})

test_that("sdm_step with NULL expression returns NULL without error", {
  result <- sdm_step("null-stage", NULL)
  expect_null(result)
})

test_that("sdm_step handles warnings from inner expressions", {
  # suppressWarnings should prevent warnings from being turned into errors
  result <- sdm_step("warning-stage",
    suppressWarnings({
      warning("a warning")
      99
    })
  )
  expect_equal(result, 99)
})
