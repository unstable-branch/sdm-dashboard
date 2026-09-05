# tests/testthat/test-suitability-value-serializer.R
#
# Regression test: handle_suitability_value must serialise to non-empty JSON.
#
# Before the fix (removing @serializer contentType list(type="application/json")
# from the /api/v1/results/suitability-value route in plumber.R), the route
# annotation overrode the global serializer and produced an identity serializer
# that passed the R list body (list(value = 0.7)) directly to httpuv's C++
# layer, which threw "An exception occurred." (VECSXP cannot be cast to RawVector).
#
# The fix removes that annotation so the global
# plumber::serializer_json(auto_unbox = TRUE, na = "null") handles the response,
# correctly encoding list(value = x) as {"value":x} in JSON.
#
# This test verifies the handler output is a list that serialises to
# non-empty JSON with a "value" key, using the same auto_unbox/na options
# as the global serializer.
#
# Related: rstudio/plumber#1022

test_that("handle_suitability_value output serialises to non-empty JSON with value key", {
  skip_if_not_installed("jsonlite")
  skip_if_not_installed("terra")

  project_root <- normalizePath(file.path(
    normalizePath(dirname(testthat::test_path("test-suitability-value-serializer.R")), winslash = "/"),
    "..", ".."
  ), winslash = "/", mustWork = TRUE)

  # Build an in-memory 3x3 raster with known values (row-major order)
  r <- terra::rast(nrows = 3, ncols = 3,
                   xmin = 140, xmax = 141,
                   ymin = -24, ymax = -23,
                   crs = "EPSG:4326")
  terra::values(r) <- c(0.1, 0.2, 0.3,
                        0.4, 0.5, 0.6,
                        0.7, 0.8, 0.9)

  tmp_file <- tempfile(fileext = ".tif")
  terra::writeRaster(r, tmp_file, overwrite = TRUE)

  # Source into child env first (loads the real sdm_get_raster_path etc.),
  # then OVERWRITE the specific functions we need to stub
  env <- new.env(parent = .GlobalEnv)
  source(file.path(project_root, "plumber/R/helpers/output_helpers.R"), local = env)
  env$sdm_verify_run_owner <- function(req, res, run_id, app_dir) NULL
  env$sdm_get_raster_path <- function(run_id, app_dir) tmp_file
  env$sdm_safe_job_dir <- function(run_id) tempfile()

  mock_req <- list(user_id = "test-user")
  mock_res <- list(status = 200L)

  # Extract at centre point (lng=140.5, lat=-23.5) — should give 0.5
  result <- env$handle_suitability_value(mock_req, mock_res,
                                          run_id = "test-run",
                                          lat = "-23.5", lng = "140.5",
                                          band = NULL,
                                          app_dir = project_root)

  # Serialise using the same options as the global serializer in run_server.R
  json_chr <- jsonlite::toJSON(result, auto_unbox = TRUE, POSIXt = "ISO8601", na = "null")

  expect_false(identical(json_chr, "{}"),
    info = "handle_suitability_value must serialise to non-empty JSON (regression for @serializer contentType override)")
  expect_true(grepl("\"value\"", json_chr, fixed = TRUE),
    info = "JSON output must contain a 'value' key")

  parsed <- jsonlite::fromJSON(json_chr, simplifyVector = FALSE)
  expect_type(parsed$value, "double")
  expect_equal(parsed$value, 0.5)

  unlink(tmp_file, force = TRUE)
})

test_that("handle_suitability_value returns NA_real_ for out-of-raster coordinates", {
  skip_if_not_installed("jsonlite")
  skip_if_not_installed("terra")

  project_root <- normalizePath(file.path(
    normalizePath(dirname(testthat::test_path("test-suitability-value-serializer.R")), winslash = "/"),
    "..", ".."
  ), winslash = "/", mustWork = TRUE)

  tmp_file <- tempfile(fileext = ".tif")
  r <- terra::rast(nrows = 3, ncols = 3,
                   xmin = 140, xmax = 141,
                   ymin = -24, ymax = -23,
                   crs = "EPSG:4326")
  terra::values(r) <- seq(0.1, 0.9, length.out = 9)
  terra::writeRaster(r, tmp_file, overwrite = TRUE)

  env <- new.env(parent = .GlobalEnv)
  source(file.path(project_root, "plumber/R/helpers/output_helpers.R"), local = env)
  env$sdm_verify_run_owner <- function(req, res, run_id, app_dir) NULL
  env$sdm_get_raster_path <- function(run_id, app_dir) tmp_file
  env$sdm_safe_job_dir <- function(run_id) tempfile()

  mock_req <- list(user_id = "test-user")
  mock_res <- list(status = 200L)

  # Point with valid coords but outside raster extent (raster is 140-141 lon, -24 to -23 lat)
  result <- env$handle_suitability_value(mock_req, mock_res,
                                          run_id = "test-run",
                                          lat = "-30", lng = "150",
                                          band = NULL,
                                          app_dir = project_root)

  json_chr <- jsonlite::toJSON(result, auto_unbox = TRUE, POSIXt = "ISO8601", na = "null")

  expect_false(identical(json_chr, "{}"),
    info = "NA_real_ result must still produce non-empty JSON")
  expect_true(grepl("\"value\"", json_chr, fixed = TRUE),
    info = "JSON must contain 'value' key even for NA result")

  parsed <- jsonlite::fromJSON(json_chr, simplifyVector = FALSE)
  expect_true(is.null(parsed$value),
    info = "Out-of-raster point should return JSON null (from NA_real_)")

  unlink(tmp_file, force = TRUE)
})
