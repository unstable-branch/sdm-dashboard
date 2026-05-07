test_that("MaxEnt backend contract test", {
  skip_if_not_installed("maxnet")

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

  fit <- fit_sdm_model("maxnet", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 3, seed = 99, n_cores = 1)

  expect_equal(fit$model_id, "maxnet")
  expect_true(is.list(fit$model))
  expect_null(fit$formula)
  expect_true(is.data.frame(fit$coefficients))
  expect_true(is.list(fit$cv))
  expect_equal(nrow(fit$occurrence_used), 24)
  expect_true(nrow(fit$background_xy) >= 100)
  expect_true(is.character(fit$covariates))
  expect_true(is.data.frame(fit$variable_importance))
  expect_equal(nrow(fit$variable_importance), 2)
  expect_true("variable" %in% names(fit$variable_importance))
  expect_true("importance" %in% names(fit$variable_importance))
})

test_that("MaxEnt prediction writes a GeoTIFF", {
  skip_if_not_installed("maxnet")

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  r1[1] <- NA
  r2[1] <- NA
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model("maxnet", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)
  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_sdm_model(fit, env, output_tif, n_cores = 1)

  expect_true(inherits(suit, "SpatRaster"))
  expect_equal(names(suit), "suitability")
  expect_true(file.exists(output_tif))
})

test_that("MaxEnt CV produces finite AUC", {
  skip_if_not_installed("maxnet")

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

  fit <- fit_sdm_model("maxnet", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 3, seed = 99, n_cores = 1)

  expect_equal(fit$cv$k, 3)
  expect_true(is.finite(fit$cv$auc_mean))
  expect_true(is.finite(fit$cv$tss_mean))
})

test_that("MaxEnt registry exposes maxnet backend", {
  skip_if_not_installed("maxnet")

  expect_true("maxnet" %in% sdm_model_ids())
  spec <- get_sdm_model("maxnet")
  expect_equal(spec$id, "maxnet")
  expect_equal(spec$label, "MaxEnt (maxnet)")
  expect_true("maxnet" %in% spec$packages)
  expect_true("glmnet" %in% spec$packages)
  expect_true(is.function(spec$fit_fun))
  expect_true(is.function(spec$predict_fun))
})

test_that("MaxEnt variable_importance has one row per covariate", {
  skip_if_not_installed("maxnet")

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

  fit <- fit_sdm_model("maxnet", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)

  expect_equal(nrow(fit$variable_importance), length(fit$covariates))
  expect_true(all(fit$variable_importance$variable %in% fit$covariates))
})