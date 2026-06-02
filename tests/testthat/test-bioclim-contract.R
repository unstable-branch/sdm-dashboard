test_that("BIOCLIM backend fits and predicts through the registry", {
  skip_if_not("bioclim" %in% sdm_model_ids())

  set.seed(42)
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model("bioclim", occ, env, cv_folds = 2, seed = 99, n_cores = 1)
  expect_equal(fit$model_id, "bioclim")
  expect_true(is.list(fit$model))
  expect_true(!is.null(fit$model_data))

  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_sdm_model(fit, env, output_tif, n_cores = 1)
  expect_true(inherits(suit, "SpatRaster"))
  expect_equal(names(suit), "suitability")
  expect_true(file.exists(output_tif))
})
