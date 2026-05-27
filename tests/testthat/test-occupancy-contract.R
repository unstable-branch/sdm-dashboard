test_that("Occupancy registry entry absent when unmarked not installed", {
  ids <- sdm_model_ids()
  if (!requireNamespace("unmarked", quietly = TRUE)) {
    expect_false("occupancy" %in% ids)
  } else {
    expect_true("occupancy" %in% ids)
  }
})

test_that("read_detection_history parses standard CSV format", {
  csv_content <- "site_id,longitude,latitude,survey_1,survey_2,survey_3
site1,140,-23,1,0,1
site2,141,-24,0,1,0
site3,142,-25,0,0,0"
  tf <- tempfile(fileext = ".csv")
  writeLines(csv_content, tf)
  det <- read_detection_history(tf)
  expect_true(is.list(det))
  expect_equal(det$n_sites, 3)
  expect_equal(det$n_surveys, 3)
  expect_true(all(det$y %in% c(0L, 1L, NA_integer_)))
  unlink(tf)
})

test_that("fit_occupancy_sdm fails gracefully without detection data", {
  skip_if_not_installed("unmarked")
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(longitude = c(140, 141), latitude = c(-23, -24))
  expect_error(fit_occupancy_sdm(occ, env), "detection-history data")
})
