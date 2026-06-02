# Snapshot tests for SDM model outputs
#
# These tests run each backend once with fixed seed + synthetic data,
# then compare outputs against reference snapshots.
#
# To regenerate reference snapshots:
#   Rscript scripts/generate_snapshots.R
#
# Reference rasters are stored in tests/testthat/_snaps/rasters/

test_that("GLM suitability raster matches reference snapshot", {
  skip_if_not_installed("terra")
  skip_on_cran()

  ref_path <- testthat::test_path("_snaps", "rasters", "glm_suitability.rds")
  skip_if_not(file.exists(ref_path), "Reference raster not found. Run scripts/generate_snapshots.R first.")

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out <- tempfile()
  dir.create(tmp_out, showWarnings = FALSE)

  make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  result <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out, seed = 42
  )

  ref <- readRDS(ref_path)

  expect_equal(terra::nrow(result$suitability), ref$nrow)
  expect_equal(terra::ncol(result$suitability), ref$ncol)
  expect_equal(terra::nlyr(result$suitability), ref$nlyr)

  suit_current <- terra::values(result$suitability, na.rm = TRUE)
  expect_equal(suit_current, ref$values, tolerance = 1e-8)

  expect_equal(result$cv$auc_mean, ref$auc_mean, tolerance = 1e-8)
  expect_equal(result$cv$tss_mean, ref$tss_mean, tolerance = 1e-8)

  unlink(tmp_out, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("GAM suitability raster matches reference snapshot", {
  skip_if_not_installed("terra")
  skip_if_not_installed("gam")
  skip_on_cran()

  ref_path <- testthat::test_path("_snaps", "rasters", "gam_suitability.rds")
  skip_if_not(file.exists(ref_path), "Reference raster not found. Run scripts/generate_snapshots.R first.")

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out <- tempfile()
  dir.create(tmp_out, showWarnings = FALSE)

  make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  result <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "gam", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out, seed = 42
  )

  ref <- readRDS(ref_path)

  expect_equal(terra::nrow(result$suitability), ref$nrow)
  expect_equal(terra::ncol(result$suitability), ref$ncol)
  expect_equal(terra::nlyr(result$suitability), ref$nlyr)

  suit_current <- terra::values(result$suitability, na.rm = TRUE)
  expect_equal(suit_current, ref$values, tolerance = 1e-8)

  expect_equal(result$cv$auc_mean, ref$auc_mean, tolerance = 1e-8)
  expect_equal(result$cv$tss_mean, ref$tss_mean, tolerance = 1e-8)

  unlink(tmp_out, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("rangebag suitability raster matches reference snapshot", {
  skip_if_not_installed("terra")
  skip_on_cran()

  ref_path <- testthat::test_path("_snaps", "rasters", "rangebag_suitability.rds")
  skip_if_not(file.exists(ref_path), "Reference raster not found. Run scripts/generate_snapshots.R first.")

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out <- tempfile()
  dir.create(tmp_out, showWarnings = FALSE)

  make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  result <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "rangebag", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out, seed = 42
  )

  ref <- readRDS(ref_path)

  expect_equal(terra::nrow(result$suitability), ref$nrow)
  expect_equal(terra::ncol(result$suitability), ref$ncol)
  expect_equal(terra::nlyr(result$suitability), ref$nlyr)

  suit_current <- terra::values(result$suitability, na.rm = TRUE)
  expect_equal(suit_current, ref$values, tolerance = 1e-8)

  expect_equal(result$cv$auc_mean, ref$auc_mean, tolerance = 1e-8)
  expect_equal(result$cv$tss_mean, ref$tss_mean, tolerance = 1e-8)

  unlink(tmp_out, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("variable importance snapshot is stable", {
  skip_if_not_installed("terra")
  skip_on_cran()

  ref_path <- testthat::test_path("_snaps", "rasters", "glm_importance.rds")
  skip_if_not(file.exists(ref_path), "Reference importance not found. Run scripts/generate_snapshots.R first.")

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out <- tempfile()
  dir.create(tmp_out, showWarnings = FALSE)

  make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  result <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out, seed = 42
  )

  ref <- readRDS(ref_path)

  imp <- result$variable_importance
  expect_true(is.data.frame(imp))
  expect_equal(nrow(imp), ref$n_vars)
  expect_equal(sort(imp$variable), sort(ref$variables))

  unlink(tmp_out, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("threshold values are stable across runs", {
  skip_if_not_installed("terra")
  skip_on_cran()

  ref_path <- testthat::test_path("_snaps", "rasters", "glm_thresholds.rds")
  skip_if_not(file.exists(ref_path), "Reference thresholds not found. Run scripts/generate_snapshots.R first.")

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out <- tempfile()
  dir.create(tmp_out, showWarnings = FALSE)

  make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  result <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out, seed = 42
  )

  ref <- readRDS(ref_path)

  expect_equal(result$thresholds$max_tss, ref$max_tss, tolerance = 1e-8)
  expect_equal(result$thresholds$max_sens_spec, ref$max_sens_spec, tolerance = 1e-8)

  unlink(tmp_out, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})
