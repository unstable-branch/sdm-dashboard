if (!exists("sdm_resolve_backend", mode = "function")) {
  source(file.path(project_root, "R", "core", "gpu_helpers.R"))
}
if (!exists("sdm_model_gpu_backend", mode = "function")) {
  source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"))
}
if (!exists("sdm_force_cpu_runtime_config", mode = "function")) {
  source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"))
}

test_that("backend resolution preserves ROCm's internal torch device without vendor crossover", {
  rocm_caps <- list(cuda = TRUE, rocm = TRUE, mps = FALSE)
  auto <- sdm_resolve_backend("auto", rocm_caps)
  expect_identical(auto$backend, "rocm")
  expect_identical(auto$device, "cuda")

  explicit_cuda <- sdm_resolve_backend("cuda", rocm_caps)
  expect_identical(explicit_cuda$backend, "cpu")
  expect_false(explicit_cuda$requested_available)
  expect_identical(sdm_resolve_backend("rocm", rocm_caps)$backend, "rocm")
  expect_identical(sdm_resolve_backend("mps", list(cuda = FALSE, mps = TRUE))$backend, "mps")
})

test_that("GPU process counts include accelerator tags while CPU counts exclude them", {
  old_registry <- if (exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) {
    get("sdm_process_registry", envir = .GlobalEnv)
  } else NULL
  on.exit({
    if (is.null(old_registry)) {
      if (exists("sdm_process_registry", envir = .GlobalEnv, inherits = FALSE)) rm("sdm_process_registry", envir = .GlobalEnv)
    } else {
      assign("sdm_process_registry", old_registry, envir = .GlobalEnv)
    }
  }, add = TRUE)

  alive <- structure(list(is_alive = function() TRUE), class = "process")
  reg <- new.env(parent = emptyenv())
  reg$cuda <- list(proc = alive, device = "cuda")
  reg$rocm <- list(proc = alive, device = "rocm")
  reg$mps <- list(proc = alive, device = "mps")
  reg$legacy <- list(proc = alive, device = "gpu")
  reg$cpu <- list(proc = alive, device = "cpu")
  assign("sdm_process_registry", reg, envir = .GlobalEnv)

  expect_equal(sdm_count_active_gpu_runs(), 4L)
  expect_equal(sdm_count_active_cpu_runs(), 1L)
})

test_that("XGBoost's R GPU path remains NVIDIA CUDA-only", {
  old_config <- config
  on.exit(assign("config", old_config, envir = .GlobalEnv), add = TRUE)
  config$gpu_enabled <- "auto"
  config$gpu_device <- "auto"
  config$gpu_min_rows <- 100L

  expect_true(sdm_use_gpu_xgb(100L, list(cuda = TRUE, rocm = FALSE, mps = FALSE)))
  expect_false(sdm_use_gpu_xgb(100L, list(cuda = TRUE, rocm = TRUE, mps = FALSE)))
  expect_false(sdm_use_gpu_xgb(100L, list(cuda = FALSE, rocm = FALSE, mps = TRUE)))
})

test_that("python_torch_dnn schedules on reported ROCm without probing Python", {
  python_rocm <- list(cuda = TRUE, rocm = TRUE, mps = FALSE)
  expect_identical(
    sdm_model_gpu_backend("python_torch_dnn", python_capabilities = python_rocm),
    "rocm"
  )
  expect_true(sdm_is_gpu_model("python_torch_dnn", python_capabilities = python_rocm))
  expect_identical(
    sdm_model_gpu_backend("python_torch_dnn", python_capabilities = python_rocm, python_device = "cuda"),
    "cpu"
  )
  sdm_reset_python_torch_capabilities()
  expect_length(ls(.sdm_python_torch_capability_cache), 0L)
})

test_that("Python capability probing safely executes a real interpreter payload", {
  python <- Sys.which("python3")
  skip_if(!nzchar(python), "python3 is unavailable")

  fake_modules <- tempfile("fake-torch-")
  dir.create(fake_modules)
  writeLines(c(
    "class Available:",
    "    @staticmethod",
    "    def is_available(): return True",
    "class Version:",
    "    hip = '6.0'",
    "cuda = Available()",
    "version = Version()",
    "class Backends:",
    "    mps = Available()",
    "backends = Backends()"
  ), file.path(fake_modules, "torch.py"))
  old_python <- Sys.getenv("SDM_PYTHON", unset = NA_character_)
  old_pythonpath <- Sys.getenv("PYTHONPATH", unset = NA_character_)
  on.exit({
    if (is.na(old_python)) Sys.unsetenv("SDM_PYTHON") else Sys.setenv(SDM_PYTHON = old_python)
    if (is.na(old_pythonpath)) Sys.unsetenv("PYTHONPATH") else Sys.setenv(PYTHONPATH = old_pythonpath)
    unlink(fake_modules, recursive = TRUE)
    sdm_reset_python_torch_capabilities()
  }, add = TRUE)
  Sys.setenv(SDM_PYTHON = python, PYTHONPATH = fake_modules)
  sdm_reset_python_torch_capabilities()

  capabilities <- sdm_python_torch_capabilities(refresh = TRUE)
  expect_true(capabilities$rocm)
  expect_true(capabilities$cuda_compatible)
  expect_false(capabilities$cuda)
  expect_true(capabilities$mps)
})

test_that("VRAM fallback forces model runtime controls to CPU", {
  dnn <- sdm_force_cpu_runtime_config(list(model_id = "dnn", gpu_enabled = "auto", dnn_device = "rocm"))
  expect_identical(dnn$gpu_enabled, "off")
  expect_identical(dnn$dnn_device, "cpu")

  multispecies <- sdm_force_cpu_runtime_config(list(model_id = "dnn_multispecies", dnn_device = "cuda"))
  expect_identical(multispecies$gpu_enabled, "off")
  expect_identical(multispecies$dnn_device, "cpu")

  python <- sdm_force_cpu_runtime_config(list(model_id = "python_torch_dnn", python_device = "rocm", device = "rocm"))
  expect_identical(python$gpu_enabled, "off")
  expect_identical(python$python_device, "cpu")
  expect_identical(python$device, "cpu")

  xgb <- sdm_force_cpu_runtime_config(list(model_id = "xgboost", gpu_enabled = "auto"))
  expect_identical(xgb$gpu_enabled, "off")
})

test_that("CUDA-native helper gates never activate for ROCm or MPS", {
  rocm_caps <- list(cuda = TRUE, rocm = TRUE, mps = FALSE)
  expect_false(sdm_is_cuda_backend("rocm", rocm_caps))
  expect_false(sdm_is_cuda_backend("mps", list(cuda = FALSE, mps = TRUE)))
  expect_true(sdm_is_cuda_backend("cuda", list(cuda = TRUE, rocm = FALSE, mps = FALSE)))
  expect_false(sdm_load_pinned_alloc("rocm"))
  expect_false(sdm_load_pinned_alloc("mps"))
})
