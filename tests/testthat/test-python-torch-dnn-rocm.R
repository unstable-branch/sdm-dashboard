test_that("R bridge fits and predicts with torch_dnn on ROCm", {
  skip_if_not(identical(tolower(Sys.getenv("SDM_RUN_ROCM_TESTS")), "true"),
    "set SDM_RUN_ROCM_TESTS=true on an AMD ROCm host")
  skip_if_not_installed("arrow")
  skip_if_not_installed("terra")

  python <- Sys.getenv(
    "SDM_ROCM_PYTHON",
    file.path(project_root, ".venv-rocm", "bin", "python")
  )
  skip_if_not(file.exists(python), "ROCm Python environment is unavailable")

  withr::local_envvar(c(
    SDM_PYTHON = python,
    HSA_OVERRIDE_GFX_VERSION = Sys.getenv("HSA_OVERRIDE_GFX_VERSION", "10.3.0")
  ))

  set.seed(6900)
  template <- terra::rast(nrows = 24, ncols = 24, xmin = 0, xmax = 24, ymin = 0, ymax = 24,
    crs = "EPSG:4326")
  bio1 <- template
  bio12 <- template
  elevation <- template
  terra::values(bio1) <- stats::rnorm(terra::ncell(template))
  terra::values(bio12) <- stats::rnorm(terra::ncell(template))
  terra::values(elevation) <- stats::runif(terra::ncell(template), -1, 1)
  env <- c(bio1, bio12, elevation)
  names(env) <- c("bio1", "bio12", "elevation")

  values <- as.data.frame(terra::values(env))
  score <- 1.6 * values$bio1 - values$bio12 + 0.5 * values$elevation
  presence_cells <- which(score > stats::quantile(score, 0.82))
  presence_cells <- sample(presence_cells, min(70L, length(presence_cells)))
  xy <- terra::xyFromCell(env, presence_cells)
  occ <- data.frame(longitude = xy[, 1], latitude = xy[, 2])

  fit <- fit_python_sdm(
    occ = occ,
    env_train_scaled = env,
    background_n = 100L,
    cv_folds = 0L,
    seed = 42L,
    python_model_id = "torch_dnn",
    device = "rocm",
    hidden_layers = list(32L, 16L),
    epochs = 20L,
    batch_size = 32L,
    predict_batch_size = 37L,
    learning_rate = 0.005,
    dropout = 0,
    early_stopping_patience = 5L,
    validation_fraction = 0.2
  )

  expect_identical(fit$model$runtime_metadata$device, "rocm")
  expect_identical(fit$model$model_params$predict_batch_size, 37L)
  expect_true(file.exists(fit$model$model_path))
  expect_equal(nrow(fit$variable_importance), 3L)

  output <- tempfile(fileext = ".tif")
  on.exit(unlink(output), add = TRUE)
  suitability <- predict_python_suitability(fit, env, output)
  predictions <- terra::values(suitability, mat = FALSE)

  expect_true(file.exists(output))
  expect_equal(length(predictions), terra::ncell(env))
  expect_true(all(is.finite(predictions)))
  expect_true(all(predictions >= 0 & predictions <= 1))
})
