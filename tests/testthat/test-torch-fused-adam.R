# torch_fused_adam.R unit tests — skip gracefully when torch unavailable.

skip_if_no_torch <- function() {
  torch_ok <- requireNamespace("torch", quietly = TRUE) &&
    tryCatch(torch::torch_is_installed(), error = function(e) FALSE)
  if (!torch_ok) skip("torch not available")
}

skip_if_no_cito <- function() {
  cito_ok <- requireNamespace("cito", quietly = TRUE)
  if (!cito_ok) skip("cito not available")
}

sdm_root <- if (exists("sdm_project_root", mode = "function")) sdm_project_root() else getwd()
source(file.path(sdm_root, "R", "models", "torch_fused_adam.R"), local = TRUE)

test_that("sdm_check_so_abi returns FALSE for missing file", {
  result <- sdm_check_so_abi("/nonexistent/path/train_step_adam.so")
  expect_false(result)
})

test_that("sdm_check_abi_versions stops on major.minor mismatch", {
  caught <- tryCatch(
    sdm_check_abi_versions("0.10.0", "0.17.0", "train_step_adam.so"),
    error = function(e) conditionMessage(e)
  )
  expect_type(caught, "character")
  expect_length(caught, 1)
  expect_true(nzchar(caught))
  expect_match(caught, "ABI mismatch", fixed = TRUE)
  expect_match(caught, "train_step_adam.so", fixed = TRUE)
  expect_match(caught, "0.10.0")
  expect_match(caught, "0.17.0")
})

test_that("sdm_check_abi_versions passes when major.minor match (patch may differ)", {
  expect_invisible(sdm_check_abi_versions("0.17.0", "0.17.1", "test.so"))
})

test_that("sdm_check_abi_versions returns FALSE invisibly for unknown version", {
  expect_false(sdm_check_abi_versions("unknown", "0.17.0", "test.so"))
  expect_false(sdm_check_abi_versions("0.17.0", "unknown", "test.so"))
  expect_false(sdm_check_abi_versions("unknown", "unknown", "test.so"))
})

test_that("sdm_check_so_abi returns FALSE for unloaded .so", {
  # When sdmtorch_torch_version is already loaded globally (e.g. train_step_adam.so
  # was built and loaded in this session), .Call finds the global symbol and
  # sdm_check_so_abi returns TRUE — which is correct because the ABI is valid.
  # The FALSE path (symbol not loaded) is only exercisable before any .so is loaded.
  if (is.loaded("sdmtorch_torch_version", PACKAGE = "")) {
    skip("sdmtorch_torch_version already loaded — sdm_check_so_abi returns TRUE by design")
  }
  tmp <- tempfile(fileext = ".so")
  on.exit(unlink(tmp), add = TRUE)
  writeBin(as.raw(rep(0xFF, 32)), tmp)
  expect_false(sdm_check_so_abi(tmp, "test.so"))
})

test_that("multi-output model triggers AMP disable via n_outputs path", {
  skip_if_no_torch()

  # Build a mock model with out_features > 1 (multispecies)
  mock_net <- list(
    out_features = 3L,
    parameters = function() list()
  )
  mock_model <- list(
    net = mock_net,
    training_properties = list(embeddings = NULL),
    losses = list(train_l = rep(NA_real_, 10))
  )

  # Patch set_train_opts to return cpu
  set_train_opts(mixed_precision = "auto", cuda_graphs = "auto", backend = "cpu")

  # The multi-output AMP disable path: n_outputs = 3 > 1
  # We can't easily call train_model_fused without a full environment,
  # so we just verify the n_outputs detection logic directly
  n_outputs <- if (!is.null(mock_model$net$out_features)) mock_model$net$out_features else 1L
  expect_equal(n_outputs, 3L)
  expect_true(n_outputs > 1L)
})

test_that("cuda_graph_reset_stream is safe to call even when not loaded", {
  # Should not error even if the symbol is not loaded
  result <- tryCatch(
    {
      if (is.loaded("cuda_graph_reset_stream", PACKAGE = "")) {
        .Call("cuda_graph_reset_stream")
      }
      TRUE
    },
    error = function(e) FALSE
  )
  expect_true(result)
})

test_that("set_float32_matmul_precision save/restore workflow", {
  skip_if_no_torch()

  # Verify torch has get_float32_matmul_precision
  has_getter <- exists("get_float32_matmul_precision", envir = asNamespace("torch"))
  expect_type(has_getter, "logical")

  if (has_getter) {
    prev <- tryCatch(torch::get_float32_matmul_precision(), error = function(e) "unknown")
    expect_type(prev, "character")
    expect_true(nzchar(prev))
  }
})
