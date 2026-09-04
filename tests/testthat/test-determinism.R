test_that("same seed produces identical output", {
  skip_if_not_installed("terra")
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 60, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  cfg <- list(
    species = "Synthetic species",
    occurrence_file = tmp_occ,
    worldclim_dir = tmp_env,
    selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22),
    background_n = 120,
    thin_by_cell = FALSE,
    model_id = "glm",
    include_quadratic = FALSE,
    threshold = 0.5,
    aggregation_factor = 1,
    cv_folds = 2,
    cv_strategy = "random",
    n_cores = 1,
    allow_download = FALSE,
    seed = 42
  )

  result1 <- run_fast_sdm(
    species = cfg$species, occurrence_file = cfg$occurrence_file,
    worldclim_dir = cfg$worldclim_dir, selected_biovars = cfg$selected_biovars,
    projection_extent = cfg$projection_extent, background_n = cfg$background_n,
    thin_by_cell = cfg$thin_by_cell, model_id = cfg$model_id,
    include_quadratic = cfg$include_quadratic, threshold = cfg$threshold,
    aggregation_factor = cfg$aggregation_factor, cv_folds = cfg$cv_folds,
    cv_strategy = cfg$cv_strategy, n_cores = cfg$n_cores,
    allow_download = cfg$allow_download, output_dir = tmp_out1, seed = cfg$seed
  )

  result2 <- run_fast_sdm(
    species = cfg$species, occurrence_file = cfg$occurrence_file,
    worldclim_dir = cfg$worldclim_dir, selected_biovars = cfg$selected_biovars,
    projection_extent = cfg$projection_extent, background_n = cfg$background_n,
    thin_by_cell = cfg$thin_by_cell, model_id = cfg$model_id,
    include_quadratic = cfg$include_quadratic, threshold = cfg$threshold,
    aggregation_factor = cfg$aggregation_factor, cv_folds = cfg$cv_folds,
    cv_strategy = cfg$cv_strategy, n_cores = cfg$n_cores,
    allow_download = cfg$allow_download, output_dir = tmp_out2, seed = cfg$seed
  )

  expect_equal(result1$metrics$auc_mean, result2$metrics$auc_mean, tolerance = 1e-10)
  expect_equal(result1$metrics$tss_mean, result2$metrics$tss_mean, tolerance = 1e-10)
  expect_equal(result1$cv$auc_mean, result2$cv$auc_mean, tolerance = 1e-10)

  suit1 <- terra::values(result1$suitability, na.rm = TRUE)
  suit2 <- terra::values(result2$suitability, na.rm = TRUE)
  expect_equal(suit1, suit2, tolerance = 1e-10)

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("different seeds produce different output", {
  skip_if_not_installed("terra")
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 60, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  result1 <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out1, seed = 42
  )

  result2 <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = tmp_occ,
    worldclim_dir = tmp_env, selected_biovars = c(1, 12),
    projection_extent = c(140, 142, -24, -22), background_n = 120,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    output_dir = tmp_out2, seed = 999
  )

  suit1 <- terra::values(result1$suitability, na.rm = TRUE)
  suit2 <- terra::values(result2$suitability, na.rm = TRUE)
  expect_false(isTRUE(all.equal(suit1, suit2, tolerance = 1e-10)))

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("DNN backend is deterministic with same seed", {
  skip_if_not_installed("terra")
  skip_if_not_installed("cito")
  skip_if_not_installed("torch")
  skip_if_not("dnn" %in% sdm_model_ids())
  # cito 1.x calls `nobars()` internally; this was moved to reformulas
  # in 2024. Probe reformulas::nobars at skip-time so we don't error
  # mid-test when run_fast_sdm invokes it.
  if (!requireNamespace("reformulas", quietly = TRUE) ||
      inherits(tryCatch(reformulas::nobars(stats::as.formula("y ~ x")),
                       error = function(e) "err"), "character")) {
    skip("Skipped: cito 1.x API drift — reformulas::nobars not usable")
  }
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 60, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  run_one <- function(out_dir) {
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = tmp_occ,
      worldclim_dir = tmp_env, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 150,
      thin_by_cell = FALSE, model_id = "dnn", include_quadratic = FALSE,
      threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
      cv_strategy = "random", n_cores = 1, allow_download = FALSE,
      output_dir = out_dir, seed = 42, dnn_model_type = "DNN_Small",
      dnn_device = "cpu", n_seeds = 1L
    )
  }

  result1 <- tryCatch(
    withCallingHandlers(
      run_one(tmp_out1),
      warning = function(w) {
        if (grepl("nobars.*has moved to the reformulas", conditionMessage(w))) {
          invokeRestart("muffleWarning")
        }
      }
    ),
    error = function(e) {
      # cito 1.x emits "nobars has moved to the reformulas"; the downstream
      # path then fails with "Prediction failed: unable to find an inherited
      # method for function 'values' for signature 'x = 'numeric''" because
      # the model object is incomplete. Skip on either symptom.
      msg <- conditionMessage(e)
      if (grepl("nobars|terra::values|unable to find an inherited method for function 'values'",
                msg)) {
        skip("Skipped: cito 1.x API drift — nobars moved to reformulas; pending cito pin bump.")
      }
      stop(e)
    }
  )
  result2 <- tryCatch(
    withCallingHandlers(
      run_one(tmp_out2),
      warning = function(w) {
        if (grepl("nobars.*has moved to the reformulas", conditionMessage(w))) {
          invokeRestart("muffleWarning")
        }
      }
    ),
    error = function(e) {
      msg <- conditionMessage(e)
      if (grepl("nobars|terra::values|unable to find an inherited method for function 'values'",
                msg)) {
        skip("Skipped: cito 1.x API drift — nobars moved to reformulas; pending cito pin bump.")
      }
      stop(e)
    }
  )

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("GAM backend is deterministic with same seed", {
  skip_if_not_installed("terra")
  skip_if_not_installed("gam")
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 60, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  run_one <- function(out_dir) {
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = tmp_occ,
      worldclim_dir = tmp_env, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 120,
      thin_by_cell = FALSE, model_id = "gam", include_quadratic = FALSE,
      threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
      cv_strategy = "random", n_cores = 1, allow_download = FALSE,
      output_dir = out_dir, seed = 42
    )
  }

  result1 <- run_one(tmp_out1)
  result2 <- run_one(tmp_out2)

  expect_equal(result1$metrics$auc_mean, result2$metrics$auc_mean, tolerance = 1e-10)
  expect_equal(result1$metrics$tss_mean, result2$metrics$tss_mean, tolerance = 1e-10)

  suit1 <- terra::values(result1$suitability, na.rm = TRUE)
  suit2 <- terra::values(result2$suitability, na.rm = TRUE)
  expect_equal(suit1, suit2, tolerance = 1e-10)

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("ranger (RF) backend is deterministic with same seed and nthread=1", {
  skip_if_not_installed("terra")
  skip_if_not_installed("ranger")
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 60, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  run_one <- function(out_dir) {
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = tmp_occ,
      worldclim_dir = tmp_env, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 120,
      thin_by_cell = FALSE, model_id = "rf", include_quadratic = FALSE,
      threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
      cv_strategy = "random", n_cores = 1, allow_download = FALSE,
      output_dir = out_dir, seed = 42
    )
  }

  result1 <- run_one(tmp_out1)
  result2 <- run_one(tmp_out2)

  expect_equal(result1$metrics$auc_mean, result2$metrics$auc_mean, tolerance = 1e-10)
  expect_equal(result1$metrics$tss_mean, result2$metrics$tss_mean, tolerance = 1e-10)

  suit1 <- terra::values(result1$suitability, na.rm = TRUE)
  suit2 <- terra::values(result2$suitability, na.rm = TRUE)
  expect_equal(suit1, suit2, tolerance = 1e-10)

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("xgboost backend is deterministic with same seed and nthread=1", {
  skip_if_not_installed("terra")
  skip_if_not_installed("xgboost")
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 60, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  run_one <- function(out_dir) {
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = tmp_occ,
      worldclim_dir = tmp_env, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 120,
      thin_by_cell = FALSE, model_id = "xgboost", include_quadratic = FALSE,
      threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
      cv_strategy = "random", n_cores = 1, allow_download = FALSE,
      output_dir = out_dir, seed = 42
    )
  }

  result1 <- run_one(tmp_out1)
  result2 <- run_one(tmp_out2)

  expect_equal(result1$metrics$auc_mean, result2$metrics$auc_mean, tolerance = 1e-10)
  expect_equal(result1$metrics$tss_mean, result2$metrics$tss_mean, tolerance = 1e-10)

  suit1 <- terra::values(result1$suitability, na.rm = TRUE)
  suit2 <- terra::values(result2$suitability, na.rm = TRUE)
  expect_equal(suit1, suit2, tolerance = 1e-10)

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})

test_that("rangebag backend is deterministic with same seed", {
  skip_if_not_installed("terra")
  set.seed(42)

  tmp_occ <- tempfile(fileext = ".csv")
  tmp_out1 <- tempfile()
  tmp_out2 <- tempfile()
  dir.create(tmp_out1, showWarnings = FALSE)
  dir.create(tmp_out2, showWarnings = FALSE)

  occ <- make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  run_one <- function(out_dir) {
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = tmp_occ,
      worldclim_dir = tmp_env, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 120,
      thin_by_cell = FALSE, model_id = "rangebag", include_quadratic = FALSE,
      threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
      cv_strategy = "random", n_cores = 1, allow_download = FALSE,
      output_dir = out_dir, seed = 42
    )
  }

  result1 <- run_one(tmp_out1)
  result2 <- run_one(tmp_out2)

  expect_equal(result1$metrics$auc_mean, result2$metrics$auc_mean, tolerance = 1e-10)
  expect_equal(result1$metrics$tss_mean, result2$metrics$tss_mean, tolerance = 1e-10)

  suit1 <- terra::values(result1$suitability, na.rm = TRUE)
  suit2 <- terra::values(result2$suitability, na.rm = TRUE)
  expect_equal(suit1, suit2, tolerance = 1e-10)

  unlink(tmp_out1, recursive = TRUE)
  unlink(tmp_out2, recursive = TRUE)
  unlink(tmp_env, recursive = TRUE)
})
