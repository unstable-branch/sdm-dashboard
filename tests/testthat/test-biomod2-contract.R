test_that("biomod2 runs when enabled and installed", {
  skip_if_not_installed("biomod2")
  if (!isTRUE(getOption("sdm.enable_biomod2"))) {
    skip("biomod2 backend not enabled via options(sdm.enable_biomod2 = TRUE)")
  }

  r <- terra::rast(nrows = 20, ncols = 20, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  terra::values(r) <- runif(terra::ncell(r))

  occ <- data.frame(
    longitude = runif(50, 1, 9),
    latitude = runif(50, 1, 9),
    stringsAsFactors = FALSE
  )

  result <- run_biomod2(occ, r, models = c("GLM"), background_n = 200, cv_folds = 3)

  expect_true(is.list(result))
  expect_equal(result$model_id, "biomod2")
  expect_false(is.null(result$model))
  expect_false(is.null(result$cv))
})

test_that("run_biomod2 returns canonical fit list", {
  skip_if_not_installed("biomod2")
  if (!isTRUE(getOption("sdm.enable_biomod2"))) {
    skip("biomod2 backend not enabled")
  }

  r <- terra::rast(nrows = 20, ncols = 20, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(r) <- "bio1"
  terra::values(r) <- runif(terra::ncell(r))

  occ <- data.frame(
    longitude = runif(30, 1, 9),
    latitude = runif(30, 1, 9),
    stringsAsFactors = FALSE
  )

  result <- run_biomod2(occ, r, models = c("GLM"), background_n = 100, cv_folds = 3)

  expect_true("model" %in% names(result))
  expect_true("formula" %in% names(result))
  expect_true("coefficients" %in% names(result))
  expect_true("occurrence_used" %in% names(result))
  expect_true("background_xy" %in% names(result))
  expect_true("cv" %in% names(result))
  expect_true("covariates" %in% names(result))
  expect_true("variable_importance" %in% names(result))
  expect_true("model_id" %in% names(result))
  expect_true("modeling_id" %in% names(result))

  expect_true(is.data.frame(result$coefficients))
  expect_true("algorithm" %in% names(result$coefficients))
  expect_true("auc" %in% names(result$coefficients))

  expect_true(is.list(result$cv))
  expect_true("k" %in% names(result$cv))
  expect_true("auc_mean" %in% names(result$cv))
  expect_true("tss_mean" %in% names(result$cv))
})

test_that("unique modeling.id prevents collision", {
  skip_if_not_installed("biomod2")
  if (!isTRUE(getOption("sdm.enable_biomod2"))) {
    skip("biomod2 backend not enabled")
  }

  r <- terra::rast(nrows = 15, ncols = 15, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(r) <- "bio1"
  terra::values(r) <- runif(terra::ncell(r))

  occ1 <- data.frame(longitude = runif(20, 1, 9), latitude = runif(20, 1, 9),
                    species = "SpeciesA", stringsAsFactors = FALSE)
  occ2 <- data.frame(longitude = runif(20, 1, 9), latitude = runif(20, 1, 9),
                    species = "SpeciesB", stringsAsFactors = FALSE)

  result1 <- run_biomod2(occ1, r, models = c("GLM"), background_n = 100, cv_folds = 3,
                        species_name = "SpeciesA")
  result2 <- run_biomod2(occ2, r, models = c("GLM"), background_n = 100, cv_folds = 3,
                        species_name = "SpeciesB")

  expect_false(identical(result1$modeling_id, result2$modeling_id))
  expect_true(grepl("SpeciesA", result1$modeling_id))
  expect_true(grepl("SpeciesB", result2$modeling_id))
})

test_that("predict_biomod2_suitability returns SpatRaster", {
  skip_if_not_installed("biomod2")
  if (!isTRUE(getOption("sdm.enable_biomod2"))) {
    skip("biomod2 backend not enabled")
  }

  train_r <- terra::rast(nrows = 20, ncols = 20, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_r) <- "bio1"
  terra::values(train_r) <- runif(terra::ncell(train_r))

  occ <- data.frame(longitude = runif(30, 1, 9), latitude = runif(30, 1, 9),
                   stringsAsFactors = FALSE)

  fit <- run_biomod2(occ, train_r, models = c("GLM"), background_n = 100, cv_folds = 3)

  proj_r <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_r) <- "bio1"
  terra::values(proj_r) <- runif(terra::ncell(proj_r))

  result <- predict_biomod2_suitability(fit, proj_r, output_tif = NULL)

  expect_true(inherits(result, "SpatRaster"))
  expect_equal(terra::nlyr(result), 1)
})

test_that("biomod2 registry entry absent when not enabled", {
  skip_if_not_installed("biomod2")

  withr::local_options(list(sdm.enable_biomod2 = FALSE))

  load_all_modules <- function() {
    env <- new.env()
    source(file.path(project_root, "R", "models", "model_registry.R"), local = env)
    get("sdm_model_ids", envir = env)()
  }

  ids <- load_all_modules()
  expect_false("biomod2" %in% ids)
})