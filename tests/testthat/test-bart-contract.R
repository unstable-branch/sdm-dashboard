test_that("BART backend fits and predicts through the registry", {
  skip_if_not_installed("dbarts")
  skip_if_not("bart" %in% sdm_model_ids())

  set.seed(42)
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model("bart", occ, env, background_n = 120, cv_folds = 2, seed = 99, n_cores = 1, ntree = 20, ndpost = 100, nskip = 50)
  expect_equal(fit$model_id, "bart")
  expect_true(is.list(fit$model))
  expect_true(is.list(fit$cv))
  expect_true(is.finite(fit$cv$auc_mean))

  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_sdm_model(fit, env, output_tif, n_cores = 1)
  expect_true(inherits(suit, "SpatRaster"))
  expect_equal(names(suit), "suitability")
  expect_true(file.exists(output_tif))
})

test_that("BART component fit/predict works for ensemble", {
  skip_if_not_installed("dbarts")
  skip_if_not("bart" %in% sdm_model_ids())
  spec <- get_sdm_model("bart")
  expect_true(is.function(spec$fit_component_fun))
  expect_true(is.function(spec$predict_component_fun))
})
