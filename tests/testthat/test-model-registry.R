test_that("model registry exposes the GLM backend", {
  expect_equal(validate_sdm_model_id(NULL), sdm_default_model_id)
  expect_equal(validate_sdm_model_id("glm"), "glm")
  expect_error(validate_sdm_model_id("random_forest"), "Unknown SDM model backend")

  glm_spec <- get_sdm_model("glm")
  expect_equal(glm_spec$id, "glm")
  expect_equal(glm_spec$label, "GLM / Logistic regression")
  expect_true(nzchar(glm_spec$method))
  expect_true(is.function(glm_spec$fit_fun))
  expect_true(is.function(glm_spec$predict_fun))
  expect_true("glm" %in% sdm_model_ids())
  expect_true("gam" %in% sdm_model_ids())
  expect_true("rangebag" %in% sdm_model_ids())
  expect_true("ensemble_glm_rangebag" %in% sdm_model_ids())
  expect_true(exists("fit_fast_sdm", mode = "function"))

  rangebag_spec <- get_sdm_model("rangebag")
  expect_equal(rangebag_spec$id, "rangebag")
  expect_equal(rangebag_spec$label, "Rangebagging")
  expect_true(is.function(rangebag_spec$fit_fun))
  expect_true(is.function(rangebag_spec$predict_fun))
})

test_that("GLM registry fit preserves the legacy result contract", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping registry fit contract test because terra is not installed")
  } else {
  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  direct <- fit_fast_sdm(occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)
  via_registry <- fit_sdm_model("glm", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)

  expect_equal(via_registry$model_id, "glm")
  expect_equal(via_registry$model_label, "GLM / Logistic regression")
  expect_true(inherits(via_registry$model, "glm"))
  expect_true(inherits(via_registry$formula, "formula"))
  expect_true(is.data.frame(via_registry$coefficients))
  expect_true(is.list(via_registry$cv))
  expect_equal(nrow(via_registry$occurrence_used), nrow(direct$occurrence_used))
  expect_equal(nrow(via_registry$background_xy), nrow(direct$background_xy))
  expect_equal(attr(stats::terms(via_registry$formula), "term.labels"), attr(stats::terms(direct$formula), "term.labels"))
  }
})

test_that("model registry prediction dispatch writes a suitability raster", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping registry prediction dispatch test because terra is not installed")
  } else {
  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model("glm", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)
  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_sdm_model(fit, env, output_tif, n_cores = 1)

  expect_true(inherits(suit, "SpatRaster"))
  expect_equal(names(suit), "suitability")
  expect_true(file.exists(output_tif))
  }
})
