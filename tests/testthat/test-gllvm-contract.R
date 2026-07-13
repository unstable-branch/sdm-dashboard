# Contract tests for gllvm JSDM backend

test_that("gllvm registry entry absent when gllvm not installed", {
  ids <- sdm_model_ids()
  if (!requireNamespace("gllvm", quietly = TRUE)) {
    expect_false("gllvm" %in% ids)
  } else {
    expect_true("gllvm" %in% ids)
  }
})

test_that("gllvm snake_case config fields are retained by normalizer", {
  cfg <- sdm_config(
    species = "gllvm_test",
    occurrence_file = tempfile(fileext = ".csv"),
    projection_extent = c(112, 154, -44, -10),
    model_id = if (requireNamespace("gllvm", quietly = TRUE)) "gllvm" else "bioclim",
    gllvm_family = "binomial",
    gllvm_num_lv = 3L,
    gllvm_num_rows = 1L,
    gllvm_lv_corr = TRUE
  )

  expect_equal(cfg$gllvm_family, "binomial")
  expect_equal(cfg$gllvm_num_lv, 3L)
  expect_equal(cfg$gllvm_num_rows, 1L)
  expect_true(isTRUE(cfg$gllvm_lv_corr))
})

test_that("gllvm multi-species output paths are collected", {
  suit <- list()
  species_tifs <- c(
    tempfile(pattern = "sp-a-", fileext = ".tif"),
    tempfile(pattern = "sp-b-", fileext = ".tif")
  )
  richness_tif <- tempfile(pattern = "richness-", fileext = ".tif")
  attr(suit, "species_tifs") <- species_tifs
  attr(suit, "richness_tif") <- richness_tif

  paths <- sdm_multispecies_output_paths(suit)

  expect_equal(paths$multi_species_tif_count, "2")
  expect_equal(paths$multi_species_tif_1, species_tifs[[1]])
  expect_equal(paths$multi_species_tif_2, species_tifs[[2]])
  expect_equal(paths$multi_species_richness_tif, richness_tif)
})

test_that("gllvm output path collector handles absent attrs", {
  paths <- sdm_multispecies_output_paths(list())
  expect_equal(paths, list())
})
