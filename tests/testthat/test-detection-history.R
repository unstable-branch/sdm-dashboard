test_that("read_detection_history parses standard CSV", {
  csv_content <- "site_id,longitude,latitude,survey_1,survey_2
A,140,-23,1,0
B,141,-24,0,1
C,142,-25,0,0"
  tf <- tempfile(fileext = ".csv")
  writeLines(csv_content, tf)
  det <- read_detection_history(tf)
  expect_equal(det$n_sites, 3)
  expect_equal(det$n_surveys, 2)
  expect_equal(nrow(det$y), 3)
  expect_equal(ncol(det$y), 2)
  expect_true(all(det$y %in% c(0L, 1L)))
  unlink(tf)
})

test_that("read_detection_history handles NA surveys", {
  csv_content <- "site_id,longitude,latitude,survey_1,survey_2,survey_3
A,140,-23,1,0,NA
B,141,-24,0,1,1
C,142,-25,0,0,0"
  tf <- tempfile(fileext = ".csv")
  writeLines(csv_content, tf)
  det <- read_detection_history(tf)
  expect_equal(det$n_sites, 3)
  expect_true(is.na(det$y[1, 3]) || is.na(det$y[1, 3]) && det$y[1, 3] == 0)
  unlink(tf)
})

test_that("read_detection_history errors with too few surveys", {
  csv_content <- "site_id,longitude,latitude,survey_1
A,140,-23,1"
  tf <- tempfile(fileext = ".csv")
  writeLines(csv_content, tf)
  expect_error(read_detection_history(tf), "least 2 survey")
  unlink(tf)
})

test_that("read_detection_history includes optional occurrence covariates", {
  csv_content <- "site_id,longitude,latitude,survey_1,survey_2,elevation
A,140,-23,1,0,200
B,141,-24,0,1,450"
  tf <- tempfile(fileext = ".csv")
  writeLines(csv_content, tf)
  det <- read_detection_history(tf, occ_covs = "elevation")
  expect_true("elevation" %in% names(det$site_covs))
  unlink(tf)
})
