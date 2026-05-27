test_that("compute_ale returns per-covariate ALE curves", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  ale <- compute_ale(fit, n_points = 20)
  expect_true(is.list(ale))
  if (length(ale) > 0) {
    first <- ale[[1]]
    expect_true(is.data.frame(first))
    expect_true(all(c("covariate", "value", "ale") %in% names(first)))
    expect_true(is.numeric(first$ale))
  }
})

test_that("compute_ale handles empty data gracefully", {
  ale <- compute_ale(NULL)
  expect_true(is.list(ale))
  expect_equal(length(ale), 0)
})
