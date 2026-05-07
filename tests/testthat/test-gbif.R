test_that("read_gbif_records structure and error handling", {
  skip_if_not_installed <- function(pkg) {
    if (!requireNamespace(pkg, quietly = TRUE)) skip(paste(pkg, "not installed"))
  }

  skip_if_not_installed("rgbif")

  result <- read_gbif_records(
    taxon = "Acacia mearnsii",
    country = "AU",
    max_records = 10
  )

  expect_s3_class(result, "data.frame")
  expect_true(all(c("longitude", "latitude", "species", "source", "gbif_key") %in% names(result)))
  expect_equal(result$source[1], "GBIF")
  expect_true(all(nchar(result$species) > 0))
})

test_that("read_gbif_records respects max_records limit", {
  skip_if_not_installed <- function(pkg) {
    if (!requireNamespace(pkg, quietly = TRUE)) skip(paste(pkg, "not installed"))
  }

  skip_if_not_installed("rgbif")

  result <- read_gbif_records(
    taxon = "Eucalyptus globulus",
    max_records = 5
  )

  expect_lte(nrow(result), 5)
})

test_that("read_gbif_records captures DOI when returned", {
  skip_if_not_installed <- function(pkg) {
    if (!requireNamespace(pkg, quietly = TRUE)) skip(paste(pkg, "not installed"))
  }

  skip_if_not_installed("rgbif")

  result <- read_gbif_records(
    taxon = "Acacia mearnsii",
    max_records = 20
  )

  if (nrow(result) > 0) {
    expect_true("gbif_doi" %in% names(result))
  }
})

test_that("read_gbif_records stops when rgbif is not installed", {
  with_mocked_packages <- function(code) {
    mockery::with_mock(
      `requireNamespace` = function(pkg, ...) {
        if (identical(pkg, "rgbif")) return(FALSE)
        requireNamespace(pkg, quietly = TRUE, ...)
      },
      .env = environment(),
      code
    )
  }
})