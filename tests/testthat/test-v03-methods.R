test_that("binary metrics compute AUC/TSS/confusion counts", {
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 0.5)
  expect_equal(round(m$auc, 3), 1)
  expect_equal(round(m$tss, 3), 1)
  expect_equal(m$tp, 2L)
  expect_equal(m$tn, 2L)
})

test_that("distance thinning is deterministic and removes close records", {
  occ <- data.frame(
    longitude = c(150, 150.001, 151),
    latitude = c(-23, -23.001, -23),
    source = c("A", "A", "A")
  )
  a <- thin_occurrences_by_distance(occ, min_distance_km = 5, seed = 10)
  b <- thin_occurrences_by_distance(occ, min_distance_km = 5, seed = 10)
  expect_equal(nrow(a), nrow(b))
  expect_true(nrow(a) < nrow(occ))
})

test_that("spatial block CV keeps each block in a single fold", {
  x <- c(150, 150.01, 151, 151.01, 152, 152.01, 153, 153.01)
  y <- c(-23, -23.01, -23, -23.01, -23, -23.01, -23, -23.01)
  presence <- c(1, 0, 1, 0, 1, 0, 1, 0)
  folds <- make_cv_folds_spatial_blocks(x, y, presence, k = 2, block_size_km = 50, seed = 42)
  for (block in unique(folds$block_id)) {
    expect_equal(length(unique(folds$fold_id[folds$block_id == block])), 1L)
  }
})

test_that("parallel GLM CV exports metric helpers to workers", {
  set.seed(42)
  model_data <- data.frame(
    presence = rep(c(1L, 0L), each = 12),
    bio1 = c(rnorm(12, 1), rnorm(12, -1)),
    bio12 = c(rnorm(12, 1), rnorm(12, -1)),
    .x = rep(seq(150, 152, length.out = 12), 2),
    .y = rep(seq(-23, -24, length.out = 12), 2),
    check.names = FALSE
  )
  form <- stats::as.formula("presence ~ bio1 + bio12")
  warnings <- character()
  cv <- withCallingHandlers(
    cross_validate_glm(model_data, form, k = 3, seed = 42, n_cores = 2),
    warning = function(w) {
      warnings <<- c(warnings, conditionMessage(w))
      invokeRestart("muffleWarning")
    }
  )
  expect_false(any(grepl("Parallel cross-validation failed", warnings, fixed = TRUE)))
  expect_equal(cv$k, 3L)
  expect_equal(nrow(cv$fold_metrics), 3L)
})
