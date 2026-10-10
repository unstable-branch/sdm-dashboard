# Subprocess coverage for the batch CLI's Targets and legacy boundaries.

batch_cli_script <- function() {
  normalizePath(
    testthat::test_path("..", "..", "scripts", "batch_run.R"),
    mustWork = TRUE
  )
}

run_batch_cli <- function(args, cwd = NULL, env = character()) {
  script <- batch_cli_script()
  output_path <- tempfile("batch-cli-output-")
  on.exit(unlink(output_path), add = TRUE)
  original_wd <- getwd()
  if (!is.null(cwd)) {
    setwd(cwd)
    on.exit(setwd(original_wd), add = TRUE)
  }

  status <- system2(
    file.path(R.home("bin"), "Rscript"),
    c("--vanilla", shQuote(script), vapply(args, shQuote, character(1))),
    stdout = output_path,
    stderr = output_path,
    env = env
  )
  list(
    status = status,
    output = paste(readLines(output_path, warn = FALSE), collapse = "\n")
  )
}

test_that("batch CLI help documents both the disabled Targets default and legacy route", {
  result <- run_batch_cli("--help")

  expect_identical(result$status, 0L)
  expect_match(result$output, "Usage:", fixed = TRUE)
  expect_match(result$output, "--no-targets", fixed = TRUE)
  expect_match(result$output, "TARGETS_DURABLE_EXECUTION_UNAVAILABLE", fixed = TRUE)
  expect_false(grepl("there is no package called", result$output, fixed = TRUE))
})

test_that("batch CLI denies the Targets default before optional dependencies or effects", {
  fixture_root <- tempfile("batch-cli-targets-fixture-")
  dir.create(file.path(fixture_root, "R", "core"), recursive = TRUE)
  on.exit(unlink(fixture_root, recursive = TRUE), add = TRUE)
  writeLines(
    "sdm_set_project_root <- function(root) invisible(root)",
    file.path(fixture_root, "R", "core", "bootstrap.R")
  )
  load_marker <- file.path(fixture_root, "load-marker")
  writeLines(
    c(
      "writeLines('loaded', Sys.getenv('SDM_TEST_LOAD_PATH'))",
      "parse_batch_config <- function(path) list(list(config = path))"
    ),
    file.path(fixture_root, "R", "engine_load.R")
  )
  config_path <- file.path(fixture_root, "config.csv")
  writeLines("fixture config", config_path)
  output_path <- file.path(fixture_root, "output")
  env <- c(
    "SDM_CLUSTER_BACKEND=preserve-me",
    "SDM_CLUSTER_WORKERS=preserve-me",
    paste0("SDM_TEST_LOAD_PATH=", load_marker)
  )

  result <- run_batch_cli(
    c("--config", config_path, "--output", output_path),
    cwd = fixture_root,
    env = env
  )

  expect_false(identical(result$status, 0L))
  expect_match(result$output, "TARGETS_DURABLE_EXECUTION_UNAVAILABLE", fixed = TRUE)
  expect_false(grepl("there is no package called", result$output, fixed = TRUE))
  expect_false(file.exists(load_marker))
  expect_false(dir.exists(output_path))
})

test_that("unknown or malformed no-targets spellings cannot select Targets", {
  for (args in list("--unknown-option", "--no-target")) {
    unknown <- run_batch_cli(args)
    expect_false(identical(unknown$status, 0L))
    expect_match(unknown$output, "TARGETS_DURABLE_EXECUTION_UNAVAILABLE", fixed = TRUE)
    expect_false(grepl("there is no package called", unknown$output, fixed = TRUE))
  }

  malformed <- run_batch_cli("--no-targets=true")
  expect_false(identical(malformed$status, 0L))
  expect_match(malformed$output, "Invalid option: --no-targets does not accept a value", fixed = TRUE)
  expect_false(grepl("SDM Batch Complete", malformed$output, fixed = TRUE))
})

test_that("exact --no-targets reaches legacy parsing and batch_run_parallel", {
  if (!requireNamespace("optparse", quietly = TRUE)) {
    result <- run_batch_cli("--no-targets")
    expect_false(identical(result$status, 0L))
    expect_match(result$output, "The legacy --no-targets mode requires the optional 'optparse' package", fixed = TRUE)
    expect_false(grepl("TARGETS_DURABLE_EXECUTION_UNAVAILABLE", result$output, fixed = TRUE))
    return(invisible(NULL))
  }

  fixture_root <- tempfile("batch-cli-legacy-fixture-")
  dir.create(file.path(fixture_root, "R", "core"), recursive = TRUE)
  on.exit(unlink(fixture_root, recursive = TRUE), add = TRUE)
  writeLines(
    "sdm_set_project_root <- function(root) invisible(root)",
    file.path(fixture_root, "R", "core", "bootstrap.R")
  )
  writeLines(
    c(
      "parse_batch_config <- function(path) list(list(config = path))",
      "normalize_core_count <- function(n, reserve_one = TRUE) 1L",
      "batch_run_parallel <- function(species_configs, n_cores, output_dir, seed) {",
      "  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)",
      "  writeLines('batch_run_parallel', Sys.getenv('SDM_TEST_DISPATCH_PATH'))",
      "  list(TRUE)",
      "}"
    ),
    file.path(fixture_root, "R", "engine_load.R")
  )
  config_path <- file.path(fixture_root, "config.csv")
  writeLines("fixture config", config_path)
  dispatch_path <- file.path(fixture_root, "dispatch.txt")
  output_path <- file.path(fixture_root, "output")

  result <- run_batch_cli(
    c("--no-targets", "--config", config_path, "--output", output_path),
    cwd = fixture_root,
    env = paste0("SDM_TEST_DISPATCH_PATH=", dispatch_path)
  )

  expect_identical(result$status, 0L)
  expect_true(file.exists(dispatch_path))
  expect_identical(readLines(dispatch_path, warn = FALSE), "batch_run_parallel")
  expect_match(result$output, "SDM Batch Complete", fixed = TRUE)
  expect_false(grepl("TARGETS_DURABLE_EXECUTION_UNAVAILABLE", result$output, fixed = TRUE))

  unlink(dispatch_path)
  unknown <- run_batch_cli(
    c("--no-targets", "--config", config_path, "--output", output_path, "--unknown-option"),
    cwd = fixture_root,
    env = paste0("SDM_TEST_DISPATCH_PATH=", dispatch_path)
  )
  expect_false(identical(unknown$status, 0L))
  expect_false(file.exists(dispatch_path))
})
