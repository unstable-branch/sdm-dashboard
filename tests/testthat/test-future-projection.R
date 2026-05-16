test_that("future projection discovery reports missing BIO layers", {
  tmp <- tempfile("future-worldclim-")
  dir.create(tmp)
  expect_false(future_projection_ready(tmp, c(1, 12)))

  file.create(file.path(tmp, "wc2.1_10m_bio_1.tif"))
  files <- future_projection_files(tmp, c(1, 12))
  expect_false(is.na(files[["bio1"]]))
  expect_true(is.na(files[["bio12"]]))
})

test_that("future projection reuses model dispatch and writes delta rasters", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping future projection test because terra is not installed")
  } else {
    set.seed(42)
    current_dir <- tempfile("current-worldclim-")
    future_dir <- tempfile("future-worldclim-")
    dir.create(current_dir)
    dir.create(future_dir)

    template <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
    bio1 <- template
    bio12 <- template
    terra::values(bio1) <- seq_len(terra::ncell(bio1)) / terra::ncell(bio1)
    terra::values(bio12) <- rep(seq(0, 1, length.out = 20), each = 20)
    names(bio1) <- "bio1"
    names(bio12) <- "bio12"
    terra::writeRaster(bio1, file.path(current_dir, "wc2.1_10m_bio_1.tif"), overwrite = TRUE)
    terra::writeRaster(bio12, file.path(current_dir, "wc2.1_10m_bio_12.tif"), overwrite = TRUE)
    terra::writeRaster(bio1 + 0.05, file.path(future_dir, "wc2.1_10m_bio_1.tif"), overwrite = TRUE)
    terra::writeRaster(bio12 + 0.05, file.path(future_dir, "wc2.1_10m_bio_12.tif"), overwrite = TRUE)

    env <- load_environment(
      worldclim_dir = current_dir,
      selected_biovars = c(1, 12),
      training_extent = c(140, 142, -24, -22),
      projection_extent = c(140, 142, -24, -22),
      allow_download = FALSE
    )
    occ <- data.frame(
      species = "Synthetic species",
      longitude = seq(140.15, 141.85, length.out = 24),
      latitude = seq(-23.85, -22.15, length.out = 24),
      source = rep(c("A", "B"), each = 12),
      stringsAsFactors = FALSE
    )
    fit <- fit_sdm_model("glm", occ, env$env_train_scaled, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)
    current_tif <- tempfile(fileext = ".tif")
    current <- predict_sdm_model(fit, env$env_project_scaled, current_tif, n_cores = 1)
    future_tif <- tempfile(fileext = ".tif")
    delta_tif <- tempfile(fileext = ".tif")
    future <- project_future_suitability(fit, current, env, future_dir, c(1, 12), c(140, 142, -24, -22),
                                         output_future_tif = future_tif, output_delta_tif = delta_tif, n_cores = 1)

    expect_true(inherits(future$suitability, "SpatRaster"))
    expect_true(inherits(future$delta, "SpatRaster"))
    expect_true(file.exists(future_tif))
    expect_true(file.exists(delta_tif))
    expect_equal(names(future$delta), "suitability_delta")
  }
})
