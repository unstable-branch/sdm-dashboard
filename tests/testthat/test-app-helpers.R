# Tests for app_helpers.R functions.

test_that("sanitize_extent replaces non-finite values with NA", {
  expect_equal(sanitize_extent(c(140, 154, -44, -10)), c(140, 154, -44, -10))
  expect_equal(sanitize_extent(c(140, Inf, -44, NA)), c(140, NA_real_, -44, NA_real_))
  expect_equal(sanitize_extent(c("140", "154", "-44", "-10")), c(140, 154, -44, -10))
})

test_that("extent_from_inputs returns preset extents", {
  mock_input <- list(extent_preset = "aus_full")
  ext <- extent_from_inputs(mock_input)
  expect_equal(ext, c(112, 154, -44, -10))

  mock_input <- list(extent_preset = "world")
  ext <- extent_from_inputs(mock_input)
  expect_equal(ext, c(-180, 180, -90, 90))
})

test_that("extent_from_inputs returns occurrence extent when available", {
  mock_input <- list(extent_preset = "occurrence")
  mock_occ <- list(df = data.frame(longitude = c(140, 150), latitude = c(-35, -25)))
  ext <- extent_from_inputs(mock_input, mock_occ)
  expect_true(ext[1] <= 140)
  expect_true(ext[2] >= 150)
  expect_true(ext[3] <= -35)
  expect_true(ext[4] >= -25)
})

test_that("extent_from_inputs falls back to default when occurrence unavailable", {
  mock_input <- list(extent_preset = "occurrence")
  ext <- extent_from_inputs(mock_input, NULL)
  expect_equal(ext, c(112, 154, -44, -10))
})

test_that("extent_from_inputs handles custom extent", {
  mock_input <- list(extent_preset = "custom", xmin = 140, xmax = 154, ymin = -44, ymax = -10)
  ext <- extent_from_inputs(mock_input)
  expect_equal(ext, c(140, 154, -44, -10))
})

test_that("fmt_num formats numbers with commas", {
  expect_equal(fmt_num(1000), "1,000")
  expect_equal(fmt_num(1234567), "1,234,567")
  expect_equal(fmt_num(0.123, digits = 2), "0.12")
  expect_equal(fmt_num(NA), "-")
  expect_equal(fmt_num(NULL), "-")
  expect_equal(fmt_num(numeric(0)), "-")
})

test_that("infer_species_label extracts species from CSV", {
  occ <- data.frame(
    scientificName = rep("Acacia mearnsii", 10),
    decimalLongitude = seq(140, 149),
    decimalLatitude = seq(-35, -26),
    stringsAsFactors = FALSE
  )
  tmp <- tempfile(fileext = ".csv")
  write.csv(occ, tmp, row.names = FALSE)
  on.exit(unlink(tmp), add = TRUE)

  result <- infer_species_label(tmp)
  expect_equal(result, "Acacia mearnsii")
})

test_that("infer_species_label returns NA for missing file", {
  expect_true(is.na(infer_species_label("/nonexistent/file.csv")))
})

test_that("infer_species_label returns NA when no species column", {
  occ <- data.frame(
    longitude = seq(140, 149),
    latitude = seq(-35, -26),
    stringsAsFactors = FALSE
  )
  tmp <- tempfile(fileext = ".csv")
  write.csv(occ, tmp, row.names = FALSE)
  on.exit(unlink(tmp), add = TRUE)

  result <- infer_species_label(tmp)
  expect_true(is.na(result))
})

test_that("default_species_label uses inferred name when available", {
  occ <- data.frame(
    scientificName = rep("Test species", 10),
    decimalLongitude = seq(140, 149),
    decimalLatitude = seq(-35, -26),
    stringsAsFactors = FALSE
  )
  tmp <- tempfile(fileext = ".csv")
  write.csv(occ, tmp, row.names = FALSE)
  on.exit(unlink(tmp), add = TRUE)

  result <- default_species_label(tmp)
  expect_equal(result, "Test species")
})

test_that("default_species_label falls back to default when inference fails", {
  result <- default_species_label("/nonexistent/file.csv")
  expect_equal(result, sdm_default_species)
})

test_that("occurrence_extent_overlap counts points inside extent", {
  occ <- data.frame(
    longitude = c(140, 145, 150, 160),
    latitude = c(-35, -30, -25, -20)
  )
  extent <- c(140, 150, -35, -25)
  result <- occurrence_extent_overlap(occ, extent)
  expect_equal(result$count, 3)
  expect_equal(result$total, 4)
  expect_equal(result$percent, 75)
})

test_that("occurrence_extent_overlap returns NULL for empty occurrence", {
  expect_null(occurrence_extent_overlap(NULL, c(140, 150, -35, -25)))
  occ <- data.frame(longitude = numeric(), latitude = numeric())
  expect_null(occurrence_extent_overlap(occ, c(140, 150, -35, -25)))
})

test_that("occurrence_extent_overlap returns NULL for invalid extent", {
  occ <- data.frame(longitude = c(140), latitude = c(-35))
  expect_null(occurrence_extent_overlap(occ, c(140, 150, NA, -25)))
})

test_that("normalize_cv_strategy normalizes variants", {
  expect_equal(normalize_cv_strategy("spatial_blocks"), "spatial_blocks")
  expect_equal(normalize_cv_strategy("spatial_block"), "spatial_blocks")
  expect_equal(normalize_cv_strategy("spatial blocks"), "spatial_blocks")
  expect_equal(normalize_cv_strategy("random"), "random")
  expect_equal(normalize_cv_strategy("anything"), "random")
})

test_that("normalize_cv_block_size_km returns numeric or NA", {
  expect_equal(normalize_cv_block_size_km(50), 50)
  expect_equal(normalize_cv_block_size_km("50"), 50)
  expect_true(is.na(normalize_cv_block_size_km(NA)))
  expect_true(is.na(normalize_cv_block_size_km(-5)))
  expect_true(is.na(normalize_cv_block_size_km("invalid")))
})
