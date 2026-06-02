test_that("brms registry entry absent when brms not installed", {
  ids <- sdm_model_ids()
  if (!requireNamespace("brms", quietly = TRUE)) {
    expect_false("brms" %in% ids)
  } else {
    expect_true("brms" %in% ids)
  }
})

test_that("fit_brms_sdm fails gracefully without brms", {
  if (!requireNamespace("brms", quietly = TRUE)) {
    env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
    occ <- data.frame(longitude = c(140, 141), latitude = c(-23, -24))
    expect_error(fit_brms_sdm(occ, env), "brms package")
  }
})
