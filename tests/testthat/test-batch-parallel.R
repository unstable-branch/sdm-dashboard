# Tests for batch_run_parallel() and batch runner helpers.

source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "optimized_sdm.R"))

test_that("parse_comma_ints handles comma-separated integers", {
  expect_equal(parse_comma_ints("1,4,6,12,15,18"), c(1L, 4L, 6L, 12L, 15L, 18L))
  expect_equal(parse_comma_ints("1, 4, 6"), c(1L, 4L, 6L))
})

test_that("parse_comma_ints handles single values", {
  expect_equal(parse_comma_ints("7"), 7L)
  expect_equal(parse_comma_ints(" 7 "), 7L)
})

test_that("parse_comma_ints handles empty/NA strings", {
  expect_equal(parse_comma_ints(NULL), integer(0))
  expect_equal(parse_comma_ints(NA), integer(0))
  expect_equal(parse_comma_ints(""), integer(0))
  expect_equal(parse_comma_ints("  "), integer(0))
})

test_that("parse_comma_strings handles comma-separated strings", {
  expect_equal(parse_comma_strings("bdod,cec,soc"), c("bdod", "cec", "soc"))
  expect_equal(parse_comma_strings("ndvi_annual_mean, lai"), c("ndvi_annual_mean", "lai"))
})

test_that("parse_comma_strings handles empty/NA strings", {
  expect_equal(parse_comma_strings(NULL), character(0))
  expect_equal(parse_comma_strings(NA), character(0))
  expect_equal(parse_comma_strings(""), character(0))
})

test_that("parse_logical handles all common representations", {
  expect_true(parse_logical("TRUE"))
  expect_true(parse_logical("true"))
  expect_true(parse_logical("1"))
  expect_true(parse_logical("yes"))
  expect_true(parse_logical("on"))
  expect_true(parse_logical(TRUE))
  expect_false(parse_logical("FALSE"))
  expect_false(parse_logical("false"))
  expect_false(parse_logical("0"))
  expect_false(parse_logical("no"))
  expect_false(parse_logical("off"))
  expect_false(parse_logical(NULL))
  expect_false(parse_logical(NA))
})

test_that("parse_batch_config rejects non-existent files", {
  expect_error(parse_batch_config("/nonexistent/path/config.csv"),
              "Batch config CSV not found")
})

test_that("parse_batch_config rejects empty CSV", {
  tmp <- tempfile(fileext = ".csv")
  write.csv(data.frame(species = character()), tmp, row.names = FALSE)
  expect_error(parse_batch_config(tmp), "empty")
  unlink(tmp)
})

test_that("parse_batch_config parses valid CSV into list of lists", {
  tmp <- tempfile(fileext = ".csv")
  write.csv(data.frame(
    species = c("Acacia mearnsii", "Opuntia stricta"),
    occurrences_csv = c("data/acacia.csv", "data/opuntia.csv"),
    model_id = c("glm", "glm"),
    biovars = c("1,4,6", "1,4,6"),
    stringsAsFactors = FALSE
  ), tmp, row.names = FALSE)

  configs <- parse_batch_config(tmp)
  expect_type(configs, "list")
  expect_length(configs, 2)
  expect_equal(configs[[1]]$species, "Acacia mearnsii")
  expect_equal(configs[[2]]$species, "Opuntia stricta")
  unlink(tmp)
})

test_that("batch_run_parallel rejects empty species_configs", {
  expect_error(batch_run_parallel(list(), n_cores = 1), "non-empty list")
  expect_error(batch_run_parallel(NULL, n_cores = 1), "non-empty list")
})

test_that("batch_run_parallel runs two species with n_cores=1 (sequential)", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping batch parallel test: terra not available")
    return(invisible(NULL))
  }

  tmp_dir <- tempfile()
  dir.create(tmp_dir, recursive = TRUE)

  demo_csv_1 <- file.path(tmp_dir, "sp1_occ.csv")
  demo_csv_2 <- file.path(tmp_dir, "sp2_occ.csv")

  occ_source <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  if (!file.exists(occ_source)) {
    message("Skipping: synthetic demo file not found at ", occ_source)
    return(invisible(NULL))
  }
  occ <- read.csv(occ_source, stringsAsFactors = FALSE)
  write.csv(occ, demo_csv_1, row.names = FALSE)
  write.csv(occ, demo_csv_2, row.names = FALSE)

  configs <- list(
    list(species = "Test species 1", occurrences_csv = demo_csv_1,
         model_id = "glm", biovars = "1,4,12",
         worldclim_dir = normalizePath(file.path(project_root, "Worldclim")),
         cv_folds = "3", aggregation_factor = "4"),
    list(species = "Test species 2", occurrences_csv = demo_csv_2,
         model_id = "glm", biovars = "1,4,12",
         worldclim_dir = normalizePath(file.path(project_root, "Worldclim")),
         cv_folds = "3", aggregation_factor = "4")
  )

  results <- batch_run_parallel(configs, n_cores = 1, output_dir = tmp_dir, seed = 42)

  expect_length(results, 2)
  expect_false(is.null(results[[1]]))
  expect_false(is.null(results[[2]]))
  expect_equal(results[[1]]$config$species, "Test species 1")
  expect_equal(results[[2]]$config$species, "Test species 2")

  rds_1 <- list.files(tmp_dir, pattern = "test_species_1.*\\.rds$", full.names = TRUE)
  rds_2 <- list.files(tmp_dir, pattern = "test_species_2.*\\.rds$", full.names = TRUE)
  expect_length(rds_1, 1)
  expect_length(rds_2, 1)

  unlink(tmp_dir, recursive = TRUE)
})

test_that("batch_run_parallel returns NULL for errored species without crashing batch", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping batch error test: terra not available")
    return(invisible(NULL))
  }

  tmp_dir <- tempfile()
  dir.create(tmp_dir, recursive = TRUE)

  bad_configs <- list(
    list(species = "Bad species", occurrences_csv = "/nonexistent/file.csv",
         model_id = "glm", biovars = "1,4,12")
  )

  results <- batch_run_parallel(bad_configs, n_cores = 1, output_dir = tmp_dir, seed = 42)

  expect_length(results, 1)
  expect_null(results[[1]])

  err_log <- list.files(tmp_dir, pattern = "bad_species.*ERROR\\.log$", full.names = TRUE)
  expect_length(err_log, 1)

  unlink(tmp_dir, recursive = TRUE)
})

test_that("batch_run_parallel saves results with AUC in metadata", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping batch AUC test: terra not available")
    return(invisible(NULL))
  }

  tmp_dir <- tempfile()
  dir.create(tmp_dir, recursive = TRUE)

  occ_source <- file.path(project_root, "data", "examples", "synthetic_presence_data.csv")
  if (!file.exists(occ_source)) {
    message("Skipping: synthetic demo file not found")
    return(invisible(NULL))
  }
  occ <- read.csv(occ_source, stringsAsFactors = FALSE)
  demo_csv <- file.path(tmp_dir, "sp_auc.csv")
  write.csv(occ, demo_csv, row.names = FALSE)

  configs <- list(
    list(species = "AUC test species", occurrences_csv = demo_csv,
         model_id = "glm", biovars = "1,4,12",
         worldclim_dir = normalizePath(file.path(project_root, "Worldclim")),
         cv_folds = "3", aggregation_factor = "4")
  )

  results <- batch_run_parallel(configs, n_cores = 1, output_dir = tmp_dir, seed = 99)
  expect_false(is.null(results[[1]]))
  expect_true(is.numeric(results[[1]]$metrics$auc_mean))

  unlink(tmp_dir, recursive = TRUE)
})
