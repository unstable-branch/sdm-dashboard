test_that("align_covariate_to_template resamples to match template resolution", {
  skip_if_not_installed("terra")
  set.seed(42)

  template <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::values(template) <- 1:terra::ncell(template)

  coarse <- terra::rast(nrows = 5, ncols = 5, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::crs(coarse) <- terra::crs(template)
  terra::values(coarse) <- runif(terra::ncell(coarse), 0, 1)

  aligned <- align_covariate_to_template(coarse, template, method = "bilinear")

  expect_equal(terra::nrow(aligned), terra::nrow(template))
  expect_equal(terra::ncol(aligned), terra::ncol(template))
  expect_equal(terra::res(aligned)[1], terra::res(template)[1], tolerance = 1e-8)
  expect_equal(terra::ext(aligned), terra::ext(template), tolerance = 1e-8)

  vals <- terra::values(aligned, na.rm = TRUE)
  expect_true(length(vals) > 0)
  expect_true(is.numeric(vals))
})

test_that("align_covariate_to_template handles CRS mismatch", {
  skip_if_not_installed("terra")
  set.seed(42)

  template <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::crs(template) <- "EPSG:4326"
  terra::values(template) <- 1:terra::ncell(template)

  mercator <- terra::rast(nrows = 15, ncols = 15,
    xmin = 15580000, xmax = 15800000, ymin = -2750000, ymax = -2500000)
  terra::crs(mercator) <- "EPSG:3857"
  terra::values(mercator) <- runif(terra::ncell(mercator), 0, 1)

  aligned <- tryCatch(
    align_covariate_to_template(mercator, template, method = "bilinear"),
    error = function(e) NULL
  )

  expect_true(!is.null(aligned))
  if (!is.null(aligned)) {
    expect_true(terra::same.crs(aligned, template))
    expect_equal(terra::ext(aligned), terra::ext(template), tolerance = 1e-2)
  }
})

test_that("aggregate reduces raster resolution by factor", {
  skip_if_not_installed("terra")
  set.seed(42)

  r <- terra::rast(nrows = 40, ncols = 40, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::values(r) <- runif(terra::ncell(r), 0, 1)

  agg_factor <- 4
  aggregated <- terra::aggregate(r, fact = agg_factor, fun = "mean", na.rm = TRUE)

  expect_equal(terra::nrow(aggregated), terra::nrow(r) / agg_factor)
  expect_equal(terra::ncol(aggregated), terra::ncol(r) / agg_factor)
  expect_equal(terra::res(aggregated)[1], terra::res(r)[1] * agg_factor, tolerance = 1e-8)

  orig_area <- (terra::xmax(r) - terra::xmin(r)) * (terra::ymax(r) - terra::ymin(r))
  agg_area <- (terra::xmax(aggregated) - terra::xmin(aggregated)) * (terra::ymax(aggregated) - terra::ymin(aggregated))
  expect_true(abs(orig_area - agg_area) / orig_area < 0.01)
})