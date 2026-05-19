# Tests for multi-ensemble predict function (comp_cv fix).


test_that("predict_multi_model_ensemble handles NULL user_threshold without comp_cv error", {
  skip_if_not(requireNamespace("ranger", quietly = TRUE))
  skip_if_not(requireNamespace("maxnet", quietly = TRUE))

  occ_df <- data.frame(
    longitude = runif(50, 140, 150),
    latitude = runif(50, -35, -25)
  )
  env_data <- terra::rast(nrows = 20, ncols = 20, xmin = 139, xmax = 151, ymin = -36, ymax = -24)
  terra::values(env_data) <- matrix(rnorm(800), ncol = 2)
  names(env_data) <- c("BIO1", "BIO12")

  fit_glm <- tryCatch(fit_fast_sdm(occ_df, env_data, c("BIO1", "BIO12"),
    background_n = 100, cv_folds = 3, seed = 42L), error = function(e) NULL)
  skip_if(is.null(fit_glm), "GLM fit failed")

  fit_rf <- tryCatch(fit_rf_sdm(occ_df, env_data, c("BIO1", "BIO12"),
    background_n = 100, cv_folds = 3, seed = 42L), error = function(e) NULL)
  skip_if(is.null(fit_rf), "RF fit failed")

  multi_fit <- tryCatch(fit_multi_model_ensemble(
    list(glm = fit_glm, rf = fit_rf),
    env_data, c("BIO1", "BIO12"), weighting = "auc", seed = 42L
  ), error = function(e) NULL)
  skip_if(is.null(multi_fit), "Multi-ensemble fit failed")

  out_tif <- tempfile(fileext = ".tif")
  result <- tryCatch(
    predict_multi_model_ensemble(multi_fit, env_data, out_tif, n_cores = 1,
      log_fun = NULL, user_threshold = NULL),
    error = function(e) NULL
  )
  expect_true(!is.null(result), "predict_multi_model_ensemble should not error with NULL user_threshold")
  expect_true(inherits(result, "SpatRaster"))
})
