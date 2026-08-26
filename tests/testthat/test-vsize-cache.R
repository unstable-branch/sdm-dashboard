test_that("sdm_detect_vsize: env override always wins regardless of cache", {
  Sys.setenv(SDM_CHILD_MAX_VSIZE = "32Gb")
  Sys.setenv(SDM_CHILD_MAX_VSIZE_REFRESH_MS = "0")
  expect_equal(sdm_detect_vsize(), "32Gb")
  Sys.unsetenv("SDM_CHILD_MAX_VSIZE")
  Sys.unsetenv("SDM_CHILD_MAX_VSIZE_REFRESH_MS")
})

test_that("sdm_detect_vsize: invalid refresh_ms falls back to 0 (no refresh)", {
  Sys.unsetenv("SDM_CHILD_MAX_VSIZE")
  Sys.setenv(SDM_CHILD_MAX_VSIZE_REFRESH_MS = "not-a-number")
  expect_no_error(sdm_detect_vsize())
  Sys.unsetenv("SDM_CHILD_MAX_VSIZE_REFRESH_MS")
})

test_that("sdm_detect_vsize: positive refresh_ms invalidates cache after window", {
  Sys.unsetenv("SDM_CHILD_MAX_VSIZE")
  Sys.setenv(SDM_CHILD_MAX_VSIZE_REFRESH_MS = "1")
  v1 <- sdm_detect_vsize()
  Sys.sleep(0.05)
  v2 <- sdm_detect_vsize()
  expect_type(v1, "character")
  expect_type(v2, "character")
  Sys.unsetenv("SDM_CHILD_MAX_VSIZE_REFRESH_MS")
})
