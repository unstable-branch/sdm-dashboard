test_that("compute_shap skips gracefully without fastshap", {
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)

  if (!requireNamespace("fastshap", quietly = TRUE)) {
    shap <- compute_shap(fit, n_samples = 10)
    expect_null(shap)
  } else {
    shap <- compute_shap(fit, n_samples = 10)
    if (!is.null(shap)) {
      expect_true(is.list(shap))
      expect_true("summary" %in% names(shap))
      expect_true(is.data.frame(shap$summary))
      expect_true(all(c("variable", "importance") %in% names(shap$summary)))
    }
  }
})

test_that("compute_shap_cell returns named numeric", {
  skip_if_not_installed("fastshap")
  skip_if_not("glm" %in% sdm_model_ids())
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = "A", stringsAsFactors = FALSE
  )
  fit <- fit_sdm_model("glm", occ, env, background_n = 100, cv_folds = 2, seed = 99, n_cores = 1)
  cell_vals <- c(bio1 = 0.5, bio12 = 0.3)
  shap <- compute_shap_cell(fit, cell_vals, n_samples = 10)
  if (!is.null(shap)) {
    expect_true(is.numeric(shap))
    expect_equal(names(shap), fit$covariates)
  }
})
