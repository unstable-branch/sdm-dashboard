test_that("projection metrics use raster values rather than terra extraction IDs", {
  skip_if_not_installed("terra")
  raster <- terra::rast(nrows = 2, ncols = 2, xmin = 0, xmax = 2, ymin = 0, ymax = 2)
  terra::values(raster) <- 0.25
  validation <- data.frame(decimalLongitude = c(0.5, 1.5), decimalLatitude = c(0.5, 1.5))

  metrics <- compute_projection_metrics(
    raster,
    train_presence_suit = rep(0.25, 10),
    threshold = 0.5,
    n_bg_samples = 100,
    validation_occ = validation,
    seed = 7
  )

  expect_equal(metrics$mean_projection_suitability, 0.25)
  expect_equal(metrics$pct_above_threshold, 0)
  expect_equal(metrics$validation$mean_suitability, 0.25)
  expect_equal(metrics$validation$pct_exceeding, 0)
})
