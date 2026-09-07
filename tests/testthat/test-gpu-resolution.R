# GPU resolution and capability-detection tests.
# Pure-R tests — no torch required, no GPU required.

if (!exists("sdm_accelerator_capabilities", mode = "function")) {
  source(file.path(project_root, "R", "core", "gpu_helpers.R"))
}

test_that("sdm_device_is_cuda_tensor identifies CUDA tensors", {
  expect_true(sdm_device_is_cuda_tensor("cuda"))
  expect_true(sdm_device_is_cuda_tensor("cuda:0"))
  expect_true(sdm_device_is_cuda_tensor("cuda:1"))
  expect_false(sdm_device_is_cuda_tensor("cpu"))
  expect_false(sdm_device_is_cuda_tensor("mps"))
  expect_false(sdm_device_is_cuda_tensor(NULL))
  expect_false(sdm_device_is_cuda_tensor(character(0)))
})

test_that(".sdm_rocm_runtime_detected returns logical(1)", {
  result <- .sdm_rocm_runtime_detected()
  expect_type(result, "logical")
  expect_length(result, 1)
})

test_that("SDM_ROCM=1 opt-in triggers message when no runtime detected", {
  old_env <- Sys.getenv("SDM_ROCM", unset = NA)
  Sys.setenv(SDM_ROCM = "1")
  on.exit({
    if (is.na(old_env)) Sys.unsetenv("SDM_ROCM") else Sys.setenv(SDM_ROCM = old_env)
  }, add = TRUE)

  # Clear the session cache so the message fires
  if (exists("caps", envir = ._gpu_caps_cache)) {
    rm("caps", envir = ._gpu_caps_cache)
  }

  expect_message(
    sdm_accelerator_capabilities(list(cuda = FALSE, rocm = FALSE, mps = FALSE)),
    "SDM_ROCM=1 is set, but no ROCm runtime"
  )
})

test_that("SDM_ROCM=0 does not trigger message", {
  old_env <- Sys.getenv("SDM_ROCM", unset = NA)
  Sys.setenv(SDM_ROCM = "0")
  on.exit({
    if (is.na(old_env)) Sys.unsetenv("SDM_ROCM") else Sys.setenv(SDM_ROCM = old_env)
  }, add = TRUE)

  if (exists("caps", envir = ._gpu_caps_cache)) {
    rm("caps", envir = ._gpu_caps_cache)
  }

  expect_silent(sdm_accelerator_capabilities(list(cuda = FALSE, rocm = FALSE, mps = FALSE)))
})

test_that("session cache returns same object on repeated calls", {
  if (exists("caps", envir = ._gpu_caps_cache)) {
    rm("caps", envir = ._gpu_caps_cache)
  }

  caps1 <- sdm_accelerator_capabilities(list(cuda = FALSE, rocm = FALSE, mps = FALSE))
  caps2 <- sdm_accelerator_capabilities(list(cuda = FALSE, rocm = FALSE, mps = FALSE))
  expect_identical(caps1, caps2)
})

test_that("capabilities= argument always refreshes cache", {
  if (exists("caps", envir = ._gpu_caps_cache)) {
    rm("caps", envir = ._gpu_caps_cache)
  }

  # Call with cuda=FALSE — caches FALSE
  sdm_accelerator_capabilities(list(cuda = FALSE, rocm = FALSE, mps = FALSE))
  # Call with cuda=TRUE — overwrites cache with TRUE
  sdm_accelerator_capabilities(list(cuda = TRUE, rocm = FALSE, mps = FALSE))

  # Calling with no args returns the last cached result
  cached <- sdm_accelerator_capabilities()
  expect_true(cached$cuda)
})
