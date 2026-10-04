## biomod2 CV-strategy contract. The app normalises CV strategy to "random" or
## "spatial_blocks". Random k-fold is supported; spatial blocks are not mapped
## to biomod2 and must be rejected, never silently replaced by random k-fold.

biomod2_cv_strategy_fixture <- function() {
  set.seed(42)
  r <- terra::rast(nrows = 30, ncols = 30, xmin = 0, xmax = 30,
                   ymin = 0, ymax = 30, crs = "EPSG:4326", nlyrs = 2)
  terra::values(r) <- matrix(rnorm(terra::ncell(r) * 2L), ncol = 2L)
  names(r) <- c("bio1", "bio12")
  xy <- terra::xyFromCell(r, seq(5L, 880L, length.out = 40L))
  list(r = r, occ = data.frame(species = "SyntheticCaller",
                               longitude = xy[, 1], latitude = xy[, 2]))
}

test_that("registered biomod2 backend accepts the app's random CV strategy", {
  skip_if_not_installed("biomod2")
  skip_if_not_installed("R.utils")
  fx <- biomod2_cv_strategy_fixture()
  # Shaped like run_fast_sdm's call: it always passes a core count, the default
  # thickening distance and an NA block size for random CV.
  fit <- fit_biomod2_sdm(fx$occ, fx$r, background_n = 30L, cv_folds = 3L,
                         seed = 42L, models = "GLM", n_cores = 4L,
                         include_quadratic = FALSE, bias_method = "uniform",
                         thickening_distance_km = 10, threshold = 0.5,
                         cv_strategy = normalize_cv_strategy("random"),
                         cv_block_size_km = NA_real_)
  expect_true(fit$cv$enabled)
  expect_equal(fit$cv$k, 3L)
})

test_that("biomod2 rejects unknown controls instead of silently ignoring them", {
  skip_if_not_installed("biomod2")
  fx <- biomod2_cv_strategy_fixture()
  expect_error(
    fit_biomod2_sdm(fx$occ, fx$r, background_n = 30L, cv_folds = 3L, seed = 42L,
                    models = "GLM", cv_strategy = "random", maxnet_regmult = 2),
    "maxnet_regmult"
  )
  # An unnamed extra reaches `...` only once every formal is supplied.
  expect_error(
    fit_biomod2_sdm(occ = fx$occ, env_train_scaled = fx$r, background_n = 30L,
                    include_quadratic = FALSE, cv_folds = 3L, seed = 42L,
                    n_cores = 1L, log_fun = NULL, progress_fun = NULL,
                    threshold = 0.5, cv_strategy = "random",
                    cv_block_size_km = NA_real_, bias_method = "uniform",
                    target_group_occ = NULL, thickening_distance_km = 10,
                    models = "GLM", cancel_fun = NULL, 2),
    "<unnamed>"
  )
})

test_that("biomod2 rejects spatial-block CV instead of substituting random folds", {
  skip_if_not_installed("biomod2")
  skip_if_not_installed("R.utils")
  withr::local_options(list(sdm.enable_biomod2 = TRUE))
  fx <- biomod2_cv_strategy_fixture()

  expect_error(
    fit_biomod2_sdm(fx$occ, fx$r, background_n = 30L, cv_folds = 3L, seed = 42L,
                    models = "GLM", cv_strategy = "spatial_blocks"),
    "spatial"
  )
  # The ensemble must not fit biomod2 components on random folds while its
  # standalone components use spatial blocks.
  expect_error(
    fit_multi_model_ensemble(fx$occ, fx$r, selected_models = c("glm", "biomod2"),
      biomod2_models = "GLM", ensemble_weighting = "equal", background_n = 300L,
      include_quadratic = FALSE, cv_folds = 3L, cv_strategy = "spatial_blocks",
      seed = 42L, n_cores = 1L),
    "spatial"
  )
})
