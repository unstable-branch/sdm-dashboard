test_that("null island coordinates (0,0) are detected and flagged", {
  set.seed(42)

  occ <- data.frame(
    species = "Test",
    longitude = c(140.5, 0.0, 141.0, 0.0, 140.8, 141.2),
    latitude = c(-23.0, 0.0, -22.5, 0.0, -23.5, -22.8),
    source = rep("test", 6),
    stringsAsFactors = FALSE
  )

  lon_zero <- occ$longitude == 0
  lat_zero <- occ$latitude == 0
  at_null_island <- lon_zero & lat_zero

  expect_equal(sum(at_null_island), 2)

  clean_occ <- occ[!at_null_island, , drop = FALSE]
  expect_equal(nrow(clean_occ), 4)
  expect_false(any(clean_occ$longitude == 0 & clean_occ$latitude == 0))

  expect_equal(sum(clean_occ$longitude == 0), 0)
  expect_equal(sum(clean_occ$latitude == 0), 0)
})

test_that("CoordinateCleaner zeros test flags zero coordinates", {
  skip_if_not_installed("CoordinateCleaner")

  occ <- data.frame(
    decimallongitude = c(140.5, 0.0, 141.0, 0.0, 140.8, 141.2, 0.0),
    decimallatitude = c(-23.0, 0.0, -22.5, 45.0, -23.5, -22.8, 0.0),
    species = rep("test", 7),
    stringsAsFactors = FALSE
  )

  cc_result <- CoordinateCleaner::clean_coordinates(
    occ,
    lon = "decimallongitude",
    lat = "decimallatitude",
    species = "species",
    tests = c("zeros"),
    value = "spatialvalid"
  )

  expect_true(".summary" %in% names(cc_result))
  expect_true(".val" %in% names(cc_result))
  flagged <- !cc_result$.summary
  flagged_indices <- which(flagged)
  expect_true(length(flagged_indices) >= 1)
})

test_that("near-zero but not exactly-zero coordinates are not flagged", {
  occ <- data.frame(
    longitude = c(140.5, 0.001, 141.0, -0.001, 140.8),
    latitude = c(-23.0, 0.001, -22.5, -0.001, -23.5),
    stringsAsFactors = FALSE
  )

  lon_zero <- abs(occ$longitude) < 1e-6
  lat_zero <- abs(occ$latitude) < 1e-6
  at_null_island <- lon_zero & lat_zero

  expect_equal(sum(at_null_island), 0)
})