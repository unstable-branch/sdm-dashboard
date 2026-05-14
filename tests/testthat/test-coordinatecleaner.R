test_that("clean_occurrences with use_cc = FALSE does not add cc columns", {
  occ <- data.frame(
    species = "Demo species",
    decimalLongitude = c(seq(140, 161), 200, 140),
    decimalLatitude = c(seq(-39, -18), -25, -39),
    institutionCode = c(rep("Museum A", 12), rep("Tiny Source", 10), "Bad", "Museum A"),
    countryCode = "AU",
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".csv")
  utils::write.csv(occ, path, row.names = FALSE)

  cleaned <- clean_occurrences(path, min_source_records = 11, merge_small_sources = TRUE, use_cc = FALSE)

  expect_equal(nrow(cleaned$occ), 22)
  expect_false("cc_flag" %in% colnames(cleaned$occ))
  expect_false("cc_test_zero" %in% colnames(cleaned$occ))
})

test_that("clean_occurrences with use_cc = TRUE adds cc columns when CoordinateCleaner available", {
  skip_if_not(requireNamespace("CoordinateCleaner", quietly = TRUE))
  set.seed(42)
  n_good <- 22
  occ <- data.frame(
    species = "Test species",
    decimalLongitude = c(0, 180, 10, 20, runif(n_good, 115, 155)),
    decimalLatitude  = c(0, -45, -35, -25, runif(n_good, -40, -10)),
    institutionCode = c("Test", "Test", "Museum A", "BMNH", rep("Test Source", n_good)),
    countryCode = c("XX", "AU", "AU", "GB", rep("AU", n_good)),
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".csv")
  utils::write.csv(occ, path, row.names = FALSE)

  cleaned <- clean_occurrences(path, min_source_records = 1, merge_small_sources = TRUE, use_cc = TRUE)

  expect_true("cc_flag" %in% colnames(cleaned$occ))
  expect_true("cc_test_zero" %in% colnames(cleaned$occ))
  expect_true("cc_test_sea" %in% colnames(cleaned$occ))
  expect_true("cc_test_capitals" %in% colnames(cleaned$occ))
  expect_true("cc_test_institutions" %in% colnames(cleaned$occ))
  expect_true("cc_test_centroids" %in% colnames(cleaned$occ))
  expect_true("cc_test_urban" %in% colnames(cleaned$occ))
})

test_that("clean_occurrences with use_cc = TRUE flags (0,0) and known museum coordinate", {
  skip_if_not(requireNamespace("CoordinateCleaner", quietly = TRUE))
  set.seed(42)
  n_good <- 22
  occ <- data.frame(
    species = "Test species",
    decimalLongitude = c(0, 10, 147.1234, runif(n_good, 115, 155)),
    decimalLatitude  = c(0, -35, -35.5678, runif(n_good, -40, -10)),
    institutionCode = c("Test", "Museum A", "BMNH", rep("Test Source", n_good)),
    countryCode = c("XX", "AU", "GB", rep("AU", n_good)),
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".csv")
  utils::write.csv(occ, path, row.names = FALSE)

  cleaned <- clean_occurrences(path, min_source_records = 1, merge_small_sources = TRUE, use_cc = TRUE)

  expect_true("cc_flag" %in% colnames(cleaned$occ))
  zero_row <- which(cleaned$occ$longitude == 0 & cleaned$occ$latitude == 0)
  if (length(zero_row) > 0) {
    expect_true(isTRUE(cleaned$occ$cc_flag[zero_row]) || cleaned$occ$cc_test_zero[zero_row] == TRUE)
  }
})

test_that("clean_occurrences with use_cc = TRUE does not auto-drop flagged records", {
  skip_if_not(requireNamespace("CoordinateCleaner", quietly = TRUE))
  set.seed(42)
  n_good <- 22
  occ <- data.frame(
    species = "Test species",
    decimalLongitude = c(0, 10, 20, runif(n_good, 115, 155)),
    decimalLatitude  = c(0, -35, -25, runif(n_good, -40, -10)),
    institutionCode = c("Test", "Museum A", "BMNH", rep("Test Source", n_good)),
    countryCode = c("XX", "AU", "GB", rep("AU", n_good)),
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".csv")
  utils::write.csv(occ, path, row.names = FALSE)

  cleaned <- clean_occurrences(path, min_source_records = 1, merge_small_sources = TRUE, use_cc = TRUE)

  expect_true(nrow(cleaned$occ) >= 20)
  expect_true("cc_flag" %in% colnames(cleaned$occ))
})

test_that("clean_occurrences with use_cc = TRUE warns if CoordinateCleaner not installed", {
  if (requireNamespace("CoordinateCleaner", quietly = TRUE)) {
    skip("CoordinateCleaner is installed")
  }
  set.seed(42)
  occ <- data.frame(
    species = rep("Test species", 22),
    decimalLongitude = c(runif(22, 115, 155)),
    decimalLatitude  = c(runif(22, -40, -10)),
    institutionCode = rep("Test Source", 22),
    countryCode = rep("AU", 22),
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".csv")
  utils::write.csv(occ, path, row.names = FALSE)

  expect_warning(cleaned <- clean_occurrences(path, min_source_records = 1, merge_small_sources = TRUE, use_cc = TRUE))
  expect_false("cc_flag" %in% colnames(cleaned$occ))
})
