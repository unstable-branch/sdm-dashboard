# Tests for batch_run_targets() and targets pipeline setup

test_that("batch_run_targets sets env vars and creates output dir", {
  skip_if_not_installed("targets")

  local_mocked_bindings(
    tar_make = function(store, ...) invisible(NULL),
    .package = "targets"
  )

  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  write.csv(data.frame(
    species = "Test", occurrences_csv = "/tmp/test.csv",
    model_id = "glm", biovars = "1,4,12"
  ), tmp_csv, row.names = FALSE)

  tmp_out <- tempfile()
  on.exit(unlink(tmp_out, recursive = TRUE), add = TRUE)

  batch_run_targets(tmp_csv, output_dir = tmp_out, seed = 42L)

  expect_equal(Sys.getenv("SDM_BATCH_CONFIG"), normalizePath(tmp_csv))
  expect_equal(Sys.getenv("SDM_BATCH_OUTPUT"), normalizePath(tmp_out))
  expect_equal(Sys.getenv("SDM_BATCH_SEED"), "42")
  expect_true(dir.exists(tmp_out))
})

test_that("batch_run_targets with workers env var", {
  skip_if_not_installed("targets")

  local_mocked_bindings(
    tar_make = function(store, ...) invisible(NULL),
    .package = "targets"
  )

  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  write.csv(data.frame(
    species = "Test", occurrences_csv = "/tmp/test.csv"
  ), tmp_csv, row.names = FALSE)

  tmp_out <- tempfile()
  on.exit(unlink(tmp_out, recursive = TRUE), add = TRUE)

  batch_run_targets(tmp_csv, output_dir = tmp_out, workers = 4L, seed = 1L)

  expect_equal(Sys.getenv("SDM_TARGETS_WORKERS"), "4")
  expect_equal(Sys.getenv("SDM_BATCH_SEED"), "1")
})

test_that("batch_run_targets errors on non-existent config CSV", {
  skip_if_not_installed("targets")

  expect_error(
    batch_run_targets("/nonexistent/config.csv", output_dir = tempfile()),
    "No such file or directory"
  )
})

test_that("build_config_from_row accepts multi-species config rows", {
  skip_if_not_installed("terra")

  multi_csv <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  skip_if_not(file.exists(multi_csv), message = "Synthetic CSV not found")

  rows <- list(
    list(
      species = "Species A",
      occurrences_csv = multi_csv,
      model_id = "glm",
      biovars = "1,4,6",
      cv_folds = "3",
      background_n = "100"
    ),
    list(
      species = "Species B",
      occurrences_csv = multi_csv,
      model_id = "rangebag",
      biovars = "1,4,12",
      cv_folds = "3",
      background_n = "100"
    )
  )

  cfgs <- lapply(rows, build_config_from_row, seed = 42L)
  expect_length(cfgs, 2)
  expect_s3_class(cfgs[[1]], "sdm_config")
  expect_s3_class(cfgs[[2]], "sdm_config")
  expect_equal(cfgs[[1]]$species, "Species A")
  expect_equal(cfgs[[2]]$species, "Species B")
  expect_equal(cfgs[[1]]$model_id, "glm")
  expect_equal(cfgs[[2]]$model_id, "rangebag")
  expect_equal(cfgs[[1]]$selected_biovars, c(1L, 4L, 6L))
  expect_equal(cfgs[[2]]$selected_biovars, c(1L, 4L, 12L))
})

test_that("batch_run_targets integration (requires targets package)", {
  skip_if_not_installed("targets")
  skip_if_not_installed("terra")

  wc_dir <- file.path(project_root, "Worldclim")
  skip_if_not(dir.exists(wc_dir), message = "WorldClim data not available")

  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv))
  write.csv(data.frame(
    species = c("Integration_A", "Integration_B"),
    occurrences_csv = file.path(project_root, "data", "examples",
      "synthetic_presence_data.csv"),
    model_id = c("glm", "glm"),
    biovars = c("1,4,12", "1,4,12"),
    projection_extent = c("112,154,-44,-10", "112,154,-44,-10"),
    cv_folds = c("2", "2"),
    background_n = c("100", "100"),
    worldclim_dir = c(normalizePath(wc_dir), normalizePath(wc_dir)),
    stringsAsFactors = FALSE
  ), tmp_csv, row.names = FALSE)

  tmp_out <- tempfile()
  on.exit(unlink(tmp_out, recursive = TRUE), add = TRUE)

  expect_error(
    batch_run_targets(tmp_csv, output_dir = tmp_out, seed = 42),
    NA
  )
})
