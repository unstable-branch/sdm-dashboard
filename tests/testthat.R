if (requireNamespace("testthat", quietly = TRUE)) {
  library(testthat)
  test_dir(file.path("tests", "testthat"), reporter = "summary")
} else {
  passed <- 0L
  failed <- 0L
  skipped <- 0L

  test_that <- function(desc, code) {
    tryCatch({
      force(code)
      passed <<- passed + 1L
      message("ok - ", desc)
    }, skip = function(e) {
      skipped <<- skipped + 1L
      message("skip - ", desc, ": ", conditionMessage(e))
    }, error = function(e) {
      failed <<- failed + 1L
      message("not ok - ", desc, ": ", conditionMessage(e))
    })
  }

  skip_if_not_installed <- function(pkg) {
    if (!requireNamespace(pkg, quietly = TRUE)) {
      structure(
        list(message = paste0("package '", pkg, "' is not installed"), call = NULL),
        class = c("skip", "condition")
      ) |> stop()
    }
    invisible(TRUE)
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
  expect_silent <- function(object) {
    warnings <- character()
    value <- withCallingHandlers(
      force(object),
      warning = function(w) {
        warnings <<- c(warnings, conditionMessage(w))
        invokeRestart("muffleWarning")
      }
    )
    if (length(warnings) > 0) stop("Expected no warnings: ", paste(warnings, collapse = "; "), call. = FALSE)
    invisible(value)
  }

  source(file.path("tests", "testthat", "helper-load.R"))
  for (path in list.files(file.path("tests", "testthat"), pattern = "^test-.*\\.R$", full.names = TRUE)) source(path)
  message("Tests complete: ", passed, " passed, ", skipped, " skipped, ", failed, " failed")
  if (failed > 0L) quit(save = "no", status = 1)
}
