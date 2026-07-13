test_that("write_odmap_report creates CSV output", {
  mock_result <- list(
    model = list(),
    model_id = "glm",
    model_label = "GLM / Logistic regression",
    model_method = "Fast presence/background GLM with balanced class weights",
    occurrence = data.frame(longitude = 1:100, latitude = 1:100),
    occurrence_used = data.frame(longitude = 1:80, latitude = 1:80),
    cv = list(strategy = "random", k = 3, auc_mean = 0.85, auc_sd = 0.05,
              tss_mean = 0.6, tss_sd = 0.1, sensitivity_mean = 0.7, specificity_mean = 0.9),
    binary_metrics = list(auc = 0.85),
    metrics = list(auc = 0.85, tss = 0.6, cbi = 0.72),
    covariates = c("BIO1", "BIO4", "BIO12"),
    config = list(species = "TestSpecies", projection_extent = c(112, 154, -44, -10))
  )

  temp_csv <- tempfile(fileext = ".csv")
  expect_silent(write_odmap_report(mock_result, temp_csv))
  expect_true(file.exists(temp_csv))

  lines <- readLines(temp_csv)
  expect_true(any(grepl("^# Overview", lines)))
  expect_true(any(grepl("^# Data", lines)))
  expect_true(any(grepl("^# Model", lines)))
  expect_true(any(grepl("^# Assessment", lines)))
  expect_true(any(grepl("^# Prediction", lines)))
})

test_that("write_odmap_report creates Markdown output", {
  mock_result <- list(
    model = list(),
    model_id = "glm",
    model_label = "GLM / Logistic regression",
    model_method = "Fast presence/background GLM with balanced class weights",
    occurrence = data.frame(longitude = 1:50, latitude = 1:50),
    occurrence_used = data.frame(longitude = 1:40, latitude = 1:40),
    cv = list(strategy = "random", k = 3, auc_mean = 0.85, auc_sd = 0.05,
              tss_mean = 0.6, tss_sd = 0.1, sensitivity_mean = 0.7, specificity_mean = 0.9),
    metrics = list(auc = 0.85, cbi = 0.72),
    covariates = c("BIO1", "BIO12"),
    config = list(species = "TestSpecies")
  )

  temp_md <- tempfile(fileext = ".md")
  temp_csv <- tempfile(fileext = ".csv")
  expect_silent(write_odmap_report(mock_result, temp_csv, temp_md))
  expect_true(file.exists(temp_md))

  lines <- readLines(temp_md)
  expect_true(any(grepl("^# ODMAP Report", lines)))
  expect_true(any(grepl("^## Overview", lines)))
  expect_true(any(grepl("^## Assessment", lines)))
})

test_that("write_odmap_report handles missing fields gracefully", {
  minimal_result <- list(
    model = list(),
    model_id = "glm",
    occurrence = data.frame(a = 1),
    occurrence_used = data.frame(a = 1)
  )

  temp_csv <- tempfile(fileext = ".csv")
  expect_silent(write_odmap_report(minimal_result, temp_csv))
  expect_true(file.exists(temp_csv))
  expect_false(any(grepl("Error", readLines(temp_csv))))
})

test_that("write_odmap_report includes CBI when available", {
  result_with_cbi <- list(
    model = list(),
    model_id = "glm",
    model_label = "GLM",
    model_method = "test",
    occurrence = data.frame(longitude = 1:100, latitude = 1:100),
    occurrence_used = data.frame(longitude = 1:80, latitude = 1:80),
    cv = list(strategy = "random", k = 3, auc_mean = 0.85, auc_sd = 0.05,
              tss_mean = 0.6, tss_sd = 0.1, sensitivity_mean = 0.7, specificity_mean = 0.9),
    metrics = list(cbi = 0.72),
    covariates = c("BIO1"),
    config = list(species = "Test")
  )

  temp_csv <- tempfile(fileext = ".csv")
  write_odmap_report(result_with_cbi, temp_csv)
  lines <- readLines(temp_csv)
  cbi_line <- lines[grepl("Boyce_index", lines)]
  expect_true(grepl("0.72", cbi_line))
})

test_that("write_odmap_report reports configured native climate resolution", {
  result <- list(
    model = list(),
    model_id = "glm",
    occurrence = data.frame(longitude = 1:2, latitude = 1:2),
    occurrence_used = data.frame(longitude = 1:2, latitude = 1:2),
    config = list(
      species = "TestSpecies",
      worldclim_res = 10,
      aggregation_factor = 1,
      projection_extent = c(112, 154, -44, -10)
    )
  )

  temp_csv <- tempfile(fileext = ".csv")
  write_odmap_report(result, temp_csv)
  resolution_line <- readLines(temp_csv)[grepl("^spatial_resolution,", readLines(temp_csv))]
  expect_equal(resolution_line, "spatial_resolution,10 arc-min")
})
