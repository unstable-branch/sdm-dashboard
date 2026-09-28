test_that("GLM CV selects collinear predictors from each fold's training rows", {
  skip_if_not_installed("terra")

  dir <- tempfile("glm-vif-entrypoint-")
  dir.create(dir)
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  climate <- file.path(dir, "climate")
  future_climate <- file.path(dir, "future")
  output <- file.path(dir, "output")
  dir.create(climate)
  dir.create(future_climate)
  dir.create(output)

  set.seed(20260928)
  raster <- terra::rast(nrows = 30, ncols = 30,
                        xmin = 137, xmax = 145, ymin = -27, ymax = -19)
  primary <- stats::rnorm(terra::ncell(raster))
  correlated <- primary + stats::rnorm(length(primary), sd = 0.001)
  independent <- stats::rnorm(length(primary))
  for (entry in list(list(1, primary), list(12, correlated), list(4, independent))) {
    terra::values(raster) <- entry[[2]]
    terra::writeRaster(raster, file.path(climate, paste0("bio_", entry[[1]], ".tif")),
                       overwrite = TRUE)
    terra::values(raster) <- entry[[2]] + 0.25
    terra::writeRaster(raster, file.path(future_climate, paste0("bio_", entry[[1]], "_future.tif")),
                       overwrite = TRUE)
  }

  occ <- data.frame(species = "Synthetic species",
                    longitude = seq(140.15, 141.85, length.out = 40),
                    latitude = seq(-23.85, -22.15, length.out = 40),
                    source = rep(c("A", "B"), each = 20))
  occurrence_file <- file.path(dir, "occ.csv")
  utils::write.csv(occ, occurrence_file, row.names = FALSE)

  result <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = occurrence_file,
    worldclim_dir = climate, selected_biovars = c(1, 12, 4),
    projection_extent = c(140, 142, -24, -22), background_n = 240,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    vif_reduction = TRUE, vif_threshold = 5, future_projection = TRUE,
    future_worldclim_dir = future_climate, output_dir = output, seed = 42
  )

  expect_length(result$cv$per_fold_dropped_vars, 2)
  expect_true(any(lengths(result$cv$per_fold_dropped_vars) > 0),
              info = "the GLM route disabled training-fold VIF after global raster screening")
  expect_identical(result$environment$vif_source, "sampled_fit_rows")
  expect_true(is.list(result$environment$vif_result))
  expect_setequal(result$environment$vif_result$selected, result$environment$names)
  expect_setequal(result$environment$vif_result$dropped, result$environment$dropped_vars)
  expect_true(nrow(result$environment$vif_result$vif_history) > 0)
  expect_setequal(result$environment$names, result$model$terms |> stats::terms() |> attr("term.labels"))
  expect_setequal(names(result$environment$means), result$environment$names)
  expect_setequal(names(result$environment$sds), result$environment$names)
  expect_setequal(names(result$mess), c("pct_extrapolation", "mess", "per_variable", "train_ranges"))
  expect_setequal(names(result$mess$per_variable), result$environment$names)
  expect_false(is.null(result$future))
  expect_true(file.exists(result$future$paths$mess_tif))
  expect_named(result$future$mess, c("pct_extrapolation", "mask_applied", "mask_threshold", "masked_cells"), ignore.order = TRUE)

  # Replicates sample different background rows and can select different final
  # predictors. A raster pruned to the primary fit must not silently discard
  # later fits whose formula needs another predictor.
  rejected_output <- file.path(dir, "rejected-output")
  rejected_cache <- file.path(dir, "rejected-cache")
  expect_error(run_fast_sdm(
    species = "Synthetic species", occurrence_file = occurrence_file,
    worldclim_dir = climate, selected_biovars = c(1, 12, 4),
    projection_extent = c(140, 142, -24, -22), background_n = 240,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    vif_reduction = TRUE, vif_threshold = 5, pa_replicates = 2,
    output_dir = rejected_output, covariate_cache_dir = rejected_cache, seed = 42
  ), "GLM VIF with multiple PA replicates is not supported")
  expect_false(dir.exists(rejected_output))
  expect_false(dir.exists(rejected_cache))

  # A completed VIF check that keeps every predictor is not "not run".
  kept <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = occurrence_file,
    worldclim_dir = climate, selected_biovars = c(1, 12, 4),
    projection_extent = c(140, 142, -24, -22), background_n = 240,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    vif_reduction = TRUE, vif_threshold = 1e12,
    output_dir = file.path(dir, "kept-output"), seed = 42
  )
  expect_identical(kept$environment$vif_status, "kept_all")
  expect_identical(kept$environment$vif_source, "sampled_fit_rows")
  expect_setequal(kept$environment$vif_result$selected, kept$environment$names)
  expect_length(kept$environment$dropped_vars, 0)

  skipped <- run_fast_sdm(
    species = "Synthetic species", occurrence_file = occurrence_file,
    worldclim_dir = climate, selected_biovars = c(1, 4),
    projection_extent = c(140, 142, -24, -22), background_n = 240,
    thin_by_cell = FALSE, model_id = "glm", include_quadratic = FALSE,
    threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
    cv_strategy = "random", n_cores = 1, allow_download = FALSE,
    vif_reduction = TRUE, vif_threshold = 5,
    output_dir = file.path(dir, "skipped-output"), seed = 42
  )
  expect_identical(skipped$environment$vif_status, "skipped_fewer_than_three_predictors")
  expect_identical(skipped$environment$vif_source, "sampled_fit_rows")
  expect_null(skipped$environment$vif_result)
})

test_that("GLM fold VIF matches a fixed-fold training-only selector oracle", {
  set.seed(7102)
  n <- 240L
  x <- rnorm(n)
  model_data <- data.frame(
    presence = rep(c(0L, 1L), each = n / 2),
    x = x,
    x_copy = x + rnorm(n, sd = 0.001),
    z = rnorm(n),
    .x = seq_len(n), .y = seq_len(n)
  )
  fold_id <- make_cv_folds_random(model_data$presence, k = 2, seed = 94)
  train_rows <- which(fold_id != 1L)
  test_rows <- which(fold_id == 1L)
  oracle <- apply_vif_selection(model_data[train_rows, c("x", "x_copy", "z")],
                                threshold = 5, log_fun = NULL)

  run_cv <- function(data) cross_validate_glm(
    data, make_sdm_formula(c("x", "x_copy", "z"), include_quadratic = FALSE),
    k = 2, seed = 94, n_cores = 1, cv_strategy = "random",
    collect_predictions = TRUE, do_per_fold_scaling = FALSE,
    vif_threshold = 5
  )
  expect_setequal(oracle$selected, c("x_copy", "z"))
  result <- run_cv(model_data)
  expect_setequal(result$per_fold_dropped_vars[[1]], c("x"))

  perturbed <- model_data
  perturbed$x_copy[test_rows] <- sin(seq_along(test_rows) * 2.7)
  full_selector <- function(data) apply_vif_selection(
    data[, c("x", "x_copy", "z")], threshold = 5, log_fun = NULL
  )$selected
  expect_false(setequal(full_selector(perturbed), full_selector(model_data)),
               info = "held-out perturbation must change a leaked full-data selection")
  expect_identical(run_cv(perturbed)$per_fold_dropped_vars[[1]],
                   result$per_fold_dropped_vars[[1]])
})

test_that("GLM CV does not report rejected single-predictor selection as applied", {
  set.seed(844)
  n <- 240L
  model_data <- data.frame(
    presence = rep(c(0L, 1L), each = n / 2),
    x = rnorm(n), y = rnorm(n), z = rnorm(n),
    .x = seq_len(n), .y = seq_len(n)
  )
  cv <- cross_validate_glm(
    model_data, make_sdm_formula(c("x", "y", "z"), include_quadratic = FALSE),
    k = 2, seed = 94, n_cores = 1, cv_strategy = "random",
    collect_predictions = TRUE, do_per_fold_scaling = FALSE,
    vif_threshold = 0.5
  )
  expect_true(all(lengths(cv$per_fold_dropped_vars) == 0L),
              info = "the one-predictor selection is rejected, so the full formula is fitted")
})

test_that("staged GLM VIF denies unsupported feature alignment before fitting", {
  cfg <- list(model_id = "glm", vif_reduction = TRUE, vif_threshold = 5)
  expect_error(
    sdm_stage_fit(cfg, occ = NULL, env = NULL),
    "GLM VIF is not supported in the staged pipeline"
  )
})
