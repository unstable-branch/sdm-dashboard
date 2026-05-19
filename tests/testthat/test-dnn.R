# Tests for DNN backend contract.


test_that("DNN registry entry absent when cito not installed", {
  ids <- sdm_model_ids()
  if (!requireNamespace("cito", quietly = TRUE)) {
    expect_false("dnn" %in% ids)
  } else {
    expect_true("dnn" %in% ids)
  }
})

test_that("fit_dnn_sdm fails gracefully without cito", {
  if (!requireNamespace("cito", quietly = TRUE)) {
    occ_df <- data.frame(
      longitude = c(140, 141, 142, 143, 144),
      latitude = c(-30, -31, -32, -33, -34)
    )
    env_data <- terra::rast(nrows = 10, ncols = 10, xmin = 139, xmax = 145, ymin = -35, ymax = -29)
    terra::values(env_data) <- matrix(rnorm(200), ncol = 2)
    names(env_data) <- c("BIO1", "BIO12")
    expect_error(fit_dnn_sdm(occ_df, env_data), "cito and torch")
  }
})

test_that("prepare_dnn_data returns expected structure", {
  skip_if_not(requireNamespace("cito", quietly = TRUE))
  occ_df <- data.frame(
    longitude = c(140, 141, 142, 143, 144, 140.5, 141.5, 142.5, 143.5, 144.5),
    latitude = c(-30, -31, -32, -33, -34, -30.5, -31.5, -32.5, -33.5, -34.5)
  )
  env_data <- terra::rast(nrows = 10, ncols = 10, xmin = 139, xmax = 145, ymin = -35, ymax = -29)
  terra::values(env_data) <- matrix(rnorm(200), ncol = 2)
  names(env_data) <- c("BIO1", "BIO12")

  d <- prepare_dnn_data(occ_df, env_data, background_n = 20, seed = 42L)
  expect_true(is.list(d))
  expect_true(is.matrix(d$train_x))
  expect_true(is.numeric(d$train_y))
  expect_true(is.matrix(d$test_x))
  expect_true(is.numeric(d$test_y))
  expect_true(is.list(d$scaler))
  expect_true("mean" %in% names(d$scaler))
  expect_true("sd" %in% names(d$scaler))
  expect_true(is.character(d$feature_names))
  expect_true(d$n_presences > 0)
  expect_true(d$n_background > 0)
})
