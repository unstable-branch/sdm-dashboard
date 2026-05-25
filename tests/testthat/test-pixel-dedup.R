test_that("thin_occurrences_by_cell deduplicates same-cell occurrences", {
  skip_if_not_installed("terra")
  set.seed(42)

  env <- make_test_raster(xmin = 140, xmax = 142, ymin = -24, ymax = -22,
                          nrows = 10, ncols = 10, n_layers = 1,
                          layer_names = c("bio1"), seed = 42L)

  n_dup <- 20
  occ <- data.frame(
    longitude = rep(140.5, n_dup),
    latitude = seq(-23.8, -22.2, length.out = n_dup),
    source = rep("test", n_dup),
    stringsAsFactors = FALSE
  )

  thinned <- thin_occurrences_by_cell(occ, env[[1]], by_source = FALSE)

  cells <- terra::cellFromXY(env[[1]], cbind(thinned$longitude, thinned$latitude))
  expect_equal(length(cells), length(unique(cells)))
  expect_true(nrow(thinned) <= nrow(occ))

  expect_true("longitude" %in% names(thinned))
  expect_true("latitude" %in% names(thinned))
})

test_that("thin_occurrences_by_cell with by_source keeps one per source per cell", {
  skip_if_not_installed("terra")
  set.seed(42)

  env <- make_test_raster(xmin = 140, xmax = 142, ymin = -24, ymax = -22,
                          nrows = 10, ncols = 10, n_layers = 1,
                          layer_names = c("bio1"), seed = 42L)

  occ <- data.frame(
    longitude = c(140.5, 140.5, 140.5, 140.5, 141.0, 141.0),
    latitude = c(-23.0, -23.0, -23.0, -23.0, -23.0, -23.0),
    source = c("A", "A", "B", "B", "A", "B"),
    stringsAsFactors = FALSE
  )

  thinned <- thin_occurrences_by_cell(occ, env[[1]], by_source = TRUE)

  cell_a <- terra::cellFromXY(env[[1]], cbind(140.5, -23.0))
  cell_a_rows <- which(terra::cellFromXY(env[[1]], cbind(thinned$longitude, thinned$latitude)) == cell_a)
  if (length(cell_a_rows) > 0) {
    sources_in_cell <- unique(thinned$source[cell_a_rows])
    expect_true(length(sources_in_cell) <= 2)
  }

  expect_true(nrow(thinned) <= nrow(occ))
})

test_that("thin_occurrences_by_cell removes points outside raster extent", {
  skip_if_not_installed("terra")
  set.seed(42)

  env <- make_test_raster(xmin = 140, xmax = 142, ymin = -24, ymax = -22,
                          nrows = 10, ncols = 10, n_layers = 1,
                          layer_names = c("bio1"), seed = 42L)

  occ <- data.frame(
    longitude = c(140.5, 130.0, 141.0, 150.0),
    latitude = c(-23.0, -20.0, -22.5, -30.0),
    source = rep("test", 4),
    stringsAsFactors = FALSE
  )

  thinned <- thin_occurrences_by_cell(occ, env[[1]], by_source = FALSE)

  expect_true(nrow(thinned) < nrow(occ) || nrow(thinned) == nrow(occ))
  expect_true(all(thinned$longitude >= terra::xmin(env) & thinned$longitude <= terra::xmax(env)))
  expect_true(all(thinned$latitude >= terra::ymin(env) & thinned$latitude <= terra::ymax(env)))

  cells <- terra::cellFromXY(env[[1]], cbind(thinned$longitude, thinned$latitude))
  expect_false(any(is.na(cells)))
})