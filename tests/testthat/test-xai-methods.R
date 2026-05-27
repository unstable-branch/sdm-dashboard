test_that("xai_importance dispatches to native when available", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  imp <- xai_importance(fit, method = "auto", seed = 99, n_cores = 1)
  expect_true(is.data.frame(imp) || is.null(imp))
  if (is.data.frame(imp) && nrow(imp) > 0) {
    expect_true(all(c("variable", "importance") %in% names(imp)))
  }
})

test_that("xai_pdp returns response curves structure", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  rc <- xai_pdp(fit)
  expect_true(is.list(rc))
  if (length(rc) > 0) {
    expect_true(all(vapply(rc, is.data.frame, logical(1))))
  }
})

test_that("xai_ale returns ALE structure gracefully", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  ale <- xai_ale(fit)
  expect_true(is.list(ale))
})

test_that("build_importance_predict_fun returns a function", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  fn <- build_importance_predict_fun(fit)
  expect_true(is.function(fn))
})
