test_that("CBI returns 1 for perfect separation", {
  pres_suit <- runif(100, 0.8, 1.0)
  bg_suit <- runif(100, 0.0, 0.2)
  result <- continuous_boyce_index(pres_suit, bg_suit)
  expect_true(result$cbi > 0.9)
  expect_equal(length(result$bins$bin_mid), 101)
})

test_that("CBI returns ~0 for random predictions", {
  set.seed(42)
  pres_suit <- runif(100, 0, 1)
  bg_suit <- runif(100, 0, 1)
  result <- continuous_boyce_index(pres_suit, bg_suit)
  expect_true(abs(result$cbi) < 0.3)
})

test_that("CBI returns NA for < 5 presences", {
  pres_suit <- runif(3, 0.5, 1.0)
  bg_suit <- runif(100, 0, 0.5)
  result <- continuous_boyce_index(pres_suit, bg_suit)
  expect_true(is.na(result$cbi))
  expect_true(grepl("Insufficient presence", result$note))
})

test_that("CBI returns NA for < 50 background", {
  pres_suit <- runif(50, 0.5, 1.0)
  bg_suit <- runif(30, 0, 0.5)
  result <- continuous_boyce_index(pres_suit, bg_suit)
  expect_true(is.na(result$cbi))
  expect_true(grepl("Insufficient background", result$note))
})

test_that("CBI result has all required elements", {
  pres_suit <- runif(50, 0.5, 1.0)
  bg_suit <- runif(200, 0, 0.5)
  result <- continuous_boyce_index(pres_suit, bg_suit)
  expect_true("cbi" %in% names(result))
  expect_true("bins" %in% names(result))
  expect_true("pe_ratio" %in% names(result))
  expect_true("note" %in% names(result))
  expect_true(is.data.frame(result$bins))
})