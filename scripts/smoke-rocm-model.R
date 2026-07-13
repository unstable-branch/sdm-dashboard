#!/usr/bin/env Rscript

# One-shot acceptance smoke for the container's complete R -> Python -> ROCm
# torch_dnn path. Run on a host exposing /dev/kfd and /dev/dri.
project_root <- Sys.getenv("SDM_PROJECT_ROOT", "/app")
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "load_compute.R"), local = FALSE)

python <- Sys.getenv("SDM_PYTHON", "/opt/venv/bin/python3")
if (!file.exists(python)) stop("SDM_PYTHON is unavailable: ", python, call. = FALSE)

set.seed(6900)
template <- terra::rast(
  nrows = 24, ncols = 24, xmin = 0, xmax = 24, ymin = 0, ymax = 24,
  crs = "EPSG:4326"
)
env <- c(template, template, template)
names(env) <- c("bio1", "bio12", "elevation")
terra::values(env[[1]]) <- stats::rnorm(terra::ncell(template))
terra::values(env[[2]]) <- stats::rnorm(terra::ncell(template))
terra::values(env[[3]]) <- stats::runif(terra::ncell(template), -1, 1)

values <- as.data.frame(terra::values(env))
score <- 1.6 * values$bio1 - values$bio12 + 0.5 * values$elevation
presence_cells <- which(score > stats::quantile(score, 0.78))
xy <- terra::xyFromCell(env, sample(presence_cells, min(70L, length(presence_cells))))
occ <- data.frame(longitude = xy[, 1], latitude = xy[, 2])

fit <- fit_python_sdm(
  occ = occ,
  env_train_scaled = env,
  background_n = 100L,
  cv_folds = 0L,
  seed = 42L,
  python_model_id = "torch_dnn",
  device = "rocm",
  hidden_layers = list(16L, 8L),
  epochs = 12L,
  batch_size = 32L,
  predict_batch_size = 37L,
  learning_rate = 0.005,
  dropout = 0,
  early_stopping_patience = 4L,
  validation_fraction = 0.2
)

output <- tempfile(fileext = ".tif")
on.exit(unlink(output), add = TRUE)
suitability <- predict_python_suitability(fit, env, output)
predictions <- terra::values(suitability, mat = FALSE)

stopifnot(
  identical(fit$model$runtime_metadata$device, "rocm"),
  identical(fit$model$model_params$predict_batch_size, 37L),
  file.exists(fit$model$model_path),
  nrow(fit$variable_importance) == 3L,
  file.exists(output),
  length(predictions) == terra::ncell(env),
  all(is.finite(predictions)),
  all(predictions >= 0 & predictions <= 1)
)

cat(sprintf(
  "ROCm model smoke: ok (%d rows, backend=%s, predict_batch_size=%d)\n",
  length(predictions),
  fit$model$runtime_metadata$device,
  fit$model$model_params$predict_batch_size
))
