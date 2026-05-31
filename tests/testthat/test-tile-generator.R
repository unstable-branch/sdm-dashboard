test_that("generate_xyz_tiles creates tiles from synthetic raster", {
  skip_if_not_installed("terra")
  r <- terra::rast(ncols = 40, nrows = 40,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- runif(terra::ncell(r))
  tmp <- tempfile()

  result <- generate_xyz_tiles(r, tmp,
    palette = c("#0A1624", "#123247", "#15545D", "#1F8A70", "#59C174",
                "#C6D65B", "#F3C45A", "#F28A3C", "#E34B35", "#A51E3B"),
    value_range = c(0, 1), band_names = "suitability",
    verbose = FALSE)

  expect_true(result$bands[["suitability"]]$tile_count > 0)
  expect_true(dir.exists(file.path(tmp, "suitability")))
  unlink(tmp, recursive = TRUE)
})

test_that("tiles are valid PNG files", {
  skip_if_not_installed("terra")
  r <- terra::rast(ncols = 30, nrows = 30,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- runif(terra::ncell(r))
  tmp <- tempfile()

  result <- generate_xyz_tiles(r, tmp,
    palette = c("#0A1624", "#59C174", "#A51E3B"),
    value_range = c(0, 1), band_names = "suitability",
    verbose = FALSE)

  tile_files <- list.files(file.path(tmp, "suitability"),
    recursive = TRUE, pattern = "\\.png$")
  expect_true(length(tile_files) > 0)

  first_tile <- file.path(tmp, "suitability", tile_files[1])
  header <- readBin(first_tile, "raw", n = 8)
  expect_equal(header[1:4], as.raw(c(0x89, 0x50, 0x4E, 0x47)))

  unlink(tmp, recursive = TRUE)
})

test_that("adaptive zoom range varies with raster resolution", {
  skip_if_not_installed("terra")

  fine <- terra::rast(ncols = 200, nrows = 200,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(fine) <- runif(terra::ncell(fine))

  coarse <- terra::rast(ncols = 6, nrows = 6,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(coarse) <- runif(terra::ncell(coarse))

  tmp_fine <- tempfile()
  tmp_coarse <- tempfile()

  r_fine <- generate_xyz_tiles(fine, tmp_fine,
    value_range = c(0, 1), band_names = "s", verbose = FALSE)
  r_coarse <- generate_xyz_tiles(coarse, tmp_coarse,
    value_range = c(0, 1), band_names = "s", verbose = FALSE)

  fine_zoom_min <- r_fine$bands[["s"]]$zoom_min
  coarse_zoom_min <- r_coarse$bands[["s"]]$zoom_min

  expect_true(coarse_zoom_min <= fine_zoom_min)

  unlink(tmp_fine, recursive = TRUE)
  unlink(tmp_coarse, recursive = TRUE)
})

test_that("all-NA raster produces no tiles", {
  skip_if_not_installed("terra")
  r <- terra::rast(ncols = 10, nrows = 10,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- NA_real_
  tmp <- tempfile()

  result <- generate_xyz_tiles(r, tmp,
    value_range = c(0, 1), band_names = "s", verbose = FALSE)

  expect_equal(result$bands[["s"]]$tile_count, 0L)
  unlink(tmp, recursive = TRUE)
})

test_that("input as file path works", {
  skip_if_not_installed("terra")
  r <- terra::rast(ncols = 20, nrows = 20,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- runif(terra::ncell(r))
  tif_path <- tempfile(fileext = ".tif")
  terra::writeRaster(r, tif_path, overwrite = TRUE)
  tmp <- tempfile()

  result <- generate_xyz_tiles(tif_path, tmp,
    value_range = c(0, 1), band_names = "s", verbose = FALSE)

  expect_true(result$bands[["s"]]$tile_count > 0)
  unlink(c(tif_path, tmp), recursive = TRUE)
})

test_that("multi-band produces separate tile sets", {
  skip_if_not_installed("terra")
  r1 <- terra::rast(ncols = 20, nrows = 20,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r1) <- runif(terra::ncell(r1))
  r2 <- terra::rast(ncols = 20, nrows = 20,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r2) <- runif(terra::ncell(r2))
  stack <- c(r1, r2)
  tmp <- tempfile()

  result <- generate_xyz_tiles(stack, tmp,
    bands = c(1, 2), band_names = c("suitability", "uncertainty"),
    value_range = c(0, 1), verbose = FALSE)

  expect_true(dir.exists(file.path(tmp, "suitability")))
  expect_true(dir.exists(file.path(tmp, "uncertainty")))
  expect_true(result$bands[["suitability"]]$tile_count > 0)
  expect_true(result$bands[["uncertainty"]]$tile_count > 0)

  unlink(tmp, recursive = TRUE)
})

test_that("cancellation callback stops generation early", {
  skip_if_not_installed("terra")
  r <- terra::rast(ncols = 40, nrows = 40,
    xmin = 140, xmax = 146, ymin = -28, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- runif(terra::ncell(r))
  tmp <- tempfile()
  cancelled <- FALSE

  result <- generate_xyz_tiles(r, tmp,
    value_range = c(0, 1), band_names = "s", verbose = FALSE,
    cancel = function() { cancelled <<- TRUE })

  expect_true(cancelled)
  unlink(tmp, recursive = TRUE)
})

test_that("return value has correct structure", {
  skip_if_not_installed("terra")
  r <- terra::rast(ncols = 20, nrows = 20,
    xmin = 140, xmax = 142, ymin = -24, ymax = -22, crs = "EPSG:4326")
  terra::values(r) <- runif(terra::ncell(r))
  tmp <- tempfile()

  result <- generate_xyz_tiles(r, tmp,
    value_range = c(0, 1), band_names = "s", verbose = FALSE)

  expect_true(is.list(result))
  expect_true(is.character(result$output_dir))
  expect_true(is.list(result$bands[["s"]]))
  expect_true(is.numeric(result$bands[["s"]]$zoom_min))
  expect_true(is.numeric(result$bands[["s"]]$zoom_max))
  expect_true(is.numeric(result$bands[["s"]]$tile_count))
  expect_true(is.numeric(result$generation_time))
  expect_true(is.character(result$warnings))
  expect_true(is.list(result$tilejson))

  unlink(tmp, recursive = TRUE)
})
