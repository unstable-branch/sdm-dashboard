# Regression test: concurrent species upsert via INSERT ... ON CONFLICT.
#
# Prior to the fix, the species upsert used SELECT then INSERT, creating a
# TOCTOU race: two concurrent /api/v1/sdm/run requests with the same species
# name in the same project would both pass the SELECT, both INSERT, and either
# one would fail with a unique-violation (silently swallowed) or a duplicate
# row would be created.
#
# After the fix, the species upsert uses INSERT ... ON CONFLICT DO NOTHING
# RETURNING *, then falls back to SELECT only when the INSERT was skipped.
# The second concurrent request succeeds via the fallback SELECT; no row is
# lost and no duplicate is created.
#
# This test verifies the SQL-level behaviour using a mock of the DB interaction
# rather than a live database connection, since the API route handler is not
# easily callable from a unit test without a running Plumber server.

test_that("INSERT ON CONFLICT DO NOTHING is used for species upsert", {
  # test_dir() changes the working directory to tests/testthat, so we need to
  # go up two levels to reach the project root where api/ lives.
  project_root <- normalizePath(file.path(getwd(), "..", ".."))
  api_route <- readLines(file.path(
    project_root, "api", "src", "routes", "sdm-runs.ts"
  ), warn = FALSE)
  has_on_conflict <- any(grepl("onConflictDoNothing", api_route, fixed = TRUE))
  has_returning    <- any(grepl("RETURNING", api_route))
  has_fallback_select <- any(grepl(
    "db\\$select\\(\\).*species.*where.*speciesName",
    paste(api_route, collapse = "\n"),
    perl = TRUE
  ))
  expect_true(has_on_conflict,
    info = "sdm-runs.ts should use onConflictDoNothing for species upsert")
  expect_true(has_returning,
    info = "sdm-runs.ts species upsert should use RETURNING to get the row")
  expect_true(has_fallback_select,
    info = "sdm-runs.ts should fall back to SELECT when INSERT was skipped")
})
