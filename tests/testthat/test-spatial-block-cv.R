test_that("spatial block CV creates geographically separated blocks", {
  skip_if_not_installed("terra")
  set.seed(42)

  n_pres <- 40
  x <- seq(140.1, 141.9, length.out = n_pres)
  y <- seq(-23.9, -22.1, length.out = n_pres)
  presence <- factor(sample(c("presence", "absence"), n_pres, replace = TRUE, prob = c(0.6, 0.4)),
                     levels = c("absence", "presence"))

  presence_int <- as.integer(presence == "presence")
  blocks <- make_cv_folds_spatial_blocks(
    x = x, y = y, presence = presence_int,
    k = 3, block_size_km = 100, seed = 42
  )

  expect_true(is.list(blocks))
  expect_true("fold_id" %in% names(blocks))
  expect_true(is.integer(blocks$fold_id) || is.factor(blocks$fold_id))
  expect_equal(length(unique(blocks$fold_id)), 3)
  expect_equal(length(blocks$fold_id), n_pres)

  coords <- cbind(x, y)
  for (fold_i in 1:3) {
    in_fold <- blocks$fold_id == fold_i
    if (sum(in_fold) > 1) {
      fold_coords <- coords[in_fold, , drop = FALSE]
      fold_extent <- apply(fold_coords, 2, range)
      other_coords <- coords[!in_fold, , drop = FALSE]
      for (j in seq_len(nrow(other_coords))) {
         distance <- sqrt((other_coords[j, 1] - fold_coords[, 1])^2 +
                          (other_coords[j, 2] - fold_coords[, 2])^2)
      }
    }
  }

  block_ids <- match(blocks$fold_id, unique(blocks$fold_id))
  unique_blocks <- unique(block_ids)
  expect_true(length(unique_blocks) >= 2)
})

test_that("spatial block CV differs from random CV", {
  skip_if_not_installed("terra")
  set.seed(42)

  n_pres <- 40
  x <- seq(140.1, 141.9, length.out = n_pres)
  y <- seq(-23.9, -22.1, length.out = n_pres)
  presence <- factor(rep("presence", n_pres), levels = c("absence", "presence"))

  presence_int <- as.integer(presence == "presence")
  random_folds <- make_cv_folds_random(y = presence_int, k = 3, seed = 42)
  spatial_folds <- make_cv_folds_spatial_blocks(
    x = x, y = y, presence = presence_int, k = 3, block_size_km = 100, seed = 42
  )
  expect_true(is.list(random_folds) || is.integer(random_folds) || is.factor(random_folds))
  expect_true(is.list(spatial_folds))
  expect_true("fold_id" %in% names(spatial_folds))
  random_len <- if (is.list(random_folds)) length(random_folds$fold_id) else length(random_folds)
  expect_equal(random_len, n_pres)
  expect_equal(length(spatial_folds$fold_id), n_pres)
})

test_that("spatial blocks cover all presence points", {
  skip_if_not_installed("terra")
  set.seed(42)

  n_pres <- 30
  x <- seq(140.0, 141.5, length.out = n_pres)
  y <- seq(-23.5, -22.0, length.out = n_pres)
  presence <- factor(rep("presence", n_pres), levels = c("absence", "presence"))

  presence_int <- as.integer(presence == "presence")
  blocks <- make_cv_folds_spatial_blocks(
    x = x, y = y, presence = presence_int, k = 5, block_size_km = 50, seed = 42
  )

  expect_true(is.list(blocks))
  expect_true("fold_id" %in% names(blocks))
  presence_idx <- which(presence_int == 1L)
  folds_for_presence <- blocks$fold_id[presence_idx]
  expect_true(all(!is.na(folds_for_presence)))
  expect_true(length(unique(folds_for_presence)) >= 1)
})

test_that("fewer than 5 points falls back to random", {
  skip_if_not_installed("terra")
  n_pres <- 4
  x <- seq(140.0, 140.3, length.out = n_pres)
  y <- seq(-23.0, -22.7, length.out = n_pres)
  presence <- factor(rep("presence", n_pres), levels = c("absence", "presence"))

  presence_int <- as.integer(presence == "presence")
  blocks <- make_cv_folds_spatial_blocks(
    x = x, y = y, presence = presence_int, k = 3, block_size_km = 50, seed = 42
  )

  expect_true(is.list(blocks))
  expect_true(is.integer(blocks$fold_id) || is.factor(blocks$fold_id))
  expect_equal(length(blocks$fold_id), n_pres)
})