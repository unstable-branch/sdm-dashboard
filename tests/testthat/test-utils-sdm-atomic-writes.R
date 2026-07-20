source(file.path(project_root, "R", "core", "bootstrap.R"))

test_that("sdm_atomic_write_lines writes correct content", {
  tmp <- tempfile(pattern = "sdm_atomic_test_")
  on.exit(unlink(tmp, force = TRUE))

  sdm_atomic_write_lines(c("line1", "line2", "line3"), tmp)
  expect_true(file.exists(tmp))
  expect_equal(readLines(tmp), c("line1", "line2", "line3"))
})

test_that("sdm_atomic_write_lines handles empty input", {
  tmp <- tempfile(pattern = "sdm_atomic_test_")
  on.exit(unlink(tmp, force = TRUE))

  sdm_atomic_write_lines(character(0), tmp)
  expect_true(file.exists(tmp))
  expect_equal(readLines(tmp), character(0))
})

test_that("sdm_atomic_write_lines overwrites existing file", {
  tmp <- tempfile(pattern = "sdm_atomic_test_")
  on.exit(unlink(tmp, force = TRUE))

  writeLines("old content", tmp)
  sdm_atomic_write_lines("new content", tmp)
  expect_equal(readLines(tmp), "new content")
})

test_that("sdm_atomic_write_lines removes tmp file after rename", {
  tmp <- tempfile(pattern = "sdm_atomic_test_")
  on.exit(unlink(tmp, force = TRUE))

  sdm_atomic_write_lines("content", tmp)
  tmpfiles <- list.files(dirname(tmp), pattern = basename(tmp), full.names = TRUE)
  expect_equal(tmpfiles, character(0))
})

test_that("sdm_atomic_saveRDS writes correct object", {
  tmp <- tempfile(pattern = "sdm_atomic_test_", fileext = ".rds")
  on.exit(unlink(tmp, force = TRUE))

  obj <- list(foo = 1:10, bar = letters[1:5], baz = TRUE)
  sdm_atomic_saveRDS(obj, tmp)
  expect_true(file.exists(tmp))
  loaded <- readRDS(tmp)
  expect_equal(loaded, obj)
})

test_that("sdm_atomic_saveRDS overwrites existing file", {
  tmp <- tempfile(pattern = "sdm_atomic_test_", fileext = ".rds")
  on.exit(unlink(tmp, force = TRUE))

  saveRDS(list(old = TRUE), tmp)
  sdm_atomic_saveRDS(list(new = FALSE), tmp)
  loaded <- readRDS(tmp)
  expect_equal(loaded, list(new = FALSE))
})

test_that("sdm_atomic_saveRDS handles complex R objects", {
  tmp <- tempfile(pattern = "sdm_atomic_test_", fileext = ".rds")
  on.exit(unlink(tmp, force = TRUE))

  env <- new.env()
  env$x <- seq(0.1, 0.9, by = 0.1)
  env$df <- data.frame(a = 1:5, b = letters[1:5], stringsAsFactors = FALSE)
  env$fun <- function(a, b) a + b
  class(env) <- "custom_class"

  sdm_atomic_saveRDS(env, tmp)
  loaded <- readRDS(tmp)
  expect_equal(loaded$x, env$x)
  expect_equal(loaded$df, env$df)
  expect_equal(loaded$fun(2, 3), 5)
  expect_equal(class(loaded), class(env))
})

test_that("sdm_atomic_saveRDS removes tmp file after rename", {
  tmp <- tempfile(pattern = "sdm_atomic_test_", fileext = ".rds")
  on.exit(unlink(tmp, force = TRUE))

  sdm_atomic_saveRDS(list(a = 1), tmp)
  tmpdir <- dirname(tmp)
  tmpbase <- basename(tmp)
  tmpfiles <- list.files(tmpdir, pattern = paste0("^", tmpbase, "\\.tmp\\."), full.names = TRUE)
  expect_equal(tmpfiles, character(0))
})

test_that("sdm_atomic_write_lines returns invisibly NULL", {
  tmp <- tempfile(pattern = "sdm_atomic_test_")
  on.exit(unlink(tmp, force = TRUE))

  result <- sdm_atomic_write_lines("test", tmp)
  expect_null(result)
})

test_that("sdm_atomic_saveRDS returns invisibly NULL", {
  tmp <- tempfile(pattern = "sdm_atomic_test_", fileext = ".rds")
  on.exit(unlink(tmp, force = TRUE))

  result <- sdm_atomic_saveRDS(list(a = 1), tmp)
  expect_null(result)
})
