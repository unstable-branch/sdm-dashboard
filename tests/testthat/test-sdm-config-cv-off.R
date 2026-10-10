test_that("sdm_config preserves an explicit cross-validation off request", {
  cfg <- sdm_config(
    cv_folds = 0L,
    projection_extent = c(140, 150, -30, -20)
  )

  expect_identical(cfg$cv_folds, 0L)
})

test_that("cross-validation off reaches the engine without fitting folds", {
  cfg <- sdm_config(
    cv_folds = 0L,
    projection_extent = c(140, 150, -30, -20)
  )
  result <- cross_validate_model(
    model_data = data.frame(presence = c(0L, 1L, 0L, 1L)),
    k = cfg$cv_folds,
    seed = cfg$seed,
    n_cores = 1L,
    cv_strategy = cfg$cv_strategy,
    cv_block_size_km = cfg$cv_block_size_km,
    threshold = cfg$threshold,
    fit_fun = function(...) stop("CV Off must not fit a fold")
  )

  expect_equal(result$k, 0)
  expect_length(result$fold_auc, 0L)
  expect_equal(nrow(result$fold_metrics), 0L)
  expect_true(is.na(result$auc_mean))
})

test_that("sdm_config retains the default and explicit enabled fold counts", {
  extent <- c(140, 150, -30, -20)
  expect_identical(sdm_config(projection_extent = extent)$cv_folds, sdm_default_cv_folds)
  expect_identical(sdm_config(cv_folds = 3L, projection_extent = extent)$cv_folds, 3L)
})

test_that("cross-validation off does not admit nonzero invalid low fold counts", {
  extent <- c(140, 150, -30, -20)
  for (folds in c(-1, 0.5, 1, 1.9, NA_real_)) {
    expect_identical(
      sdm_config(cv_folds = folds, projection_extent = extent)$cv_folds,
      sdm_default_cv_folds,
      info = paste("requested folds", folds)
    )
  }
  expect_identical(sdm_config(cv_folds = NULL, projection_extent = extent)$cv_folds,
                   sdm_default_cv_folds)
  expect_equal(sdm_config(cv_folds = 0, projection_extent = extent)$cv_folds, 0)
})
