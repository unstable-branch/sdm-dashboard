# Tests for reproducible R script export roundtrip.
# helper-load.R and helper-fixtures.R are auto-sourced by testthat.

test_that("export_run_script produces a parseable R script", {
  mock_result <- list(
    config = list(
      species = "Test species",
      occurrence_file = "data/test.csv",
      worldclim_dir = "Worldclim",
      selected_biovars = c(1, 4, 12),
      projection_extent = c(140, 142, -24, -22),
      background_n = 100,
      cv_folds = 3,
      n_cores = 1,
      seed = 42,
      model_id = "glm",
      threshold = 0.5
    ),
    model_id = "glm",
    cv = list(auc_mean = 0.75, tss_mean = 0.45),
    paths = list(tif = "outputs/test_suitability.tif", png = "outputs/test_map.png"),
    summary = list(mean = 0.3, max = 0.9)
  )

  out_path <- tempfile(fileext = ".R")
  export_run_script(mock_result, path = out_path, include_comments = TRUE)
  expect_true(file.exists(out_path))

  parsed <- tryCatch(parse(out_path), error = function(e) NULL)
  expect_false(is.null(parsed), "Exported script should be valid R code")

  content <- readLines(out_path, warn = FALSE)
  expect_true(any(grepl("Test species", content)))
  expect_true(any(grepl("glm", content)))
})

test_that("export_run_script handles minimal result", {
  mock_result <- list(
    config = list(species = "Min", occurrence_file = "x.csv", worldclim_dir = "W",
                  selected_biovars = 1, projection_extent = c(140, 142, -24, -22),
                  background_n = 100, cv_folds = 3, n_cores = 1, seed = 42,
                  model_id = "glm", threshold = 0.5),
    model_id = "glm",
    cv = list(auc_mean = 0.7),
    paths = list(tif = "out.tif"),
    summary = list(mean = 0.3)
  )

  out_path <- tempfile(fileext = ".R")
  export_run_script(mock_result, path = out_path, include_comments = FALSE)
  expect_true(file.exists(out_path))

  parsed <- tryCatch(parse(out_path), error = function(e) NULL)
  expect_false(is.null(parsed))
})
