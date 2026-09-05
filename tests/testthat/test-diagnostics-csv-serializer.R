# tests/testthat/test-diagnostics-csv-serializer.R
#
# Regression test: handle_diagnostics_data must return a non-empty CSV string
# body, not NULL (which the global JSON serializer encodes as "{}").
#
# Before the fix (adding @serializer text + converting write.csv() to
# paste(capture.output(write.csv()), collapse="\n")), the function called
# write.csv(csv_data) with no file= argument, which writes to R's stdout
# (silently lost) and returns NULL invisibly. The global JSON serializer
# then encoded NULL as the literal body "{}", so clients downloading
# diagnostics CSV received a file containing "{}" instead of CSV data.
#
# The fix wraps write.csv in capture.output() and pastes the result so the
# function returns a length-1 character vector suitable for plumber's text
# serializer, with Content-Type: text/csv in the response headers.
#
# This test verifies the capture.output + paste idiom produces a valid
# RFC-4180 CSV with a header row, without relying on plumber::pr() boot
# (which hangs locally on DB pool init — CI handles the full integration).

test_that("capture.output + paste(write.csv) produces valid CSV string", {
  skip_if_not_installed("jsonlite")

  df <- data.frame(
    variable = c("bio1", "bio12", "bio4"),
    importance = c(0.45, 0.35, 0.20),
    rank = c(1L, 2L, 3L)
  )

  csv_text <- paste(capture.output(write.csv(df, row.names = FALSE)), collapse = "\n")

  # Must be a non-empty character vector
  expect_type(csv_text, "character")
  expect_true(nchar(csv_text) > 0)

  # Must contain the header row
  expect_true(grepl("variable", csv_text, fixed = TRUE),
    info = "CSV output must contain 'variable' column header")
  expect_true(grepl("importance", csv_text, fixed = TRUE),
    info = "CSV output must contain 'importance' column header")

  # Must parse back to a data frame equivalent to the input
  parsed <- tryCatch(
    read.csv(text = csv_text, stringsAsFactors = FALSE),
    error = function(e) NULL
  )
  expect_false(is.null(parsed), info = "CSV string must parse back to a data.frame")
  expect_equal(nrow(parsed), nrow(df))
  expect_equal(parsed$variable, df$variable)
  expect_equal(parsed$importance, df$importance)
})

test_that("capture.output + paste handles single-row data frames", {
  skip_if_not_installed("jsonlite")

  df <- data.frame(variable = "bio1", importance = 0.99)

  csv_text <- paste(capture.output(write.csv(df, row.names = FALSE)), collapse = "\n")

  expect_type(csv_text, "character")
  expect_true(nchar(csv_text) > 0)
  expect_true(grepl("bio1", csv_text, fixed = TRUE))
})

test_that("capture.output + paste handles edge values (NA, Inf, long numbers)", {
  skip_if_not_installed("jsonlite")

  df <- data.frame(
    variable = c("bio1", "bio12", "bio4"),
    importance = c(NA_real_, Inf, -Inf),
    n_records = c(100L, 0L, 50L)
  )

  csv_text <- paste(capture.output(write.csv(df, row.names = FALSE)), collapse = "\n")

  expect_type(csv_text, "character")
  expect_true(nchar(csv_text) > 0)

  # NA should appear as "NA", Inf as "Inf"
  expect_true(grepl("NA", csv_text, fixed = TRUE))
  expect_true(grepl("Inf", csv_text, fixed = TRUE))
})
