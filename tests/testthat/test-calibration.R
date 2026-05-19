# Tests for calibration plot computation and rendering.
# helper-load.R and helper-fixtures.R are auto-sourced by testthat.

test_that("compute_calibration returns valid data frame with GLM fit", {
  skip_if_not_installed("terra")

  set.seed(42)
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 40),
    latitude = seq(-23.85, -22.15, length.out = 40),
    stringsAsFactors = FALSE
  )

  fit <- make_test_fit(occ, env, seed = 42L)
  skip_if(is.null(fit), "GLM fit failed")

  model_data <- fit$model_data
  cal <- compute_calibration(model_data, fit, n_bins = 5)
  expect_true(is.data.frame(cal))
  expect_true(all(c("bin_mid", "observed", "predicted", "n") %in% names(cal)))
})

test_that("compute_calibration returns empty data frame for too few points", {
  mock_fit <- make_mock_fit("glm")
  model_data <- data.frame(
    presence = c(1, 1, 0, 0, 1),
    bio1 = runif(5),
    bio12 = runif(5)
  )
  cal <- compute_calibration(model_data, mock_fit, n_bins = 5)
  expect_true(is.data.frame(cal))
  expect_equal(nrow(cal), 0)
})

test_that("plot_calibration returns ggplot object", {
  skip_if_not_installed("ggplot2")

  cal_data <- data.frame(
    bin_mid = seq(0.1, 0.9, by = 0.2),
    observed = c(0.15, 0.3, 0.5, 0.7, 0.85),
    predicted = c(0.1, 0.3, 0.5, 0.7, 0.9),
    n = c(10, 20, 30, 25, 15)
  )

  p <- plot_calibration(cal_data)
  expect_true(inherits(p, "ggplot"))
})

test_that("plot_calibration handles empty data gracefully", {
  skip_if_not_installed("ggplot2")

  cal_data <- data.frame(
    bin_mid = numeric(0), observed = numeric(0),
    predicted = numeric(0), n = integer(0)
  )

  p <- plot_calibration(cal_data)
  expect_true(inherits(p, "ggplot") || is.null(p))
})
