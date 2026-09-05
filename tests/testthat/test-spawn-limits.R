# Tests for the background-process spawn helpers in plumber/R/helpers/vsize.R.
#
# Before this fix, every callr::r_bg call site passed
#   r_limit_memory = sdm_vsize_to_bytes()
# unconditionally. Two independent bugs made model runs 500:
#
# 1. sdm_vsize_to_bytes() used as.integer(), which overflows int32 for any
#    vsize >= 2Gb (as.integer(6 * 1024^3) is NA) — the limit was silently
#    disabled for typical container configurations.
# 2. callr 3.8.0 removed the r_limit_memory parameter from r_bg(). Forwarding
#    it through ... fails deep inside callr with
#    "unused argument (r_limit_memory = NA)". In handle_model_run the spawn
#    error was captured as `proc`, and the unguarded proc$get_pid() then
#    crashed with "attempt to apply non-function" → plumber returned a bare
#    500 and the API worker marked the run failed with
#    "500 - Internal server error".
#
# The fix: numeric bytes (no int32 overflow), feature-detect r_limit_memory
# support before passing it, and guard get_pid() via sdm_process_pid().

# vsize helpers are sourced here (helper-load.R does not load plumber files)
# with a project-root-relative fallback in case the harness runs in isolation.
if (!exists("sdm_vsize_to_bytes")) {
  root_candidates <- c(".", "..", file.path("..", ".."), file.path("..", "..", ".."))
  for (cand in root_candidates) {
    cand <- normalizePath(cand, winslash = "/", mustWork = FALSE)
    if (file.exists(file.path(cand, "app.R"))) {
      source(file.path(cand, "plumber", "R", "helpers", "vsize.R"))
      break
    }
  }
}

test_that("sdm_vsize_to_bytes returns numeric bytes without int32 overflow", {
  six_gb <- sdm_vsize_to_bytes("6Gb")
  expect_equal(six_gb, 6 * 1024^3)
  expect_type(six_gb, "double")
  expect_gt(six_gb, .Machine$integer.max)

  expect_equal(sdm_vsize_to_bytes("16Gb"), 16 * 1024^3)
  expect_equal(sdm_vsize_to_bytes("1Gb"), 1024^3)
})

test_that("sdm_vsize_to_bytes returns NA for invalid input", {
  expect_true(is.na(sdm_vsize_to_bytes("")))
  expect_true(is.na(sdm_vsize_to_bytes(NULL)))
  expect_true(is.na(sdm_vsize_to_bytes("banana")))
  expect_true(is.na(sdm_vsize_to_bytes("0Gb")))
  expect_true(is.na(sdm_vsize_to_bytes("-4Gb")))
})

test_that("sdm_spawn_background works with the installed callr version", {
  skip_if_not_installed("callr")
  proc <- sdm_spawn_background(
    function(x) x + 1,
    args = list(41)
  )
  expect_s3_class(proc, "R6")
  pid <- sdm_process_pid(proc)
  expect_true(is.finite(pid))
  proc$kill()
  proc$wait()
})

test_that("sdm_spawn_background does not pass r_limit_memory when unsupported", {
  skip_if_not_installed("callr")
  supported <- "r_limit_memory" %in% names(formals(callr::r_bg))
  # Regardless of support, spawn must not throw (callr <3.8 forwards the arg;
  # callr >=3.8 must not receive it at all).
  expect_no_error({
    proc <- sdm_spawn_background(function() invisible(NULL))
  })
  if (!is.null(proc)) {
    proc$kill()
    proc$wait()
  }
  expect_type(supported, "logical")
})

test_that("sdm_process_pid returns NA instead of crashing on bad objects", {
  expect_true(is.na(sdm_process_pid(NULL)))
  expect_true(is.na(sdm_process_pid(list(a = 1))))
  expect_true(is.na(sdm_process_pid("not-a-process")))
  expect_true(is.na(sdm_process_pid(list(error = "spawn failed"))))
})

test_that("load_compute.R registers the shared climate modules", {
  # run_model_background.R loads the child via R/load_compute.R, which does not
  # include engine_load.R/load.R. covariates_climate.R calls
  # match_worldclim_biovars() and write_cache_manifest() directly, so omitting
  # the shared modules fails every model run at the covariate-loading stage
  # with 'could not find function "match_worldclim_biovars"'.
  root <- normalizePath(file.path("..", ".."), mustWork = FALSE)
  lines <- readLines(file.path(root, "R", "load_compute.R"))
  for (mod in c("match_climate_layers.R", "climate_cache_manifest.R")) {
    expect_true(any(grepl(paste0('"', mod, '"'), lines, fixed = TRUE)),
                info = paste("load_compute.R is missing", mod))
  }
})
