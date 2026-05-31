# Tests for response curves.

skip_if_no_terra <- function() {
  if (!requireNamespace("terra", quietly = TRUE)) skip("terra not available")
}

make_test_fit <- function() {
  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model("glm", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)
  list(fit = fit, env = env)
}

test_that("compute_response_curves returns list with one element per covariate", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 30)

  expect_true(is.list(curves))
  expect_equal(length(curves), 2)
  expect_equal(names(curves), c("bio1", "bio12"))
})

test_that("each response curve element has required columns", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 30)

  for (cov in names(curves)) {
    expect_true("covariate" %in% names(curves[[cov]]))
    expect_true("value" %in% names(curves[[cov]]))
    expect_true("suitability" %in% names(curves[[cov]]))
  }
})

test_that("suitability values are in [0, 1] for GLM with binomial family", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 30)

  for (cov in names(curves)) {
    vals <- curves[[cov]]$suitability
    ok <- is.finite(vals)
    expect_true(all(vals[ok] >= 0))
    expect_true(all(vals[ok] <= 1))
  }
})

test_that("n_points parameter is respected", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves_20 <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 20)
  curves_50 <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 50)

  for (cov in names(curves_20)) {
    expect_equal(nrow(curves_20[[cov]]), 20)
    expect_equal(nrow(curves_50[[cov]]), 50)
  }
})

test_that("plot_response_curves returns ggplot2 object", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 30)

  p <- plot_response_curves(curves)
  expect_true(inherits(p, "ggplot"))

  combined_df <- do.call(rbind, curves)
  p2 <- plot_response_curves(combined_df)
  expect_true(inherits(p2, "ggplot"))
})

test_that("plot_response_curves saves PNG files when out_dir provided", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 30)

  out_dir <- tempdir()
  plot_response_curves(curves, out_dir = out_dir, ncol = 2)

  expect_true(file.exists(file.path(out_dir, "response_curve_bio1.png")))
  expect_true(file.exists(file.path(out_dir, "response_curve_bio12.png")))
  expect_true(file.exists(file.path(out_dir, "response_curves_combined.png")))
})

test_that("response curves work without env_train (fallback to model_data ranges)", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = NULL, n_points = 30)

  expect_true(is.list(curves))
  expect_equal(length(curves), 2)
  for (cov in names(curves)) {
    expect_true("covariate" %in% names(curves[[cov]]))
    expect_true("value" %in% names(curves[[cov]]))
    expect_true("suitability" %in% names(curves[[cov]]))
  }
})

test_that("GLM response curves are in [0,1] range and monotonically related to predictor", {
  skip_if_no_terra()
  test_data <- make_test_fit()
  curves <- compute_response_curves(test_data$fit, test_data$fit$model_data, env_train = test_data$env, n_points = 50)

  for (cov_name in names(curves)) {
    cv <- curves[[cov_name]]
    expect_false(is.null(cv))
    expect_true("x" %in% names(cv))
    expect_true("fitted" %in% names(cv))
    expect_true(all(cv$fitted >= 0, na.rm = TRUE))
    expect_true(all(cv$fitted <= 1, na.rm = TRUE))
    mid <- nrow(cv) / 2
    expect_true(abs(cv$fitted[mid] - 0.5) < 0.3)
  }
})

test_that("MaxNet response curves use type='response' via explicit predict.maxnet call", {
  skip_if_not_installed("mockery")
  if (!requireNamespace("maxnet", quietly = TRUE)) {
    skip("maxnet not installed")
  }

  model_env <- new.env()
  assign("predict_called_with_type", NULL, envir = model_env)

  mock_predict_maxnet <- function(model, newdata, clamp, type) {
    assign("predict_called_with_type", type, envir = model_env)
    if (!identical(type, "response")) {
      stop("predict.maxnet was called with type='", type, "', expected 'response'")
    }
    rep(0.5, nrow(newdata))
  }

  mockery::stub("compute_response_curves", "predict", mock_predict_maxnet)

  fit_mock <- list(
    model = structure(list(), class = "maxnet"),
    model_data = data.frame(bio1 = seq(0, 1, length.out = 30), bio12 = seq(0, 1, length.out = 30))
  )

  curves <- compute_response_curves(fit_mock, fit_mock$model_data, env_train = NULL, n_points = 30)

  expect_false(is.null(model_env$predict_called_with_type))
  expect_equal(model_env$predict_called_with_type, "response")
  expect_true(is.list(curves))
})
