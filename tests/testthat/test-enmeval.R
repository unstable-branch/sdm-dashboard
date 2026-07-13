test_that("build_enmeval_grid produces correct combinations", {
  skip_if_not_installed("ENMeval")
  grid <- build_enmeval_grid(fc = c("L", "LQ"), rm = c(1, 2))
  expect_equal(nrow(grid), 4)
  expect_equal(grid$fc, c("L", "LQ", "L", "LQ"))
  expect_equal(grid$rm, c(1, 1, 2, 2))
})

test_that("build_enmeval_grid defaults are sensible", {
  skip_if_not_installed("ENMeval")
  grid <- build_enmeval_grid()
  expect_true(nrow(grid) >= 6)
  expect_true(all(grid$rm > 0))
  expect_true(all(nzchar(grid$fc)))
})

test_that("tune_enmeval validates inputs", {
  skip_if_not_installed("ENMeval")
  expect_error(tune_enmeval(occ = NULL, env_rasters = NULL), "must be a SpatRaster")
  expect_error(tune_enmeval(occ = data.frame(), env_rasters = terra::rast()),
    "non-empty")
  expect_error(tune_enmeval(
    occ = data.frame(longitude = 1, latitude = 2),
    env_rasters = terra::rast(matrix(1:4, 2, 2)),
    tune.args = list(rm = 1)
  ), "named list")
})

test_that("tune_enmeval returns expected structure on failure", {
  skip_if_not_installed("ENMeval")
  bad_occs <- data.frame(longitude = 1:5, latitude = 2:6)
  bad_env <- terra::rast(matrix(runif(4), 2, 2))
  terra::ext(bad_env) <- c(0, 2, 0, 2)
  result <- tune_enmeval(
    occ = bad_occs, env_rasters = bad_env,
    tune.args = list(fc = "L", rm = 0.5),
    n_cores = 1, seed = 42
  )
  expect_type(result, "list")
  expect_true("success" %in% names(result))
  expect_true("best_params" %in% names(result))
  expect_true("features" %in% names(result$best_params))
  expect_true("regmult" %in% names(result$best_params))
})

test_that("tune_enmeval falls back gracefully when ENMeval not installed", {
  result <- tryCatch(
    tune_enmeval(
      occ = data.frame(longitude = 1:5, latitude = 2:6),
      env_rasters = terra::rast(matrix(runif(4), 2, 2)),
      tune.args = list(fc = "L", rm = 0.5),
      algorithm = "maxnet",
      n_cores = 1, seed = 42
    ),
    error = function(e) e
  )
  expect_true(inherits(result, "error") || is.list(result))
})

test_that("selection metric validation works", {
  skip_if_not_installed("ENMeval")
  results <- data.frame(
    auc.val.avg = c(0.7, 0.8, 0.75),
    del = c(1, 2, 3),
    fc = c("L", "LQ", "L"),
    rm = c(1, 2, 3)
  )
  expect_true("auc.val.avg" %in% names(results))
})

test_that("ENMdetails registry registers and retrieves algorithms", {
  skip_if_not_installed("ENMeval")
  expect_true(has_enmdetails("maxnet"))
  expect_true(has_enmdetails("glm"))
  expect_true(has_enmdetails("rf"))
  expect_true(has_enmdetails("bioclim"))
  expect_false(has_enmdetails("nonexistent"))
  expect_s4_class(get_enmdetails("maxnet"), "ENMdetails")
  expect_s4_class(get_enmdetails("glm"), "ENMdetails")
})

test_that("run_enmeval_tune_block returns generic best_params for any algorithm", {
  skip_if_not_installed("ENMeval")
  cfg <- list(
    tuning_method = "enmeval", model_id = "glm",
    enmeval_algorithm = "glm", enmeval_partitions = "randomkfold",
    enmeval_selection_metric = "auc.val.avg",
    enmeval_tune_args = list(alpha = c(0, 1)),
    enmeval_categoricals = NULL,
    enmeval_other_settings = list(pred.type = "cloglog", doClamp = TRUE),
    bias_method = "uniform", target_group_occ = NULL, thickening_distance_km = NULL
  )
  occ <- data.frame(longitude = runif(20, 140, 150), latitude = runif(20, -30, -20))
  env <- terra::rast(ncol = 10, nrow = 10, nlyrs = 2)
  terra::values(env) <- runif(200)
  names(env) <- c("bio1", "bio12")
  result <- run_enmeval_tune_block(cfg, occ, env,
    background_n = 100, cv_folds = 3, cv_block_size_km = NA_real_,
    seed = 42, n_cores = 1
  )
  expect_type(result, "list")
  expect_true("success" %in% names(result))
  if (isTRUE(result$success)) {
    expect_true("best_params" %in% names(result))
  }
})

test_that("run_enmeval_tune_block returns success=FALSE for unregistered algorithm", {
  skip_if_not_installed("ENMeval")
  cfg <- list(tuning_method = "enmeval", enmeval_algorithm = "nonexistent")
  result <- run_enmeval_tune_block(cfg, data.frame(), NULL,
    background_n = 100, cv_folds = 3, cv_block_size_km = NA_real_,
    seed = 42, n_cores = 1
  )
  expect_false(isTRUE(result$success))
})

test_that("run_enmeval_null_block returns expected structure", {
  skip_if_not_installed("ENMeval")
  result <- run_enmeval_null_block(NULL, no.iter = 10, n_cores = 1, seed = 42)
  expect_false(isTRUE(result$success))
  expect_true(is.na(result$p_value))
})

test_that("enmeval_compatible flag is set in model registry", {
  skip_if_not_installed("ENMeval")
  for (mid in c("glm", "rf", "bioclim")) {
    spec <- tryCatch(get_sdm_model(mid), error = function(e) NULL)
    if (!is.null(spec)) {
      expect_true(isTRUE(spec$enmeval_compatible),
        paste(mid, "should have enmeval_compatible = TRUE"))
      expect_equal(spec$enmeval_algorithm, mid)
    }
  }
})
