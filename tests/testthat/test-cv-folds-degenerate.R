test_that("make_cv_folds_spatial_blocks warns and falls back to random when only one block", {
  set.seed(42)
  result <- make_cv_folds_spatial_blocks(
    x = c(140.1, 140.2, 140.3),
    y = c(-24.1, -24.2, -24.3),
    presence = c(1L, 1L, 0L),
    k = 5,
    block_size_km = 200,
    seed = 42
  )
  expect_equal(result$block_size_mode, "manual+random-fallback")
  expect_warning(
    make_cv_folds_spatial_blocks(
      x = c(140.1, 140.2),
      y = c(-24.1, -24.2),
      presence = c(1L, 1L),
      k = 5,
      block_size_km = 200,
      seed = 42
    ),
    "Falling back to random"
  )
})

test_that("make_cv_folds_spatial_blocks with k=1 returns all data in fold 0", {
  result <- make_cv_folds_spatial_blocks(
    x = c(140.1, 140.2, 140.3),
    y = c(-24.1, -24.2, -24.3),
    presence = c(1L, 0L, 1L),
    k = 1
  )
  expect_equal(result$fold_id, rep(0L, 3))
  expect_equal(result$block_size_mode, "off")
})

test_that("make_cv_folds_random with k<2 returns all zeros", {
  expect_equal(make_cv_folds_random(c(1, 0, 1), k = 1), c(0L, 0L, 0L))
  expect_equal(make_cv_folds_random(c(1, 0), k = 0), c(0L, 0L))
})

test_that("summarise_cv_folds handles missing block_id", {
  fold_id <- c(1, 2, 1, 0)
  presence <- c(1, 0, 1, 0)
  summary <- summarise_cv_folds(fold_id, presence)
  expect_equal(nrow(summary), 2)
  expect_true(is.na(summary$n_blocks[1]))
})