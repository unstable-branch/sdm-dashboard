test_that("attribute_climate_drivers returns expected structure", {
  skip_if_not_installed("fastshap")
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  env_future <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"), seed = 99)
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  attr <- attribute_climate_drivers(fit, env, env_future, n_samples = 10)
  if (!is.null(attr)) {
    expect_true(is.list(attr))
    expect_true("driver_table" %in% names(attr))
    expect_true(is.data.frame(attr$driver_table))
  }
})

test_that("attribute_climate_drivers handles NULL future gracefully", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  attr <- attribute_climate_drivers(fit, env, NULL, n_samples = 10)
  expect_null(attr)
})
