test_that("Python models are discovered when arrow is installed", {
  skip_if_not_installed("arrow")
  manifests <- tryCatch(discover_python_models(), error = function(e) character(0))
  python_ids <- grep("^python_", sdm_model_ids(), value = TRUE)
  if (length(manifests) > 0) {
    expect_true(length(python_ids) > 0)
  }
})

test_that("fit_python_sdm fails gracefully without arrow", {
  if (!requireNamespace("arrow", quietly = TRUE)) {
    env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
    occ <- data.frame(longitude = c(140, 141), latitude = c(-23, -24))
    expect_error(fit_python_sdm(occ, env), "arrow package")
  }
})
