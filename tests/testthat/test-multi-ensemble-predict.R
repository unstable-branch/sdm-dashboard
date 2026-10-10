# Tests for multi-ensemble predict function (comp_cv fix).
# Exercises the real fit/predict API; failures surface as test failures, not skips.

test_that("predict_multi_model_ensemble handles NULL user_threshold without comp_cv error", {
  skip_if_not_installed("mgcv")

  set.seed(42)
  env_data <- terra::rast(nrows = 30, ncols = 30, xmin = 0, xmax = 30,
                          ymin = 0, ymax = 30, crs = "EPSG:4326", nlyrs = 2)
  terra::values(env_data) <- matrix(rnorm(terra::ncell(env_data) * 2L), ncol = 2L)
  names(env_data) <- c("BIO1", "BIO12")
  xy <- terra::xyFromCell(env_data, seq(5L, 880L, length.out = 40L))
  occ_df <- data.frame(species = "Synthetic", longitude = xy[, 1], latitude = xy[, 2])

  multi_fit <- fit_multi_model_ensemble(
    occ_df, env_data, selected_models = c("glm", "gam"),
    ensemble_weighting = "auc", background_n = 300L, include_quadratic = FALSE,
    cv_folds = 3L, cv_strategy = "random", seed = 42L, n_cores = 1L
  )
  expect_setequal(names(multi_fit$model$components), c("glm", "gam"))

  out_tif <- tempfile(fileext = ".tif")
  on.exit(unlink(Sys.glob(sub("[.]tif$", "*", out_tif))), add = TRUE)
  result <- predict_multi_model_ensemble(multi_fit, env_data, out_tif, n_cores = 1,
    log_fun = NULL, user_threshold = NULL)

  expect_s4_class(result, "SpatRaster")
  expect_equal(terra::nlyr(result), 1L)
  vals <- as.numeric(terra::values(result))
  expect_true(any(is.finite(vals)))
  expect_true(all(vals[is.finite(vals)] >= 0 & vals[is.finite(vals)] <= 1))
  expect_true(file.exists(out_tif))
})
