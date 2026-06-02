test_that("Multi-model ensemble fits with 2+ models and writes component rasters", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping multi_ensemble test because terra is not installed")
    return(invisible(NULL))
  }

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_multi_model_ensemble(
    occ, env,
    selected_models = c("glm", "rangebag"),
    ensemble_weighting = "auc",
    background_n = 120,
    include_quadratic = FALSE,
    cv_folds = 2,
    seed = 99,
    n_cores = 1
  )

  expect_true(is.list(fit$model$components))
  expect_true(length(fit$model$components) >= 2)
  expect_true(abs(sum(fit$model$weights) - 1) < 1e-8)
  expect_true(all(fit$model$weights >= 0))
  expect_true(is.data.frame(fit$coefficients))
  expect_equal(nrow(fit$coefficients), length(fit$model$components))
  expect_true(is.list(fit$model$components$rangebag))
  expect_true(is.finite(fit$model$components$rangebag$threshold))
  expect_true(is.finite(fit$model$components$rangebag$model$threshold))

  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_multi_model_ensemble(fit, env, output_tif, n_cores = 1, export_components = TRUE)
  expect_true(inherits(suit, "SpatRaster"))
  expect_equal(names(suit), "suitability")
  expect_true(file.exists(output_tif))
  expect_true(file.exists(multi_ensemble_component_path(output_tif, "glm")))
  expect_true(file.exists(multi_ensemble_component_path(output_tif, "rangebag")))
  expect_true(file.exists(multi_ensemble_component_path(output_tif, "disagreement")))
})

test_that("Multi-model ensemble computes weights correctly", {
  if (!requireNamespace("terra", quietly = TRUE)) return(invisible(NULL))

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit_equal <- fit_multi_model_ensemble(occ, env, selected_models = c("glm", "rangebag"),
                                         ensemble_weighting = "equal",
                                         background_n = 120, cv_folds = 2, seed = 99, n_cores = 1)
  expect_equal(fit_equal$model$weights[["glm"]], fit_equal$model$weights[["rangebag"]], tolerance = 1e-6)

  fit_auc <- fit_multi_model_ensemble(occ, env, selected_models = c("glm", "rangebag"),
                                       ensemble_weighting = "auc",
                                       background_n = 120, cv_folds = 2, seed = 99, n_cores = 1)
  expect_true(abs(sum(fit_auc$model$weights) - 1) < 1e-8)
})

test_that("Multi-model ensemble requires at least 2 models", {
  if (!requireNamespace("terra", quietly = TRUE)) return(invisible(NULL))

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  expect_error(
    fit_multi_model_ensemble(occ, env, selected_models = c("glm"), ensemble_weighting = "auc",
                             background_n = 120, cv_folds = 2, seed = 99, n_cores = 1),
    "At least 2 models"
  )
})

test_that("Multi-model ensemble disagreement is max - min range", {
  if (!requireNamespace("terra", quietly = TRUE)) return(invisible(NULL))

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_multi_model_ensemble(occ, env, selected_models = c("glm", "rangebag"),
                                   ensemble_weighting = "auc", background_n = 120,
                                   cv_folds = 2, seed = 99, n_cores = 1)
  output_tif <- tempfile(fileext = ".tif")
  suit <- predict_multi_model_ensemble(fit, env, output_tif, n_cores = 1, export_components = TRUE)
  disagreement_tif <- multi_ensemble_component_path(output_tif, "disagreement")
  expect_true(file.exists(disagreement_tif))
  disagg <- terra::rast(disagreement_tif)
  expect_true(all(terra::values(disagg) >= 0, na.rm = TRUE))
  expect_true(all(terra::values(disagg) <= 1, na.rm = TRUE))
})

test_that("Multi-model ensemble registered in model registry", {
  expect_true("multi_ensemble" %in% sdm_model_ids())
  spec <- get_sdm_model("multi_ensemble")
  expect_equal(spec$id, "multi_ensemble")
  expect_true(spec$supports_uncertainty)
  expect_true(spec$supports_future)
})

test_that("compute_multi_ensemble_weights with AUC, TSS, and equal", {
  cv_list <- list(
    list(auc_mean = 0.9, tss_mean = 0.7),
    list(auc_mean = 0.7, tss_mean = 0.5),
    list(auc_mean = 0.8, tss_mean = 0.6)
  )

  w_equal <- compute_multi_ensemble_weights(cv_list, "equal")
  expect_equal(w_equal, c(1/3, 1/3, 1/3), tolerance = 1e-6)

  w_auc <- compute_multi_ensemble_weights(cv_list, "auc")
  expect_true(abs(sum(w_auc) - 1) < 1e-8)
  expect_true(w_auc[[1]] > w_auc[[2]])

  w_tss <- compute_multi_ensemble_weights(cv_list, "tss")
  expect_true(abs(sum(w_tss) - 1) < 1e-8)
  expect_true(w_tss[[1]] > w_tss[[2]])
})

test_that("Multi-model ensemble with 3+ models", {
  if (!requireNamespace("terra", quietly = TRUE)) return(invisible(NULL))

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  fit <- fit_multi_model_ensemble(occ, env, selected_models = c("glm", "rangebag", "rangebag"),
                                   ensemble_weighting = "equal",
                                   background_n = 120, cv_folds = 2, seed = 99, n_cores = 1)
  expect_true(length(fit$model$components) >= 2)
  expect_true(abs(sum(fit$model$weights) - 1) < 1e-8)
})

test_that("Multi-model ensemble refuses single valid component after filtering", {
  if (!requireNamespace("terra", quietly = TRUE)) return(invisible(NULL))

  set.seed(42)
  r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
  r2 <- r1
  terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
  terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
  env <- c(r1, r2)
  names(env) <- c("bio1", "bio12")

  occ <- data.frame(
    species = "Synthetic species",
    longitude = seq(140.15, 141.85, length.out = 24),
    latitude = seq(-23.85, -22.15, length.out = 24),
    source = rep(c("A", "B"), each = 12),
    stringsAsFactors = FALSE
  )

  expect_error(
    fit_multi_model_ensemble(occ, env, selected_models = c("glm", "rangebag"),
                             ensemble_weighting = "auc",
                             min_auc = 0.999,
                             background_n = 120, cv_folds = 2, seed = 99, n_cores = 1),
    "Ensemble requires at least 2 valid components"
  )
})
