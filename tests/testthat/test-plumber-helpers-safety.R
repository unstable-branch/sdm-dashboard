# Load the helper module. We need to source it into a context where
# `<<-` can resolve its enclosing scope. Sourcing into globalenv() lets
# `<<-` succeed (the helpers themselves use plain assignment, so they
# stay scoped to globalenv() but that's fine for this test).
e <- new.env(parent = globalenv())
source(testthat::test_path("../../plumber/R/helpers/plumber_helpers.R"), local = e)
sdm_read_meta_json <- e$sdm_read_meta_json
sdm_read_progress_lines <- e$sdm_read_progress_lines

test_that("sdm_read_meta_json returns the parsed list for a valid file", {
  tmp <- tempfile("sdm-meta-")
  dir.create(tmp)
  path <- file.path(tmp, "meta.json")
  writeLines('{"status":"completed","id":"run-1"}', path)

  meta <- sdm_read_meta_json(path)
  expect_equal(meta$status, "completed")
  expect_equal(meta$id, "run-1")
})

test_that("sdm_read_meta_json returns the default for a missing file", {
  meta <- sdm_read_meta_json(tempfile(fileext = ".json"))
  expect_null(meta)

  meta2 <- sdm_read_meta_json(tempfile(fileext = ".json"), default = list(fallback = TRUE))
  expect_equal(meta2$fallback, TRUE)
})

test_that("sdm_read_meta_json returns the default on partial-write / corrupt JSON", {
  tmp <- tempfile("sdm-meta-")
  dir.create(tmp)
  path <- file.path(tmp, "meta.json")
  # Simulate a partial write: only an opening brace
  writeLines("{ \"status\": \"run", path)

  meta <- sdm_read_meta_json(path)
  expect_null(meta)

  meta2 <- sdm_read_meta_json(path, default = list(fallback = "ok"))
  expect_equal(meta2$fallback, "ok")
})

test_that("sdm_read_progress_lines returns the last N lines", {
  tmp <- tempfile("sdm-progress-")
  dir.create(tmp)
  path <- file.path(tmp, "progress.log")
  writeLines(c("line1", "line2", "line3", "line4", "line5"), path)

  lines <- sdm_read_progress_lines(path, n = 3)
  expect_equal(lines, c("line3", "line4", "line5"))
})

test_that("sdm_read_progress_lines returns default for missing file", {
  lines <- sdm_read_progress_lines(tempfile(fileext = ".log"), n = 5)
  expect_equal(lines, character())

  lines2 <- sdm_read_progress_lines(
    tempfile(fileext = ".log"),
    n = 5,
    default = c("fallback-line")
  )
  expect_equal(lines2, c("fallback-line"))
})
