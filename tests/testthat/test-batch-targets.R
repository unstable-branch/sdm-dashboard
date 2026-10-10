# Tests for batch_run_targets() and config-row parsing.
# New Targets execution remains unavailable until durable ownership exists.

test_that("batch_run_targets fails closed before side effects", {
  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv), add = TRUE)
  write.csv(data.frame(species = "Test", occurrences_csv = "test.csv"),
    tmp_csv, row.names = FALSE)

  tmp_out <- tempfile("targets-disabled-")
  env_names <- c(
    "SDM_BATCH_CONFIG", "SDM_BATCH_OUTPUT", "SDM_TARGETS_STORE",
    "SDM_CLUSTER_WORKERS", "SDM_BATCH_SEED"
  )
  previous <- Sys.getenv(env_names, unset = NA_character_)
  on.exit({
    for (name in env_names) {
      value <- previous[[name]]
      if (is.na(value)) {
        Sys.unsetenv(name)
      } else {
        do.call(Sys.setenv, stats::setNames(list(value), name))
      }
    }
  }, add = TRUE)
  Sys.unsetenv(env_names)

  tar_make_called <- FALSE
  if (requireNamespace("targets", quietly = TRUE)) {
    local_mocked_bindings(
      tar_make = function(...) tar_make_called <<- TRUE,
      .package = "targets"
    )
  }

  expect_error(
    batch_run_targets(tmp_csv, output_dir = tmp_out, workers = 4L, seed = 1L),
    "TARGETS_DURABLE_EXECUTION_UNAVAILABLE"
  )
  expect_false(tar_make_called)
  expect_false(dir.exists(tmp_out))
  expect_identical(unname(Sys.getenv(env_names)), rep("", length(env_names)))
})

test_that("batch_run_targets refuses config validation while unavailable", {
  tmp_out <- tempfile("targets-disabled-")
  expect_error(
    batch_run_targets("/nonexistent/config.csv", output_dir = tmp_out, workers = 4L),
    "TARGETS_DURABLE_EXECUTION_UNAVAILABLE"
  )
  expect_false(dir.exists(tmp_out))
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

test_that("build_config_from_row handles nullable fields", {
  row <- list(species = "Minimal", occurrences_csv = "data.csv")
  cfg <- build_config_from_row(row, seed = 1L)
  expect_s3_class(cfg, "sdm_config")
  expect_equal(cfg$species, "Minimal")
  expect_true(is.numeric(cfg$selected_biovars))
})
