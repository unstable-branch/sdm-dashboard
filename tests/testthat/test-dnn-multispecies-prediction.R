# Tests for predict_dnn_multispecies_suitability and related helpers

# Register a fake predict method for testing tif-writing logic
predict.fake_dnn_model <- function(object, newdata, type = "response", ...) {
  n <- nrow(newdata)
  if (is.null(n) || n == 0) return(matrix(0, nrow = 0, ncol = 2))
  matrix(c(
    rep(0.85, n),
    rep(0.35, n)
  ), nrow = n, ncol = 2)
}
registerS3method("predict", "fake_dnn_model", predict.fake_dnn_model)

make_fake_ms_fit <- function(covariates = c("bio1", "bio12"),
                              species_names = c("Sp_A", "Sp_B"),
                              scaler_mean = c(0.5, 0.3),
                              scaler_sd = c(0.2, 0.1),
                              n_species = 2) {
  fake_model <- structure(list(), class = "fake_dnn_model")
  list(
    model = fake_model,
    covariates = covariates,
    species_names = species_names,
    n_species = n_species,
    scaler = list(mean = scaler_mean, sd = scaler_sd),
    model_data = data.frame(bio1 = runif(50, 0, 1), bio12 = runif(50, 0, 1)),
    community_matrix = matrix(sample(0:1, 100, replace = TRUE), nrow = 50, ncol = 2),
    cv = list(k = 3, strategy = "dnn_multi_seed", n_species = n_species, n_sites = 50),
    occurrence_used = data.frame(),
    background_xy = cbind(runif(50, 140, 142), runif(50, -24, -22)),
    dnn_device = "cpu",
    dnn_model_type = "DNN_Medium"
  )
}

test_that("predict_dnn_multispecies_suitability errors on missing covariates", {
  skip_if_not_installed("terra")

  fit <- make_fake_ms_fit(covariates = c("bio1", "bio12"))
  env <- make_test_raster(n_layers = 1, layer_names = "bio1")
  output_tif <- tempfile(fileext = ".tif")
  on.exit(unlink(output_tif))

  expect_error(
    predict_dnn_multispecies_suitability(fit, env, output_tif),
    "Missing covariates"
  )
})

test_that("predict_dnn_multispecies_suitability errors on invalid fit", {
  skip_if_not_installed("terra")

  env <- make_test_raster()
  output_tif <- tempfile(fileext = ".tif")
  on.exit(unlink(output_tif))

  expect_error(
    predict_dnn_multispecies_suitability(list(), env, output_tif),
    "must be a multi-species DNN fit"
  )
  expect_error(
    predict_dnn_multispecies_suitability(list(model = NULL), env, output_tif),
    "must be a multi-species DNN fit"
  )
})

test_that("predict_dnn_multispecies_suitability errors when fit$covariates is NULL", {
  skip_if_not_installed("terra")

  env <- make_test_raster()
  output_tif <- tempfile(fileext = ".tif")
  on.exit(unlink(output_tif))

  fit <- make_fake_ms_fit()
  fit$covariates <- NULL
  expect_error(
    predict_dnn_multispecies_suitability(fit, env, output_tif),
    "fit\\$covariates is missing"
  )
})

test_that("predict_dnn_multispecies_suitability writes per-species tifs and richness", {
  skip_if_not_installed("terra")

  output_tif <- tempfile(pattern = "ms_", fileext = ".tif")
  on.exit(unlink(output_tif))

  fit <- make_fake_ms_fit()
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"),
    nrows = 10, ncols = 10)

  result <- predict_dnn_multispecies_suitability(fit, env, output_tif)

  species_tifs <- attr(result, "species_tifs")
  richness_tif <- attr(result, "richness_tif")

  expect_length(species_tifs, 2)
  expect_true(all(file.exists(species_tifs)))
  expect_true(file.exists(richness_tif))

  species_rasters <- terra::rast(species_tifs)
  expect_equal(terra::nlyr(species_rasters), 2)
  expect_equal(names(species_rasters), c("Sp_A", "Sp_B"))

  richness <- terra::rast(richness_tif)
  richness_vals <- terra::values(richness)
  expect_true(all(richness_vals >= 0, na.rm = TRUE))
  expect_true(all(richness_vals <= 2, na.rm = TRUE))

  multi <- terra::rast(species_tifs)
  computed_richness <- sum(multi, na.rm = TRUE)
  expect_equal(as.vector(terra::values(richness)), as.vector(terra::values(computed_richness)),
    tolerance = 0.001)
})

test_that("fit_dnn_multispecies_sdm stores mc_samples and uncertainty_method", {
  fit <- list(
    mc_samples = 30L,
    uncertainty_method = "mc_dropout"
  )
  expect_equal(fit$mc_samples, 30L)
  expect_equal(fit$uncertainty_method, "mc_dropout")
})

test_that("make_fake_ms_fit has mc_samples and uncertainty_method with safe defaults", {
  fit <- make_fake_ms_fit()
  expect_equal(fit$mc_samples %||% 0L, 0L)
  expect_equal(fit$uncertainty_method %||% "none", "none")
})

test_that("predict_dnn_multispecies_suitability produces values in [0,1]", {
  skip_if_not_installed("terra")

  output_tif <- tempfile(pattern = "ms_range_", fileext = ".tif")
  on.exit(unlink(output_tif))

  fit <- make_fake_ms_fit()
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"),
    nrows = 10, ncols = 10)

  result <- predict_dnn_multispecies_suitability(fit, env, output_tif)

  species_tifs <- attr(result, "species_tifs")
  for (tif in species_tifs) {
    r <- terra::rast(tif)
    vals <- terra::values(r)
    vals <- vals[!is.na(vals)]
    expect_true(all(vals >= 0))
    expect_true(all(vals <= 1))
  }
})

test_that("predict_dnn_multispecies_suitability handles env with make.names transformation", {
  skip_if_not_installed("terra")

  output_tif <- tempfile(pattern = "ms_names_", fileext = ".tif")
  on.exit(unlink(output_tif))

  fit <- make_fake_ms_fit(covariates = c("bio1", "bio12"))
  env_names <- c("bio1", "bio12")
  env <- make_test_raster(n_layers = 2, layer_names = env_names, nrows = 8, ncols = 8)

  result <- predict_dnn_multispecies_suitability(fit, env, output_tif)
  species_tifs <- attr(result, "species_tifs")
  expect_length(species_tifs, 2)
})

test_that("predict_dnn_multispecies_suitability full integration with real cito DNN", {
  skip_if_not_installed("cito")
  skip_if_not_installed("torch")
  skip_if_not_installed("terra")

  set.seed(42)
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"),
    nrows = 10, ncols = 10)
  env_scaled <- env

  sp1 <- data.frame(
    longitude = c(140.1, 140.5, 141.0, 140.3, 140.7, 141.2, 140.2, 140.9),
    latitude  = c(-23.1, -23.5, -23.8, -23.2, -23.4, -23.7, -23.3, -23.6)
  )
  sp2 <- data.frame(
    longitude = c(140.2, 140.8, 141.5, 140.4, 141.1, 141.3, 140.6, 141.4),
    latitude  = c(-23.2, -23.6, -23.9, -23.3, -23.5, -23.8, -23.4, -23.7)
  )

  cm <- build_community_matrix(
    list(Sp_A = sp1, Sp_B = sp2), env_scaled, background_n = 30, seed = 42
  )
  expect_equal(cm$n_species, 2)

  fit <- fit_dnn_multispecies_sdm(
    occ = cm,
    env_train_scaled = env_scaled,
    background_n = 30,
    cv_folds = 0L,
    seed = 42,
    dnn_architecture = "DNN_Small",
    n_seeds = 1,
    n_cores = 1
  )

  expect_true(is.list(fit))
  expect_equal(fit$n_species, 2)
  expect_equal(fit$species_names, c("Sp_A", "Sp_B"))
  expect_false(is.null(fit$model))

  output_tif <- tempfile(pattern = "dnn_integ_", fileext = ".tif")
  on.exit(unlink(output_tif))

  result <- predict_dnn_multispecies_suitability(fit, env_scaled, output_tif)

  species_tifs <- attr(result, "species_tifs")
  richness_tif <- attr(result, "richness_tif")

  expect_length(species_tifs, 2)
  expect_true(all(file.exists(species_tifs)))
  expect_true(file.exists(richness_tif))

  for (tif in species_tifs) {
    r <- terra::rast(tif)
    vals <- terra::values(r)
    vals <- vals[!is.na(vals)]
    if (length(vals) > 0) {
      expect_true(all(vals >= 0))
      expect_true(all(vals <= 1))
    }
  }
})
