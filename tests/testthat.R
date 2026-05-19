if (requireNamespace("testthat", quietly = TRUE)) {
  library(testthat)
  test_dir(file.path("tests", "testthat"), reporter = "summary")
} else {
  passed <- 0L
  failed <- 0L

  test_that <- function(desc, code) {
    tryCatch({
      force(code)
      passed <<- passed + 1L
      message("ok - ", desc)
    }, error = function(e) {
      failed <<- failed + 1L
      message("not ok - ", desc, ": ", conditionMessage(e))
    })
  }
  expect_equal <- function(object, expected) {
    if (!isTRUE(all.equal(object, expected))) stop("Expected equality.", call. = FALSE)
  }
  expect_error <- function(object, regexp = NULL) {
    err <- tryCatch({ force(object); NULL }, error = function(e) e)
    if (is.null(err)) stop("Expected an error.", call. = FALSE)
    if (!is.null(regexp) && !grepl(regexp, conditionMessage(err))) stop("Error did not match: ", regexp, call. = FALSE)
  }
  expect_true <- function(object) if (!isTRUE(object)) stop("Expected TRUE.", call. = FALSE)
  expect_false <- function(object) if (!isFALSE(object)) stop("Expected FALSE.", call. = FALSE)
  expect_null <- function(object) if (!is.null(object)) stop("Expected NULL.", call. = FALSE)
  expect_type <- function(object, type) if (typeof(object) != type) stop("Expected type ", type, " got ", typeof(object), ".", call. = FALSE)
  expect_s3_class <- function(object, class) if (!inherits(object, class)) stop("Expected class ", class, ".", call. = FALSE)
  expect_length <- function(object, n) if (length(object) != n) stop("Expected length ", n, " got ", length(object), ".", call. = FALSE)
  expect_identical <- function(object, expected) if (!identical(object, expected)) stop("Expected identical.", call. = FALSE)
  expect_warning <- function(object, regexp = NULL) {
    w <- character(0)
    tryCatch(withCallingHandlers(force(object), warning = function(e) { w <<- c(w, conditionMessage(e)); invokeRestart("muffleWarning") }), error = function(e) NULL)
    if (length(w) == 0) stop("Expected a warning.", call. = FALSE)
    if (!is.null(regexp) && !any(grepl(regexp, w))) stop("Warning did not match: ", regexp, call. = FALSE)
  }
  skip_if_not_installed <- function(pkg) if (!requireNamespace(pkg, quietly = TRUE)) stop("Skipped: ", pkg, " not installed.", call. = FALSE)
  skip_if_not <- function(cond, msg = "") if (!isTRUE(cond)) stop("Skipped: ", msg, call. = FALSE)

  source(file.path("tests", "testthat", "helper-load.R"))
  for (path in list.files(file.path("tests", "testthat"), pattern = "^test-.*\\.R$", full.names = TRUE)) source(path)
  message("Tests complete: ", passed, " passed, ", failed, " failed")
  if (failed > 0L) quit(save = "no", status = 1)
}
