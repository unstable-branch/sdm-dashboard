test_that("sdm_safe_rename copies when rename fails cross-device", {
  tmp_from <- tempfile()
  tmp_to <- tempfile()
  on.exit(unlink(c(tmp_from, tmp_to), force = TRUE))

  writeLines("test data", tmp_from)
  sdm_safe_rename(tmp_from, tmp_to)
  expect_true(file.exists(tmp_to))
  expect_false(file.exists(tmp_from))
  expect_equal(readLines(tmp_to), "test data")
})

test_that("sdm_safe_rename overwrites existing destination", {
  tmp_from <- tempfile()
  tmp_to <- tempfile()
  on.exit(unlink(c(tmp_from, tmp_to), force = TRUE))

  writeLines("source", tmp_from)
  writeLines("dest", tmp_to)
  sdm_safe_rename(tmp_from, tmp_to)
  expect_true(file.exists(tmp_to))
  expect_equal(readLines(tmp_to), "source")
})

test_that("sdm_safe_rename handles missing source gracefully", {
  tmp_to <- tempfile()
  on.exit(unlink(tmp_to, force = TRUE))

  expect_error(sdm_safe_rename("/nonexistent/path", tmp_to), NA)
  expect_false(file.exists(tmp_to))
})
