test_that("predict_dnn_mc returns mean/sd/cv rasters on CPU", {
  skip_if_not(requireNamespace("cito", quietly = TRUE))
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not("dnn" %in% sdm_model_ids())

  set.seed(42)
  env <- make_test_raster(nrows = 40, ncols = 40, n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 30),
    latitude = seq(-23.85, -22.15, length.out = 30),
    source = rep(c("A", "B"), each = 15),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model(
    "dnn", occ, env,
    background_n = 120, cv_folds = 2, seed = 42, n_cores = 1,
    dnn_model_type = "DNN_Small", dnn_device = "cpu", n_seeds = 1L,
    mc_samples = 0L, uncertainty_method = "none"
  )

  mc_result <- predict_dnn_mc(
    fit$model, env, fit$scaler,
    device = "cpu", batch_size = 100L, mc_samples = 5L,
    decompose = FALSE
  )

  expect_true(inherits(mc_result$mean, "SpatRaster"))
  expect_true(inherits(mc_result$sd, "SpatRaster"))
  expect_true(inherits(mc_result$cv, "SpatRaster"))
  expect_equal(names(mc_result$mean), "suitability")
  expect_equal(names(mc_result$sd), "uncertainty_sd")
  expect_equal(names(mc_result$cv), "uncertainty_cv")

  mean_vals <- terra::values(mc_result$mean)
  sd_vals <- terra::values(mc_result$sd)
  expect_true(all(mean_vals >= 0 & mean_vals <= 1, na.rm = TRUE))
  expect_true(all(sd_vals >= 0, na.rm = TRUE))
})

test_that("predict_dnn_mc decomposition returns aleatoric/epistemic/total", {
  skip_if_not(requireNamespace("cito", quietly = TRUE))
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not("dnn" %in% sdm_model_ids())

  set.seed(42)
  env <- make_test_raster(nrows = 40, ncols = 40, n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 30),
    latitude = seq(-23.85, -22.15, length.out = 30),
    source = rep(c("A", "B"), each = 15),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model(
    "dnn", occ, env,
    background_n = 120, cv_folds = 2, seed = 42, n_cores = 1,
    dnn_model_type = "DNN_Small", dnn_device = "cpu", n_seeds = 1L,
    mc_samples = 0L, uncertainty_method = "none"
  )

  mc_result <- predict_dnn_mc(
    fit$model, env, fit$scaler,
    device = "cpu", batch_size = 100L, mc_samples = 10L,
    decompose = TRUE
  )

  expect_true(inherits(mc_result$aleatoric, "SpatRaster"))
  expect_true(inherits(mc_result$epistemic, "SpatRaster"))
  expect_true(inherits(mc_result$total, "SpatRaster"))
  expect_equal(names(mc_result$aleatoric), "aleatoric")
  expect_equal(names(mc_result$epistemic), "epistemic")
  expect_equal(names(mc_result$total), "total")

  alea_vals <- terra::values(mc_result$aleatoric)
  epi_vals <- terra::values(mc_result$epistemic)
  total_vals <- terra::values(mc_result$total)

  expect_true(all(alea_vals >= 0, na.rm = TRUE))
  expect_true(all(epi_vals >= 0, na.rm = TRUE))
  expect_true(all(total_vals >= 0, na.rm = TRUE))

  valid <- !is.na(total_vals)
  expect_true(all(abs(total_vals[valid] - (alea_vals[valid] + epi_vals[valid])) < 1e-10))
})

test_that("aleatoric variance equals p*(1-p) for Bernoulli with constant predictions", {
  p <- 0.7
  mc_matrix <- matrix(rep(p, 30), nrow = 1, ncol = 30)
  aleatoric <- mean(mc_matrix * (1 - mc_matrix))
  expected_alea <- p * (1 - p)
  expect_equal(aleatoric, expected_alea, tolerance = 1e-12)
})

test_that("epistemic variance is zero when predictions are identical", {
  p <- 0.6
  mc_matrix <- matrix(rep(p, 30), nrow = 1, ncol = 30)
  mean_p <- mean(mc_matrix)
  mean_sq <- mean(mc_matrix^2)
  epistemic <- max(mean_sq - mean_p^2, 0)
  expect_equal(epistemic, 0, tolerance = 1e-12)
})

test_that("epistemic variance is positive when predictions vary", {
  set.seed(42)
  mc_matrix <- matrix(runif(30, 0.3, 0.9), nrow = 1, ncol = 30)
  mean_p <- mean(mc_matrix)
  mean_sq <- mean(mc_matrix^2)
  epistemic <- max(mean_sq - mean_p^2, 0)
  expect_true(epistemic > 0)
})

test_that("population variance matches E[X^2] - E[X]^2", {
  set.seed(42)
  mc_matrix <- matrix(runif(100, 0.2, 0.8), nrow = 1, ncol = 100)
  mean_p <- mean(mc_matrix)
  mean_sq <- mean(mc_matrix^2)
  pop_var <- mean_sq - mean_p^2
  expect_equal(pop_var, mean((mc_matrix - mean_p)^2), tolerance = 1e-12)
})

test_that("decomposition satisfies total = aleatoric + epistemic", {
  set.seed(42)
  mc_matrix <- matrix(runif(100, 0.1, 0.9), nrow = 1, ncol = 100)
  mean_p <- mean(mc_matrix)
  aleatoric <- mean(mc_matrix * (1 - mc_matrix))
  mean_sq <- mean(mc_matrix^2)
  epistemic <- max(mean_sq - mean_p^2, 0)
  total <- aleatoric + epistemic
  expect_true(total >= aleatoric)
  expect_true(total >= epistemic)
  expect_true(total <= 0.25 + 0.01)
})

test_that("predict_dnn_mc returns null decomposition when mc_samples < 2", {
  skip_if_not(requireNamespace("cito", quietly = TRUE))
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not("dnn" %in% sdm_model_ids())

  set.seed(42)
  env <- make_test_raster(nrows = 40, ncols = 40, n_layers = 2, layer_names = c("bio1", "bio12"))
  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 30),
    latitude = seq(-23.85, -22.15, length.out = 30),
    source = rep(c("A", "B"), each = 15),
    stringsAsFactors = FALSE
  )

  fit <- fit_sdm_model(
    "dnn", occ, env,
    background_n = 120, cv_folds = 2, seed = 42, n_cores = 1,
    dnn_model_type = "DNN_Small", dnn_device = "cpu", n_seeds = 1L,
    mc_samples = 0L, uncertainty_method = "none"
  )

  mc_result <- predict_dnn_mc(
    fit$model, env, fit$scaler,
    device = "cpu", batch_size = 100L, mc_samples = 1L,
    decompose = TRUE
  )

  expect_null(mc_result$aleatoric)
  expect_null(mc_result$epistemic)
  expect_null(mc_result$total)
})

test_that("DNN model registry flags supports_uncertainty", {
  if (!("dnn" %in% sdm_model_ids())) skip("DNN not in registry")
  spec <- get_sdm_model("dnn")
  expect_true(isTRUE(spec$supports_uncertainty))
})

test_that("sdm_config accepts dnn_mc_samples and dnn_uncertainty_method", {
  cfg <- sdm_config(
    species = "Test",
    occurrence_file = "test.csv",
    selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22),
    model_id = "dnn",
    dnn_mc_samples = 30L,
    dnn_uncertainty_method = "heteroscedastic"
  )
  expect_equal(cfg$dnn_mc_samples, 30L)
  expect_equal(cfg$dnn_uncertainty_method, "heteroscedastic")
})

test_that("build_run_args maps dnn_mc_samples as integer", {
  row <- list(
    species = "Test",
    model_id = "dnn",
    biovars = "1,12",
    projection_extent = "140,142,-24,-22",
    dnn_mc_samples = "30",
    dnn_uncertainty_method = "mc_dropout"
  )
  args <- build_run_args(row)
  expect_equal(args$dnn_mc_samples, 30L)
  expect_equal(args$dnn_uncertainty_method, "mc_dropout")
})
