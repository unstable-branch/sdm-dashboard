# Tests for sdm_stage_* pipeline functions.


test_that("sdm_stage_clean returns cleaned occurrence data", {
  demo_csv <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  skip_if(!file.exists(demo_csv), "Demo CSV not found")
  cfg <- sdm_config(species = "Test", occurrence_file = demo_csv,
    projection_extent = c(112, 154, -44, -10), seed = 42L)
  result <- tryCatch(sdm_stage_clean(cfg, log_fun = NULL), error = function(e) NULL)
  expect_true(!is.null(result), "sdm_stage_clean should return data")
  expect_true(is.data.frame(result$occ), "Should contain occurrence data.frame")
  expect_true("longitude" %in% names(result$occ), "Should have longitude column")
  expect_true("latitude" %in% names(result$occ), "Should have latitude column")
})

test_that("sdm_stage_covariates returns environment rasters", {
  demo_csv <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  skip_if(!file.exists(demo_csv), "Demo CSV not found")
  wc_dir <- file.path(project_root, "Worldclim")
  skip_if(!dir.exists(wc_dir), "Worldclim dir not found")
  cfg <- sdm_config(species = "Test", occurrence_file = demo_csv,
    worldclim_dir = wc_dir, selected_biovars = c(1, 4, 12),
    projection_extent = c(112, 154, -44, -10), allow_download = FALSE, seed = 42L)
  occ <- clean_occurrence_preview(demo_csv)
  skip_if(!is.null(occ$error), "Occurrence cleaning failed")
  result <- tryCatch(sdm_stage_covariates(cfg, occ$occ, log_fun = NULL), error = function(e) NULL)
  expect_true(!is.null(result), "sdm_stage_covariates should return data")
  expect_true(inherits(result$env_train, "SpatRaster"), "Should have env_train raster")
  expect_true(inherits(result$env_project, "SpatRaster"), "Should have env_project raster")
})

test_that("sdm_stage_fit returns model fit", {
  demo_csv <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  skip_if(!file.exists(demo_csv), "Demo CSV not found")
  wc_dir <- file.path(project_root, "Worldclim")
  skip_if(!dir.exists(wc_dir), "Worldclim dir not found")
  cfg <- sdm_config(species = "Test", occurrence_file = demo_csv,
    worldclim_dir = wc_dir, selected_biovars = c(1, 4, 12),
    projection_extent = c(112, 154, -44, -10), allow_download = FALSE,
    model_id = "glm", cv_folds = 3, background_n = 200, seed = 42L)
  occ <- clean_occurrence_preview(demo_csv)
  skip_if(!is.null(occ$error), "Occurrence cleaning failed")
  env <- tryCatch(sdm_stage_covariates(cfg, occ$occ, log_fun = NULL), error = function(e) NULL)
  skip_if(is.null(env), "Covariates stage failed")
  result <- tryCatch(sdm_stage_fit(cfg, occ$occ, env, log_fun = NULL), error = function(e) NULL)
  expect_true(!is.null(result), "sdm_stage_fit should return data")
  expect_true(!is.null(result$model), "Should have model object")
  expect_true(!is.null(result$cv), "Should have CV results")
  expect_true(is.finite(result$cv$auc_mean), "Should have finite AUC")
})
