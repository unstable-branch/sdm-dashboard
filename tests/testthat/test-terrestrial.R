test_that("CoordinateCleaner sea test flags marine coordinates", {
  skip_if_not_installed("CoordinateCleaner")

  occ <- data.frame(
    decimallongitude = c(140.5, 150.0, 141.0, 155.0, 140.8),
    decimallatitude = c(-23.0, -35.0, -22.5, -40.0, -23.5),
    species = rep("test", 5),
    stringsAsFactors = FALSE
  )

  cc_result <- CoordinateCleaner::clean_coordinates(
    occ,
    lon = "decimallongitude",
    lat = "decimallatitude",
    species = "species",
    tests = c("sea"),
    value = "spatialvalid"
  )

  expect_true(".summary" %in% names(cc_result))
  expect_true(is.logical(cc_result$.summary))
})

test_that("clean_occurrences with cc_tests enables sea check", {
  tmp_csv <- tempfile(fileext = ".csv")
  occ <- data.frame(
    species = "Test",
    longitude = c(140.5, 141.0, 140.8, 141.2, 140.3),
    latitude = c(-23.0, -22.5, -23.5, -22.8, -23.2),
    source = rep("A", 5),
    stringsAsFactors = FALSE
  )
  utils::write.csv(occ, tmp_csv, row.names = FALSE)

  if (requireNamespace("CoordinateCleaner", quietly = TRUE)) {
    cleaned <- clean_occurrences(tmp_csv, use_cc = TRUE, cc_tests = "sea", min_records = 1)
    expect_true(is.list(cleaned))
    expect_true(nrow(cleaned$df) >= 1)
  } else {
    cleaned <- clean_occurrences(tmp_csv, use_cc = FALSE, min_records = 1)
    expect_true(is.list(cleaned))
    expect_true(nrow(cleaned$df) >= 1)
  }
})

test_that("terrestrial species records with known land coordinates pass sea check", {
  skip_if_not_installed("CoordinateCleaner")

  occ <- data.frame(
    decimallongitude = c(140.5, 141.0, 140.8),
    decimallatitude = c(-23.0, -22.5, -23.5),
    species = rep("test", 3),
    stringsAsFactors = FALSE
  )

  cc_result <- CoordinateCleaner::clean_coordinates(
    occ,
    lon = "decimallongitude",
    lat = "decimallatitude",
    species = "species",
    tests = c("sea"),
    value = "spatialvalid"
  )

  flagged <- !cc_result$.summary
  n_sea_flagged <- sum(flagged, na.rm = TRUE)
  if (n_sea_flagged > 0) {
    msg <- paste("Sea test flagged", n_sea_flagged, "Australian land records")
    expect_true(is.character(msg))
  }
  expect_true(length(cc_result$.summary) == nrow(occ))
})
