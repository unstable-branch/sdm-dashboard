find_fixture_path <- function() {
  candidates <- c(
    file.path("tests", "testthat", "fixtures", "dwca_minimal.zip"),
    file.path("fixtures", "dwca_minimal.zip"),
    file.path("..", "fixtures", "dwca_minimal.zip"),
    file.path("..", "..", "fixtures", "dwca_minimal.zip")
  )
  for (p in candidates) {
    full <- normalizePath(p, winslash = "/", mustWork = FALSE)
    if (file.exists(full)) return(full)
  }
  character(0)
}

fixture_path <- find_fixture_path()

test_that("read_dwca parses minimal fixture archive", {
  skip_if_not_installed("finch")
  if (identical(fixture_path, character(0))) {
    skip("DwC-A fixture archive not found")
  }

  result <- read_dwca(fixture_path)

  expect_s3_class(result$occurrences, "data.frame")
  expect_true(nrow(result$occurrences) > 0)
  expect_true("x" %in% names(result$occurrences))
  expect_true("y" %in% names(result$occurrences))
  expect_true("species" %in% names(result$occurrences) ||
              "scientific_name" %in% names(result$occurrences))
  expect_equal(result$n_raw, 6)
})

test_that("read_dwca handles missing optional metadata", {
  skip_if_not_installed("finch")
  if (identical(fixture_path, character(0))) {
    skip("DwC-A fixture archive not found")
  }

  result <- read_dwca(fixture_path)

  expect_true(is.character(result$doi) || is.na(result$doi))
  expect_true(is.integer(result$n_raw))
  expect_true(is.integer(result$n_returned))
})

test_that("read_dwca records raw-to-returned counts", {
  skip_if_not_installed("finch")
  if (identical(fixture_path, character(0))) {
    skip("DwC-A fixture archive not found")
  }

  result <- read_dwca(fixture_path)

  expect_true(result$n_returned <= result$n_raw)
  expect_equal(result$n_returned, nrow(result$occurrences))
})

test_that("read_dwca errors on missing file", {
  skip_if_not_installed("finch")
  expect_error(read_dwca("/nonexistent/path/to/archive.zip"),
               "DwC-A file not found")
})

test_that("read_dwca errors on non-zip file", {
  skip_if_not_installed("finch")
  tmp <- tempfile(fileext = ".txt")
  writeLines("not a zip", tmp)
  on.exit(unlink(tmp), add = TRUE)

  expect_error(read_dwca(tmp), "Expected a .zip file")
})