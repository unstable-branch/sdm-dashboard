if (!exists("normalize_targets_config", mode = "function")) {
  source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"))
}

test_that("Python models are discovered when arrow is installed", {
  skip_if_not_installed("arrow")
  manifests <- tryCatch(discover_python_models(), error = function(e) character(0))
  python_ids <- grep("^python_", sdm_model_ids(), value = TRUE)
  if (length(manifests) > 0) {
    expect_true(length(python_ids) > 0)
  }
})

test_that("fit_python_sdm fails gracefully without arrow", {
  if (!requireNamespace("arrow", quietly = TRUE)) {
    env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"))
    occ <- data.frame(longitude = c(140, 141), latitude = c(-23, -24))
    expect_error(fit_python_sdm(occ, env), "arrow package")
  }
})

test_that("torch_dnn manifest selection retains its own path and defaults", {
  source(file.path(project_root, "R", "core", "python_setup.R"))
  source(file.path(project_root, "R", "models", "model_python.R"))

  selected <- find_python_model_manifest("torch_dnn")
  expect_false(is.null(selected))
  expect_true(endsWith(selected$path, file.path("torch_dnn", "manifest.json")))
  expect_identical(selected$manifest$id, "torch_dnn")

  defaults <- python_manifest_param_defaults(selected$manifest)
  expect_identical(defaults$hidden_layers, list(64L, 32L))
  expect_identical(defaults$device, "auto")
  expect_identical(defaults$epochs, 100L)
})

test_that("Python config parameters use only matching named manifest overrides", {
  manifest <- list(params = list(
    epochs = list(default = 100L),
    device = list(default = "auto"),
    hidden_layers = list(default = list(64L, 32L))
  ))
  params <- python_model_config_params(manifest, list(
    epochs = 7L,
    device = "cpu",
    unrelated_pipeline_arg = "do-not-forward"
  ))

  expect_identical(params$epochs, 7L)
  expect_identical(params$device, "cpu")
  expect_identical(params$hidden_layers, list(64L, 32L))
  expect_false("unrelated_pipeline_arg" %in% names(params))

  nullable <- list(params = list(max_depth = list(type = "integer", default = NULL)))
  expect_identical(python_model_config_params(nullable, list(max_depth = 12L))$max_depth, 12L)
})

test_that("Python manifest parameters propagate through config and fit paths", {
  cfg <- sdm_config(
    model_id = "python_torch_dnn",
    occurrence_file = "unused.csv",
    projection_extent = c(112, 154, -44, -10),
    hidden_layers = "128, 64",
    epochs = "7",
    batch_size = "16",
    predict_batch_size = "2048",
    learning_rate = "0.002",
    dropout = "0.15",
    python_device = "cpu",
    early_stopping_patience = "5",
    validation_fraction = "0.25"
  )
  expected <- list(
    hidden_layers = c(128L, 64L), epochs = 7L, batch_size = 16L,
    predict_batch_size = 2048L, learning_rate = 0.002, dropout = 0.15,
    device = "cpu", early_stopping_patience = 5L, validation_fraction = 0.25
  )

  expect_identical(python_model_extra_args(cfg$model_id, cfg), expected)
  expect_identical(build_stage_extra_args(cfg, cfg$model_id), expected)

  target_config <- normalize_targets_config(list(
    species = "Test species", modelId = "python_torch_dnn",
    occurrenceFile = "unused.csv", hiddenLayers = c(256L, 128L),
    epochs = 9L, batchSize = 32L, predictBatchSize = 4096L,
    learningRate = 0.003, dropout = 0.2, pythonDevice = "cpu",
    earlyStoppingPatience = 6L, validationFraction = 0.3
  ))
  expect_identical(target_config$hidden_layers, "256,128")
  expect_identical(target_config$python_device, "cpu")
  batch_args <- build_run_args(target_config)
  expect_identical(batch_args$hidden_layers, c(256L, 128L))
  expect_identical(batch_args$epochs, 9L)
  expect_identical(batch_args$batch_size, 32L)
  expect_identical(batch_args$predict_batch_size, 4096L)
  expect_identical(batch_args$learning_rate, 0.003)
  expect_identical(batch_args$dropout, 0.2)
  expect_identical(batch_args$early_stopping_patience, 6L)
  expect_identical(batch_args$validation_fraction, 0.3)
  expect_identical(batch_args$python_device, "cpu")
})

test_that("Python runtime metadata is parsed for backend verification", {
  metadata <- parse_python_metadata(c(
    "warning emitted before model output",
    'METADATA: {"device":"rocm","epochs_completed":9}',
    "SUCCESS: model saved"
  ))
  expect_identical(metadata$device, "rocm")
  expect_identical(metadata$epochs_completed, 9L)
  expect_identical(parse_python_metadata("SUCCESS: no metadata"), list())
})

test_that("Python registry binds each manifest id instead of the final loop value", {
  source(file.path(project_root, "R", "models", "model_registry.R"))
  manifest_paths <- file.path(project_root, "python_models", c("elapid", "sklearn_rf", "torch_dnn"), "manifest.json")
  original_fit <- get("fit_python_sdm", envir = .GlobalEnv)
  assign("fit_python_sdm", function(..., python_model_id) python_model_id, envir = .GlobalEnv)
  on.exit(assign("fit_python_sdm", original_fit, envir = .GlobalEnv), add = TRUE)

  register_python_sdm_models(manifest_paths)
  expect_identical(get_sdm_model("python_elapid")$fit_fun(), "elapid")
  expect_identical(get_sdm_model("python_sklearn_rf")$fit_fun(), "sklearn_rf")
  expect_identical(get_sdm_model("python_torch_dnn")$fit_fun(), "torch_dnn")
})
