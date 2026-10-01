test_that("batch CLI fails closed before optional parser or Targets dispatch", {
  script <- normalizePath(
    testthat::test_path("..", "..", "scripts", "batch_run.R"),
    mustWork = TRUE
  )
  output_path <- tempfile("batch-cli-output-")
  on.exit(unlink(output_path), add = TRUE)

  status <- system2(
    file.path(R.home("bin"), "Rscript"),
    c("--vanilla", shQuote(script), "--help"),
    stdout = output_path,
    stderr = output_path
  )
  output <- paste(readLines(output_path, warn = FALSE), collapse = "\n")
  script_lines <- readLines(script, warn = FALSE)
  first_expression <- script_lines[grepl("^[[:space:]]*[^#[:space:]]", script_lines)][1]

  expect_identical(trimws(first_expression), "stop(")
  expect_false(is.null(status))
  expect_false(identical(status, 0L))
  expect_match(output, "TARGETS_DURABLE_EXECUTION_UNAVAILABLE", fixed = TRUE)
  expect_match(output, "unavailable", fixed = TRUE)
  expect_false(grepl("Usage:", output, fixed = TRUE))
  expect_false(grepl("there is no package called", output, fixed = TRUE))
})
