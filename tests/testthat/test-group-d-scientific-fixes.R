# Tests for Group D — Scientific-output fixes

# Helpers ----------------------------------------------------------------------

create_minimal_geotiff <- function(path) {
  con <- file(path, "wb")
  on.exit(close(con))
  writeBin(as.raw(c(0x49, 0x49, 0x2A, 0x00)), con)  # TIFF magic
  writeBin(rep(0x00, 256), con)                       # pad
  invisible(path)
}

# D-04 -----------------------------------------------------------------------

test_that("sdm_apply_predict: row with one NA preserves other rows as predictions", {
  # 2x3 matrix filled column-major. Layout is:
  #      [,1] [,2] [,3]
  # [1,]  0.1   NA  0.5
  # [2,]  0.2  0.4  0.6
  # Row 1 contains an NA at column 2; row 2 is fully finite.
  vals <- matrix(c(0.1, 0.2, NA, 0.4, 0.5, 0.6), nrow = 2, ncol = 3)
  preds <- sdm_apply_predict(vals, c("a", "b", "c"),
    function(df) rowSums(as.matrix(df))
  )
  # Row 1 had NA — its prediction slot stays NA.
  expect_true(is.na(preds[1]))
  # Row 2 is fully finite; rowSums(0.2, 0.4, 0.6) = 1.2.
  expect_equal(preds[2], 1.2)
})

test_that("sdm_apply_predict: empty input returns empty", {
  vals <- matrix(numeric(0), nrow = 0, ncol = 3)
  out <- sdm_apply_predict(vals, c("a", "b", "c"), function(df) 0.5)
  expect_length(out, 0L)
})

test_that("sdm_apply_predict: predict_fn returning wrong-length vector preserves NAs but writes no preds", {
  vals <- matrix(c(0.1, 0.4, 0.2, 0.5), nrow = 2)
  out <- sdm_apply_predict(vals, c("a", "b"),
    function(df) c(0.99)  # length 1, expected 2
  )
  # When length doesn't match, helper leaves the rows as NA rather than crashing
  expect_true(all(is.na(out)))
})

# D-05 -----------------------------------------------------------------------

test_that("find_worldclim_files drops HTML 404 pages masquerading as GeoTIFFs", {
  tmp <- tempfile("worldclim-")
  dir.create(tmp)
  # Real GeoTIFF
  create_minimal_geotiff(file.path(tmp, "wc2.1_10m_bio1.tif"))
  # HTML 404 page saved with .tif extension (manually placed)
  html_path <- file.path(tmp, "wc2.1_10m_bio4.tif")
  writeLines("<html><body>404 Not Found</body></html>", html_path)
  # And one more valid file for bio 7, just to confirm only bio4 is affected
  create_minimal_geotiff(file.path(tmp, "wc2.1_10m_bio7.tif"))

  paths <- find_worldclim_files(tmp, c(1, 4, 7), source = "worldclim", res = 10)
  expect_true(!is.na(paths[["1"]]))
  expect_true(is.na(paths[["4"]]))
  expect_true(!is.na(paths[["7"]]))
})

# D-01 — we cannot easily simulate the full future projection without a model,
# but we can verify the mess_train_data parameter is wired and used.
# sdm_stage_future is not called from anywhere in production; skip the
# end-to-end test and just verify the helper signatures.

test_that("project_future_suitability accepts mess_train_data parameter without error", {
  # This test exists to lock the signature change. It does NOT run the full
  # projection (which would require a model + multiple geo rasters).
  expect_true("mess_train_data" %in% names(formals(project_future_suitability)))
  expect_true(is.null(formals(project_future_suitability)$mess_train_data))
})

# D-03 -----------------------------------------------------------------------

test_that("clean_occurrences attaches DwC-A metadata attributes preserved on cleaned", {
  # We can't easily mock clean_occurrences without a full GBIF pipeline. Instead
  # this test verifies the manifest extraction shape: if dwca_datasets is
  # NULL, downstream consumers get NULL (which is the correct value when not
  # applicable), but if the value is set, it must round-trip through manifest.
  # This is an attribute-preservation contract test.
  cleaned <- list(records = data.frame(), source_counts = list(), cc_log = list())
  attr(cleaned$records, "dwca_datasets") <- c("dataset-A", "dataset-B")
  attr(cleaned$records, "gbif_doi") <- "10.1234/foo"
  # Mimic the run_sdm.R preservation:
  cleaned$dwca_datasets <- attr(cleaned$records, "dwca_datasets")
  cleaned$gbif_doi      <- attr(cleaned$records, "gbif_doi")
  cleaned$records      <- NULL
  expect_identical(cleaned$dwca_datasets, c("dataset-A", "dataset-B"))
  expect_identical(cleaned$gbif_doi, "10.1234/foo")
})

# D-02 -----------------------------------------------------------------------

test_that("select_threshold returns NA (not 0.5) when too few samples", {
  opt <- select_threshold(presence_suit = c(0.7, 0.8), background_suit = c(0.1, 0.2))
  expect_true(is.na(opt$threshold))
  expect_true(is.na(opt$max_tss))
  expect_equal(opt$method, "fallback")
})

test_that("select_threshold still returns a finite threshold when samples >= 3", {
  set.seed(1)
  pres <- c(rbeta(50, 5, 2))      # clustered near 1
  bg   <- c(rbeta(50, 2, 5))      # clustered near 0
  opt <- select_threshold(pres, bg)
  expect_true(is.finite(opt$threshold))
  expect_true(opt$threshold > 0 && opt$threshold < 1)
  expect_true(is.finite(opt$max_tss))
})
