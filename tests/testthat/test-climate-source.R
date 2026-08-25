test_that("find_worldclim_files discovers WorldClim files correctly", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    skip("terra not installed")
  }
  tmp <- tempfile("worldclim-")
  dir.create(tmp)

  # Use real (small) GeoTIFFs so is_valid_geotiff accepts them.
  r1 <- terra::rast(nrows = 2, ncols = 2, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::values(r1) <- runif(terra::ncell(r1))
  names(r1) <- "bio1"
  terra::writeRaster(r1, file.path(tmp, "wc2.1_10m_bio_1.tif"), overwrite = TRUE)
  r12 <- r1
  names(r12) <- "bio12"
  terra::writeRaster(r12, file.path(tmp, "wc2.1_10m_bio_12.tif"), overwrite = TRUE)
  file.create(file.path(tmp, "unrelated.tif"))

  found <- find_worldclim_files(tmp, c(1, 12), source = "worldclim")
  expect_false(is.na(found["1"]))
  expect_false(is.na(found["12"]))
  expect_true(is.na(found["4"]))
  expect_equal(basename(found["1"]), "wc2.1_10m_bio_1.tif")
})

test_that("find_worldclim_files discovers CHELSA files correctly", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    skip("terra not installed")
  }
  tmp <- tempfile("chelsa-")
  dir.create(tmp)

  r1 <- terra::rast(nrows = 2, ncols = 2, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::values(r1) <- runif(terra::ncell(r1))
  names(r1) <- "bio1"
  terra::writeRaster(r1, file.path(tmp, "CHELSA_bio1_1981-2010_V.2.1.tif"), overwrite = TRUE)
  r2 <- r1
  names(r2) <- "bio2"
  terra::writeRaster(r2, file.path(tmp, "CHELSA_bio02_1981-2010_V.2.1.tif"), overwrite = TRUE)

  found <- find_worldclim_files(tmp, c(1, 2), source = "chelsa")
  expect_false(is.na(found["1"]))
  expect_false(is.na(found["2"]))
  expect_true(grepl("CHELSA", found["1"]))
})

test_that("find_worldclim_files with source = chelsa uses two-digit pattern for bio1-9", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    skip("terra not installed")
  }
  tmp <- tempfile("chelsa-")
  dir.create(tmp)

  r1 <- terra::rast(nrows = 2, ncols = 2, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::values(r1) <- runif(terra::ncell(r1))
  names(r1) <- "bio1"
  terra::writeRaster(r1, file.path(tmp, "CHELSA_bio01_1981-2010_V.2.1.tif"), overwrite = TRUE)
  r10 <- r1
  names(r10) <- "bio10"
  terra::writeRaster(r10, file.path(tmp, "CHELSA_bio10_1981-2010_V.2.1.tif"), overwrite = TRUE)

  found <- find_worldclim_files(tmp, c(1, 10), source = "chelsa")
  expect_false(is.na(found["1"]))
  expect_false(is.na(found["10"]))
})

test_that("find_worldclim_files returns NA for empty directory", {
  tmp <- tempfile("empty-worldclim-")
  dir.create(tmp)

  found <- find_worldclim_files(tmp, c(1, 12), source = "worldclim")
  expect_true(all(is.na(found)))
})

test_that("source parameter is passed through load_climate_covariates", {
  tmp <- tempfile("worldclim-")
  dir.create(tmp)

  r <- terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  terra::values(r) <- runif(terra::ncell(r))
  names(r) <- "bio1"
  r2 <- r
  names(r2) <- "bio12"
  terra::writeRaster(r, file.path(tmp, "wc2.1_10m_bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(r2, file.path(tmp, "wc2.1_10m_bio_12.tif"), overwrite = TRUE)

  result <- load_climate_covariates(
    worldclim_dir = tmp,
    selected_biovars = c(1, 12),
    training_extent = c(140, 142, -24, -22),
    projection_extent = c(140, 142, -24, -22),
    allow_download = FALSE,
    source = "worldclim"
  )

  expect_true(inherits(result$env_train, "SpatRaster"))
  expect_equal(result$selected_biovars, c(1L, 12L))
})

test_that("config defaults include climate_source", {
  expect_identical(sdm_default_climate_source, "worldclim")
})