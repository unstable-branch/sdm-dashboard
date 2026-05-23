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
    env_data <- c(env_data, env_data)
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
  env_data <- c(env_data, env_data)
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

test_that("DNN backend fits and predicts through the registry", {
  skip_if_not(requireNamespace("cito", quietly = TRUE))
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not("dnn" %in% sdm_model_ids())

  set.seed(42)
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 30),
    latitude = seq(-23.85, -22.15, length.out = 30),
    source = rep(c("A", "B"), each = 15),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model("dnn", occ, env, background_n = 60, cv_folds = 2, seed = 99, n_cores = 1)
  expect_equal(fit$model_id, "dnn")
  expect_true(is.list(fit$model))
  expect_true(is.list(fit$cv))
  expect_true(is.finite(fit$cv$auc_mean))

  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_sdm_model(fit, env, output_tif, n_cores = 1)
  expect_true(inherits(suit, "SpatRaster"))
  expect_equal(names(suit), "suitability")
  expect_true(file.exists(output_tif))
})

test_that("DNN torch_setup detects device correctly", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  result <- detect_torch_device()
  expect_true(is.list(result))
  expect_true("device" %in% names(result))
  expect_true(result$device %in% c("cpu", "cuda", "mps"))
})
