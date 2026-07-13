# Tests for write_batch_summary_csv()

make_mock_result <- function(species, auc = 0.85, tss = 0.45, cbi = 0.62,
                              area = 15000, eoo = 50000, aoo = 500,
                              elapsed = 45.2, threshold = 0.5,
                              model_id = "glm", cv_strategy = "spatial_blocks") {
  list(
    config = list(species = species, model_id = model_id, threshold = threshold),
    cv = list(auc_mean = auc, tss_mean = tss, strategy = cv_strategy),
    metrics = list(cbi = cbi, presence_records = 20L, elapsed_seconds = elapsed),
    summary = list(high_risk_area_km2 = area),
    eoo_aoo = list(eoo_km2 = eoo, aoo_km2 = aoo)
  )
}

test_that("write_batch_summary_csv writes correct columns for all-success", {
  tmp <- tempfile()
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE))

  results <- list(
    make_mock_result("Species A"),
    make_mock_result("Species B"),
    make_mock_result("Species C", auc = 0.78, tss = 0.40)
  )
  write_batch_summary_csv(results, tmp)
  csv_path <- file.path(tmp, "batch_summary.csv")
  expect_true(file.exists(csv_path))

  df <- read.csv(csv_path, stringsAsFactors = FALSE)
  expect_equal(nrow(df), 3)
  expect_equal(df$species, c("Species A", "Species B", "Species C"))
  expect_equal(df$status, rep("success", 3))
  expect_equal(df$auc_mean, c(0.85, 0.85, 0.78))
  expect_equal(df$tss_mean, c(0.45, 0.45, 0.40))
  expect_equal(df$cbi, c(0.62, 0.62, 0.62))
  expect_equal(df$eoo_km2, c(50000, 50000, 50000))
  expect_equal(df$aoo_km2, c(500, 500, 500))
  expect_equal(df$threshold, c(0.5, 0.5, 0.5))

  expected_cols <- c("species", "status", "model_id", "auc_mean", "tss_mean",
    "cbi", "high_suit_area_km2", "eoo_km2", "aoo_km2", "threshold",
    "cv_strategy", "elapsed_seconds")
  expect_true(all(expected_cols %in% names(df)))
})

test_that("write_batch_summary_csv handles mixed success / failure", {
  tmp <- tempfile()
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE))

  results <- list(
    make_mock_result("Species A"),
    NULL,
    make_mock_result("Species C", auc = 0.88)
  )
  write_batch_summary_csv(results, tmp)
  df <- read.csv(file.path(tmp, "batch_summary.csv"), stringsAsFactors = FALSE)

  expect_equal(nrow(df), 3)
  expect_equal(df$status, c("success", "error", "success"))
  expect_equal(df$species[2], NA_character_)
  expect_true(is.na(df$auc_mean[2]))
  expect_true(is.na(df$eoo_km2[2]))
})

test_that("write_batch_summary_csv handles all failures", {
  tmp <- tempfile()
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE))

  results <- list(NULL, NULL, NULL)
  write_batch_summary_csv(results, tmp)
  df <- read.csv(file.path(tmp, "batch_summary.csv"), stringsAsFactors = FALSE)

  expect_equal(nrow(df), 3)
  expect_equal(df$status, rep("error", 3))
  expect_true(all(is.na(df$auc_mean)))
})

test_that("write_batch_summary_csv handles empty list", {
  tmp <- tempfile()
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE))

  expect_error(write_batch_summary_csv(list(), tmp), NA)
  csv_path <- file.path(tmp, "batch_summary.csv")
  expect_true(file.exists(csv_path))
  expect_gt(file.size(csv_path), 0)
})

test_that("write_batch_summary_csv tolerates missing nested fields", {
  tmp <- tempfile()
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE))

  incomplete <- list(
    list(config = list(species = "Minimal"), cv = NULL, metrics = NULL,
         summary = NULL, eoo_aoo = NULL)
  )
  expect_error(write_batch_summary_csv(incomplete, tmp), NA)
  df <- read.csv(file.path(tmp, "batch_summary.csv"), stringsAsFactors = FALSE)
  expect_equal(df$species, "Minimal")
  expect_equal(df$status, "success")
  expect_true(is.na(df$auc_mean))
})
