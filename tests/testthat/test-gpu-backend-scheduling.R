if (!exists("sdm_resolve_backend", mode = "function")) {
  source(file.path(project_root, "R", "core", "gpu_helpers.R"))
}
if (!exists("sdm_model_gpu_backend", mode = "function")) {
  source(file.path(project_root, "plumber", "R", "helpers", "plumber_helpers.R"))
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

test_that("CUDA-native helper gates never activate for ROCm or MPS", {
  rocm_caps <- list(cuda = TRUE, rocm = TRUE, mps = FALSE)
  expect_false(sdm_is_cuda_backend("rocm", rocm_caps))
  expect_false(sdm_is_cuda_backend("mps", list(cuda = FALSE, mps = TRUE)))
  expect_true(sdm_is_cuda_backend("cuda", list(cuda = TRUE, rocm = FALSE, mps = FALSE)))
  expect_false(sdm_load_pinned_alloc("rocm"))
  expect_false(sdm_load_pinned_alloc("mps"))
})
