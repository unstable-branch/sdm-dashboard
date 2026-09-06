# Tests for the multi-species targets config JSON parse fix.
#
# Before this fix, handle_targets_run used jsonlite::fromJSON(req$postBody)
# with the default simplifyVector=TRUE. For a JSON body like:
#   {"configs": [{"species": "sp1", "modelId": "glm", ...}, {"species": "sp2", ...}]}
# jsonlite converts the "configs" array to a data.frame (NOT a list of lists).
# Then body$configs[[i]] returns the ith *column* of that data.frame, not the
# ith config object. Accessing cfg$model_id on a column vector returns all model
# IDs, so every config ends up with model_id = c("glm","rf",...), all fields
# collapsed, and normalize_targets_config receives a degenerate config that produces
# an empty row in config.csv. The targets pipeline then fails with "No occurrence
# file found".
#
# The fix: jsonlite::fromJSON(..., simplifyVector=FALSE) so that the configs
# array is parsed as a list of lists, and body$configs[[i]] returns the ith
# config as a proper named list that normalize_targets_config can digest.

# Source helpers in the same way as other plumber helper tests.
root <- normalizePath(file.path("..", ".."), winslash = "/")
if (!exists("normalize_targets_config")) {
  source(file.path(root, "R", "core", "model_payload_normalizer.R"), local = FALSE)
  source(file.path(root, "plumber", "R", "helpers", "models_helpers.R"), local = FALSE)
}
if (!exists("jsonlite")) library(jsonlite)

test_that("fromJSON simplifyVector=FALSE produces list-of-lists from configs array", {
  body <- fromJSON('{"configs": [{"species": "sp1", "modelId": "glm"}, {"species": "sp2", "modelId": "rf"}]}',
                   simplifyVector = FALSE)
  expect_type(body$configs, "list")
  expect_equal(length(body$configs), 2)
  expect_equal(body$configs[[1]]$species, "sp1")
  expect_equal(body$configs[[2]]$species, "sp2")
  expect_equal(body$configs[[1]]$modelId, "glm")
  expect_equal(body$configs[[2]]$modelId, "rf")
})

test_that("fromJSON default simplifyVector=TRUE produces data.frame (the old broken behaviour)", {
  body <- fromJSON('{"configs": [{"species": "sp1", "modelId": "glm"}, {"species": "sp2", "modelId": "rf"}]}',
                   simplifyVector = TRUE)
  expect_s3_class(body$configs, "data.frame")
  expect_equal(ncol(body$configs), 2)
  # body$configs[[1]] on a data.frame returns column 1 with no useful names
  # (row names become element names but are empty strings for default rownames)
  # This is the BUG: it gives us all species names as a named vector, not the first config
  expect_equal(unname(body$configs[[1]]), c("sp1", "sp2"))
})

test_that("normalize_targets_config accepts a list-of-lists config", {
  # This is what the fixed parse produces for one config
  # Note: biovars is excluded — the actual JSON body sends biovars as
  # "1,4,6,12,15,18" (comma-separated string), which normalize_targets_config
  # stores via the comma_ints path. Here we just test core field handling.
  cfg_list <- list(
    species = "Aquila chrysaetos",
    modelId = "glm",
    occurrenceFile = "/app/data/uploads/test_occ.csv",
    cleanedFileId = "test-clean-id",
    cvFolds = 5L,
    backgroundN = 3000L
  )
  result <- normalize_targets_config(cfg_list)
  expect_equal(result$species, "Aquila chrysaetos")
  expect_equal(result$model_id, "glm")
  # cv_folds is stored as comma-separated ints, so character "5"
  expect_equal(result$cv_folds, "5")
  expect_match(result$background_n, "3000")
})

test_that("normalize_targets_config fails gracefully when occurrence file is missing from list", {
  cfg_list <- list(
    species = "Test species",
    modelId = "glm"
    # no occurrenceFile, no cleanedFileId, no occurrence_file
  )
  expect_error(normalize_targets_config(cfg_list),
               "No occurrence file found",
               perl = TRUE)
})

test_that("vapply over configs list works when each config is a list", {
  configs <- list(
    list(species = "sp1", modelId = "glm", occurrenceFile = "/a.csv"),
    list(species = "sp2", modelId = "rf",  occurrenceFile = "/b.csv")
  )
  # This is exactly what handle_targets_run does at line 531-537
  backends <- vapply(configs, function(c) {
    mid <- c$model_id %||% c[["modelId"]] %||% "glm"
  }, character(1))
  expect_equal(backends, c("glm", "rf"))
})
