test_that("read_gbif_records structure and error handling", {
  skip_if_not_installed("rgbif")
  skip_if_not_installed("mockery")

  stub(read_gbif_records, "rgbif::name_backbone", list(speciesKey = 12345), depth = 2)
  stub(read_gbif_records, "rgbif::occ_search", list(
    data = data.frame(
      decimalLongitude = c(145.3, 146.2),
      decimalLatitude = c(-37.8, -38.1),
      species = c("Test species", "Test species"),
      key = c("123", "456"),
      stringsAsFactors = FALSE
    ),
    meta = list(doi = NA_character_)
  ), depth = 2)

  result <- read_gbif_records(
    taxon = "Test species",
    country = "AU",
    max_records = 10
  )

  expect_s3_class(result, "data.frame")
  expect_true(all(c("longitude", "latitude", "species", "source", "gbif_key") %in%
                 names(result)))
  expect_equal(result$source[1], "GBIF")
  expect_true(all(nchar(result$species) > 0))
})

test_that("read_gbif_records respects max_records limit", {
  skip_if_not_installed("rgbif")
  skip_if_not_installed("mockery")

  stub(read_gbif_records, "rgbif::name_backbone", list(speciesKey = 12345), depth = 2)
  stub(read_gbif_records, "rgbif::occ_search", function(taxonKey, country, limit,
                                                         hasCoordinate,
                                                         decimalLatitude,
                                                         decimalLongitude, ...) {
    n <- min(limit, 10000)
    list(
      data = data.frame(
        decimalLongitude = rep(145.0, n),
        decimalLatitude = rep(-38.0, n),
        species = rep("Test species", n),
        key = as.character(seq_len(n)),
        stringsAsFactors = FALSE
      ),
      meta = list(doi = NA_character_)
    )
  }, depth = 2)

  result <- read_gbif_records(
    taxon = "Test species",
    max_records = 5
  )

  expect_lte(nrow(result), 5)
})

test_that("read_gbif_records captures DOI when returned", {
  skip_if_not_installed("rgbif")
  skip_if_not_installed("mockery")

  stub(read_gbif_records, "rgbif::name_backbone", list(speciesKey = 12345), depth = 2)
  stub(read_gbif_records, "rgbif::occ_search", list(
    data = data.frame(
      decimalLongitude = 145.0,
      decimalLatitude = -38.0,
      species = "Test species",
      key = "123",
      stringsAsFactors = FALSE
    ),
    meta = list(doi = "10.5066/F70012XQ")
  ), depth = 2)

  result <- read_gbif_records(
    taxon = "Test species",
    max_records = 20
  )

  expect_true("gbif_doi" %in% names(result))
  expect_equal(result$gbif_doi[1], "10.5066/F70012XQ")
})

test_that("read_gbif_records returns empty df when no records found", {
  skip_if_not_installed("rgbif")
  skip_if_not_installed("mockery")

  stub(read_gbif_records, "rgbif::name_backbone", list(speciesKey = 99999), depth = 2)
  stub(read_gbif_records, "rgbif::occ_search", list(
    data = NULL,
    meta = list(doi = NA_character_)
  ), depth = 2)

  result <- read_gbif_records(
    taxon = "Nonexistent Species XYZ",
    max_records = 10
  )

  expect_s3_class(result, "data.frame")
  expect_equal(nrow(result), 0)
  expect_true("longitude" %in% names(result))
})

test_that("read_gbif_records stops when rgbif is not installed", {
  mockery::stub(read_gbif_records, "requireNamespace", FALSE)
  expect_error(read_gbif_records("Test species"), "rgbif package required")
})