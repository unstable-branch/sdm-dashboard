test_that("occurrence_extent_overlap reports overlap statistics", {
  occ <- data.frame(
    longitude = c(140.5, 141.0, 140.8, 130.0, 150.0),
    latitude = c(-23.0, -22.5, -23.5, -20.0, -30.0),
    stringsAsFactors = FALSE
  )

  extent <- c(140, 142, -24, -22)

  result <- occurrence_extent_overlap(occ, extent)

  expect_true(is.list(result))
  expect_true("count" %in% names(result))
  expect_true("total" %in% names(result))
  expect_true("percent" %in% names(result))
  expect_equal(result$total, nrow(occ))
  expect_true(result$count >= 0 && result$count <= nrow(occ))
  expect_true(result$percent >= 0 && result$percent <= 100)

  inside <- occ$longitude >= extent[1] & occ$longitude <= extent[2] &
            occ$latitude >= extent[3] & occ$latitude <= extent[4]
  expect_equal(result$count, sum(inside))
})

test_that("occurrence_extent_overlap detects zero overlap", {
  occ <- data.frame(
    longitude = c(10.0, 12.0, 11.0),
    latitude = c(50.0, 52.0, 51.0),
    stringsAsFactors = FALSE
  )

  extent <- c(140, 142, -24, -22)

  result <- occurrence_extent_overlap(occ, extent)
  expect_equal(result$count, 0)
  expect_equal(result$percent, 0)
})

test_that("occurrence_extent_overlap detects full overlap", {
  occ <- data.frame(
    longitude = c(140.5, 141.0, 140.8, 141.5),
    latitude = c(-23.0, -22.5, -23.5, -22.8),
    stringsAsFactors = FALSE
  )

  extent <- c(140, 142, -24, -22)

  result <- occurrence_extent_overlap(occ, extent)
  expect_equal(result$count, nrow(occ))
  expect_equal(result$percent, 100)
})

test_that("sanitize_extent handles edge cases", {
  valid <- sanitize_extent(c("140", "142", "-24", "-22"))
  expect_equal(valid, c(140, 142, -24, -22))
  expect_true(is.numeric(valid))

  with_na <- sanitize_extent(c(140, NA, -24, -22))
  expect_true(is.numeric(with_na))

  with_inf <- sanitize_extent(c(140, Inf, -24, -22))
  expect_true(is.numeric(with_inf))
  expect_true(any(is.na(with_inf) | is.finite(with_inf)))
})