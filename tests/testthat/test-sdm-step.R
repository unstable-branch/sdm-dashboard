# Regression tests for the sdm_step() labelled tryCatch helper.

test_that("sdm_step() passes through successful expressions unchanged", {
  expect_equal(sdm_step("ok", 1 + 1), 2)
  expect_equal(sdm_step("ok", c(1, 2, 3)), c(1, 2, 3))
  expect_null(sdm_step("ok", NULL))
  expect_identical(sdm_step("ok", list(a = 1)), list(a = 1))
})

test_that("sdm_step() wraps errors with the stage label", {
  expect_error(
    sdm_step("cross-validate", stop("argument is of length zero")),
    regexp = "SDM stage 'cross-validate' failed: argument is of length zero",
    fixed = TRUE
  )
})

test_that("sdm_step() preserves inner condition messages verbatim", {
  expect_error(
    sdm_step("train-metrics", stop("auc_rank: n1 == 0")),
    regexp = "SDM stage 'train-metrics' failed: auc_rank: n1 == 0",
    fixed = TRUE
  )
})

test_that("sdm_step() does not silently swallow errors", {
  fired <- FALSE
  expect_error(
    tryCatch(
      sdm_step("extract-coefficients", stop("boom")),
      error = function(e) {
        fired <<- TRUE
        stop(e)
      }
    ),
    regexp = "boom"
  )
  expect_true(fired)
})
