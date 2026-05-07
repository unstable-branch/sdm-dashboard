test_that("compute_mess identifies extrapolation correctly", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  train_rast[] <- 1:100

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = -5, xmax = 15, ymin = 0, ymax = 10)
  proj_rast[] <- seq(-20, 120, length.out = terra::ncell(proj_rast))

  result <- compute_mess(train_rast, proj_rast)

  expect_true(inherits(result$mess, "SpatRaster"))
  expect_true("pct_extrapolation" %in% names(result))
  expect_true(result$pct_extrapolation > 0)
})

test_that("compute_mess returns per_variable layers", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_rast) <- "var1"
  train_rast[] <- 1:100

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_rast) <- "var1"
  proj_rast[] <- 1:100

  result <- compute_mess(train_rast, proj_rast)

  expect_true(is.list(result$per_variable))
  expect_true("var1" %in% names(result$per_variable))
})

test_that("compute_mod returns variable indices", {
  skip_if_not_installed("terra")

  train_var1 <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  train_var2 <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  train_var1[] <- 1:100
  train_var2[] <- 101:200
  train_rast <- c(train_var1, train_var2)
  names(train_rast) <- c("var1", "var2")

  proj_var1 <- terra::rast(nrows = 10, ncols = 10, xmin = -5, xmax = 15, ymin = 0, ymax = 10)
  proj_var2 <- terra::rast(nrows = 10, ncols = 10, xmin = -5, xmax = 15, ymin = 0, ymax = 10)
  proj_var1[] <- seq(-20, 120, length.out = terra::ncell(proj_var1))
  proj_var2[] <- seq(90, 220, length.out = terra::ncell(proj_var2))
  proj_rast <- c(proj_var1, proj_var2)
  names(proj_rast) <- c("var1", "var2")

  mess_result <- compute_mess(train_rast, proj_rast)
  mod_raster <- compute_mod(mess_result$per_variable)

  expect_true(inherits(mod_raster, "SpatRaster"))
  expect_true(names(mod_raster) == "MOD")
})

test_that("compute_mess handles zero range gracefully", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_rast) <- "constant"
  train_rast[] <- 5

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_rast) <- "constant"
  proj_rast[] <- 5

  result <- compute_mess(train_rast, proj_rast)
  expect_true(inherits(result$mess, "SpatRaster"))
})

test_that("compute_mess errors on mismatched variables", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_rast) <- "var1"

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_rast) <- "var2"

  expect_error(compute_mess(train_rast, proj_rast), "same variable names")
})
