test_that("CV Off survives the real GLM application fit and output path", {
  skip_if_not_installed("terra")
  dir <- tempfile("cv-off-application-")
  dir.create(dir)
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  climate <- file.path(dir, "climate")
  dir.create(climate)
  raster <- make_test_raster(nrows = 20, ncols = 20, n_layers = 2, seed = 20261004L)
  for (i in seq_len(terra::nlyr(raster))) {
    terra::writeRaster(raster[[i]],
      file.path(climate, paste0("bio_", c(1, 12)[i], ".tif")), overwrite = TRUE)
  }
  occurrence_file <- file.path(dir, "occurrence.csv")
  make_synthetic_occurrence(occurrence_file, n_pres = 40)

  run_one <- function(folds, suffix) {
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = occurrence_file,
      worldclim_dir = climate, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 120,
      min_source_records = 1L, thin_by_cell = FALSE, model_id = "glm",
      include_quadratic = FALSE, threshold = 0.5, aggregation_factor = 1L,
      cv_folds = folds, cv_strategy = "random", n_cores = 1L,
      allow_download = FALSE, output_dir = file.path(dir, suffix),
      covariate_cache_dir = file.path(dir, "cache"), mask_type = "none",
      generate_tiles = FALSE, seed = 42L
    )
  }

  off <- run_one(0L, "off")
  expect_s3_class(off$model, "glm")
  expect_equal(off$cv$k, 0)
  # The engine retains the requested strategy as configuration even when k=0.
  expect_identical(off$cv$strategy, "random")
  expect_equal(off$config$cv_folds, 0)
  expect_equal(off$metrics$cv_folds, 0)
  expect_length(off$cv$fold_auc, 0L)
  expect_true(is.na(off$cv$auc_mean))
  expect_true(is.na(off$metrics$auc_mean))
  expect_true(inherits(off$suitability, "SpatRaster"))
  values <- terra::values(off$suitability, mat = FALSE)
  expect_true(all(is.finite(values)))
  expect_true(all(values >= 0 & values <= 1))
  expect_true(file.exists(off$paths$tif))

  enabled <- run_one(2L, "enabled")
  expect_equal(enabled$cv$k, 2)
  expect_length(enabled$cv$fold_auc, 2L)
  expect_true(is.finite(enabled$cv$auc_mean))
})
