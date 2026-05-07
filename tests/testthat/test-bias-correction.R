test_that("sample_background_points uniform returns n points", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 20, ncols = 20, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))
    presence_pts <- data.frame(x = c(0, 1, 2), y = c(0, 1, 2))

    set.seed(42)
    result <- sample_background_points(small_rast, n = 50, seed = 42, presence_xy = presence_pts)

    expect_s3_class(result, "data.frame")
    expect_equal(nrow(result), 50)
    expect_true(all(c("x", "y") %in% names(result)))
    expect_false(any(duplicated(result$x & result$y)))
  }
})

test_that("sample_background_points uniform seed reproducibility", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 20, ncols = 20, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))

    set.seed(99)
    result1 <- sample_background_points(small_rast, n = 30, seed = 99)

    set.seed(99)
    result2 <- sample_background_points(small_rast, n = 30, seed = 99)

    expect_equal(result1$x, result2$x)
    expect_equal(result1$y, result2$y)
  }
})

test_that("sample_background_points target_group fails without target_group_occ", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 20, ncols = 20, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))
    presence_pts <- data.frame(x = c(0, 1, 2), y = c(0, 1, 2))

    expect_error(
      sample_background_points(small_rast, n = 50, seed = 42, presence_xy = presence_pts,
                              bias_method = "target_group", target_group_occ = NULL),
      "requires target_group_occ"
    )
  }
})

test_that("sample_background_points target_group with valid data", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 30, ncols = 30, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))
    presence_pts <- data.frame(x = c(0, 1, 2), y = c(0, 1, 2))
    target_pts <- data.frame(longitude = c(3, 4, 5), latitude = c(1, 2, 3))

    set.seed(42)
    result <- sample_background_points(small_rast, n = 30, seed = 42, presence_xy = presence_pts,
                                       bias_method = "target_group", target_group_occ = target_pts)

    expect_s3_class(result, "data.frame")
    expect_equal(nrow(result), 30)
    expect_true(all(c("x", "y") %in% names(result)))
  }
})

test_that("sample_background_points thickened returns n points", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 30, ncols = 30, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))
    presence_pts <- data.frame(x = c(0, 1, 2, 3), y = c(0, 1, 2, 3))

    set.seed(42)
    result <- sample_background_points(small_rast, n = 50, seed = 42, presence_xy = presence_pts,
                                       bias_method = "thickened", thickening_distance_km = 5)

    expect_s3_class(result, "data.frame")
    expect_equal(nrow(result), 50)
    expect_true(all(c("x", "y") %in% names(result)))
  }
})

test_that("sample_background_points thickened requires >= 2 presence points", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 20, ncols = 20, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))
    presence_pts <- data.frame(x = c(0), y = c(0))

    expect_error(
      sample_background_points(small_rast, n = 50, seed = 42, presence_xy = presence_pts,
                              bias_method = "thickened"),
      "at least 2 presence points"
    )
  }
})

test_that("sample_background_points thickened seed reproducibility", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 30, ncols = 30, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    terra::values(small_rast) <- runif(terra::ncell(small_rast))
    presence_pts <- data.frame(x = c(0, 1, 2), y = c(0, 1, 2))

    set.seed(42)
    result1 <- sample_background_points(small_rast, n = 30, seed = 42, presence_xy = presence_pts,
                                       bias_method = "thickened", thickening_distance_km = 5)

    set.seed(42)
    result2 <- sample_background_points(small_rast, n = 30, seed = 42, presence_xy = presence_pts,
                                       bias_method = "thickened", thickening_distance_km = 5)

    expect_equal(result1$x, result2$x)
    expect_equal(result1$y, result2$y)
  }
})

test_that("fit_fast_sdm accepts bias_method parameter", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping because terra is not installed")
  } else {
    small_rast <- terra::rast(nrows = 30, ncols = 30, ext = terra::ext(-10, 10, -5, 5), crs = "EPSG:4326")
    bio1 <- terra::setNames(small_rast, "bio1")
    bio5 <- terra::setNames(small_rast * 0.8 + 5, "bio5")
    env_stack <- c(bio1, bio5)
    terra::values(env_stack) <- runif(terra::ncell(env_stack))

    occ <- data.frame(longitude = runif(30, -8, 8), latitude = runif(30, -3, 3), source = "test")

    result <- fit_fast_sdm(occ, env_stack, background_n = 100, include_quadratic = FALSE,
                           cv_folds = 2, seed = 42, n_cores = 1,
                           bias_method = "uniform")

    expect_true("bias_method" %in% names(result))
    expect_equal(result$bias_method, "uniform")
  }
})