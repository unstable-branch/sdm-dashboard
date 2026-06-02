test_that("Multi-species DNN registry entry absent when cito not installed", {
  ids <- sdm_model_ids()
  if (!requireNamespace("cito", quietly = TRUE) || !requireNamespace("torch", quietly = TRUE)) {
    expect_false("dnn_multispecies" %in% ids)
  } else {
    expect_true("dnn_multispecies" %in% ids)
  }
})

test_that("build_community_matrix works with species list", {
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  sp1 <- data.frame(longitude = c(140.1, 140.5, 141.0), latitude = c(-23.1, -23.5, -23.8))
  sp2 <- data.frame(longitude = c(140.2, 140.8, 141.5), latitude = c(-23.2, -23.6, -23.9))
  cm <- build_community_matrix(list(species_a = sp1, species_b = sp2), env, background_n = 50, seed = 42)
  expect_true(is.list(cm))
  expect_equal(cm$n_species, 2)
  expect_equal(ncol(cm$community_mat), 2)
  expect_true(cm$n_sites >= 10)
  expect_true(is.character(cm$species_names))
})

test_that("build_community_matrix works with single CSV containing species column", {
  skip_if_not_installed("terra")
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
  multi_csv <- data.frame(
    species = rep(c("sp_a", "sp_b"), each = 5),
    longitude = c(seq(140.1, 141.0, length.out = 5), seq(140.2, 141.2, length.out = 5)),
    latitude = c(rep(-23.5, 5), rep(-23.8, 5)),
    stringsAsFactors = FALSE
  )
  cm <- build_community_matrix(multi_csv, env, background_n = 50, seed = 42)
  expect_equal(cm$n_species, 2)
  expect_true(is.matrix(cm$community_mat))
})

test_that("dnn multispecies and multi-ensemble snake_case config fields are retained", {
  model_id <- if (requireNamespace("cito", quietly = TRUE) && requireNamespace("torch", quietly = TRUE)) {
    "dnn_multispecies"
  } else {
    "bioclim"
  }
  cfg <- sdm_config(
    species = "multi_test",
    occurrence_file = tempfile(fileext = ".csv"),
    projection_extent = c(112, 154, -44, -10),
    model_id = model_id,
    dnn_multispecies_architecture = "DNN_Small",
    dnn_multispecies_n_seeds = 5L,
    multi_ensemble_models = c("rf", "maxnet"),
    multi_ensemble_weighting = "equal",
    multi_ensemble_power = 2L,
    multi_ensemble_min_auc = 0.75,
    multi_ensemble_min_tss = 0.35,
    multi_ensemble_export = TRUE,
    multi_ensemble_uncertainty = FALSE,
    biomod2_models = c("brt", "cta")
  )

  expect_equal(cfg$dnn_multispecies_architecture, "DNN_Small")
  expect_equal(cfg$dnn_multispecies_n_seeds, 5L)
  expect_identical(cfg$multi_ensemble_models, c("rf", "maxnet"))
  expect_equal(cfg$multi_ensemble_weighting, "equal")
  expect_equal(cfg$multi_ensemble_power, 2L)
  expect_equal(cfg$multi_ensemble_min_auc, 0.75)
  expect_equal(cfg$multi_ensemble_min_tss, 0.35)
  expect_true(isTRUE(cfg$multi_ensemble_export))
  expect_true(!isTRUE(cfg$multi_ensemble_uncertainty))
  expect_identical(cfg$biomod2_models, c("brt", "cta"))
})
