# Tests for multi-species SDM pipeline (sdm_stage_* with species_filter)

test_that("sdm_stage_clean filters by species_filter", {
  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  make_multi_species_occurrence(tmp_csv, n_per_species = 10)

  cfg <- sdm_config(
    species = "North Test",
    occurrence_file = tmp_csv,
    species_filter = "Species_North",
    model_id = "glm",
    projection_extent = c(112, 154, -44, -10)
  )

  cleaned <- sdm_stage_clean(cfg)
  occ_out <- cleaned$occ
  expect_true(all(occ_out$species == "Species_North"))
  expect_equal(nrow(occ_out), 10)
})

test_that("sdm_stage_clean isolates different species independently", {
  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  make_multi_species_occurrence(tmp_csv, n_per_species = 10)

  cfg_north <- sdm_config(
    species = "North Test",
    occurrence_file = tmp_csv,
    species_filter = "Species_North",
    model_id = "glm",
    projection_extent = c(112, 154, -44, -10)
  )
  cfg_east <- sdm_config(
    species = "East Test",
    occurrence_file = tmp_csv,
    species_filter = "Species_East",
    model_id = "glm",
    projection_extent = c(112, 154, -44, -10)
  )
  cfg_west <- sdm_config(
    species = "West Test",
    occurrence_file = tmp_csv,
    species_filter = "Species_West",
    model_id = "glm",
    projection_extent = c(112, 154, -44, -10)
  )

  north_occ <- sdm_stage_clean(cfg_north)$occ
  east_occ <- sdm_stage_clean(cfg_east)$occ
  west_occ <- sdm_stage_clean(cfg_west)$occ

  expect_true(all(north_occ$species == "Species_North"))
  expect_true(all(east_occ$species == "Species_East"))
  expect_true(all(west_occ$species == "Species_West"))
  expect_equal(nrow(north_occ), 10)
  expect_equal(nrow(east_occ), 10)
  expect_equal(nrow(west_occ), 10)
})

test_that("sdm_stage_clean with species_filter matching species name works with multi-source CSV", {
  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  occ <- make_multi_species_occurrence(tmp_csv, n_per_species = 10)
  occ$source <- c(rep("Museum_A", 10), rep("Museum_B", 10), rep("Museum_C", 10))
  utils::write.csv(occ, tmp_csv, row.names = FALSE)

  cfg <- sdm_config(
    species = "West Test",
    occurrence_file = tmp_csv,
    species_filter = "Species_West",
    model_id = "glm",
    projection_extent = c(112, 154, -44, -10)
  )

  cleaned <- sdm_stage_clean(cfg)
  expect_equal(nrow(cleaned$occ), 10)
  expect_true(all(cleaned$occ$species == "Species_West"))
})

test_that("full multi-species pipeline runs end-to-end with WorldClim data", {
  skip_if_not_installed("terra")
  wc_dir <- file.path(project_root, "Worldclim")
  skip_if_not(dir.exists(wc_dir), message = "WorldClim data not available")
  skip_if(Sys.getenv("SDM_RUN_SLOW_TESTS") != "true",
    message = "Set SDM_RUN_SLOW_TESTS=true to enable WorldClim-dependent tests")

  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  make_on_land_multi_species_occurrence(tmp_csv, n_per_species = 25,
    wc_dir = wc_dir, seed = 42)

  species <- c("Species_East", "Species_West")
  configs <- lapply(species, function(sp) {
    sdm_config(
      species = sp,
      occurrence_file = tmp_csv,
      species_filter = sp,
      model_id = "glm",
      biovars = c(1, 4, 12),
      projection_extent = c(112, 154, -44, -10),
      training_extent = c(112, 154, -44, -10),
      worldclim_dir = normalizePath(wc_dir),
      worldclim_res = 10,
      cv_folds = 2,
      background_n = 200,
      aggregation_factor = 3
    )
  })

  results <- lapply(seq_along(configs), function(i) {
    cfg <- configs[[i]]
    occ_clean <- sdm_stage_clean(cfg)
    env <- sdm_stage_covariates(cfg)
    fit_res <- sdm_stage_fit(cfg, occ_clean$occ, env)
    suit <- sdm_stage_predict(cfg, fit_res$fit, env)
    post <- sdm_stage_postprocess(cfg, fit_res$fit, suit, env)
    list(occ = occ_clean, env = env, fit = fit_res, suit = suit, post = post)
  })

  expect_length(results, 2)
  for (i in seq_along(results)) {
    expect_false(is.null(results[[i]]$fit$fit), info = species[i])
    expect_true(inherits(results[[i]]$suit, "SpatRaster"), info = species[i])
    expect_true(is.list(results[[i]]$post), info = species[i])
  }

  expect_false(identical(results[[1]]$fit$fit$coefficients, results[[2]]$fit$fit$coefficients))
})

test_that("different model types work across species in pipeline", {
  skip_if_not_installed("terra")
  wc_dir <- file.path(project_root, "Worldclim")
  skip_if_not(dir.exists(wc_dir), message = "WorldClim data not available")
  skip_if(Sys.getenv("SDM_RUN_SLOW_TESTS") != "true",
    message = "Set SDM_RUN_SLOW_TESTS=true to enable WorldClim-dependent tests")

  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  make_on_land_multi_species_occurrence(tmp_csv, n_per_species = 25,
    wc_dir = wc_dir, seed = 42)

  cfg_glm <- sdm_config(
    species = "GLM species",
    occurrence_file = tmp_csv,
    species_filter = "Species_East",
    model_id = "glm",
    biovars = c(1, 4, 12),
    projection_extent = c(112, 154, -44, -10),
    training_extent = c(112, 154, -44, -10),
    worldclim_dir = normalizePath(wc_dir),
    worldclim_res = 10,
    cv_folds = 2,
    background_n = 200,
    aggregation_factor = 3
  )

  cfg_rangebag <- sdm_config(
    species = "Rangebag species",
    occurrence_file = tmp_csv,
    species_filter = "Species_West",
    model_id = "rangebag",
    biovars = c(1, 4, 12),
    projection_extent = c(112, 154, -44, -10),
    training_extent = c(112, 154, -44, -10),
    worldclim_dir = normalizePath(wc_dir),
    worldclim_res = 10,
    cv_folds = 2,
    background_n = 200,
    aggregation_factor = 3
  )

  occ_east <- sdm_stage_clean(cfg_glm)
  occ_west <- sdm_stage_clean(cfg_rangebag)
  env <- sdm_stage_covariates(cfg_glm)

  fit_glm <- sdm_stage_fit(cfg_glm, occ_east$occ, env)
  fit_rb <- sdm_stage_fit(cfg_rangebag, occ_west$occ, env)

  expect_equal(fit_glm$fit$model_id, "glm")
  expect_equal(fit_rb$fit$model_id, "rangebag")

  suit_glm <- sdm_stage_predict(cfg_glm, fit_glm$fit, env)
  suit_rb <- sdm_stage_predict(cfg_rangebag, fit_rb$fit, env)

  expect_true(inherits(suit_glm, "SpatRaster"))
  expect_true(inherits(suit_rb, "SpatRaster"))
  expect_equal(terra::ext(suit_glm), terra::ext(suit_rb))
})
