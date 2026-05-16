test_that("end-to-end pipeline with synthetic data produces expected result structure", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping end-to-end test because terra is not installed")
  } else {
    set.seed(42)
    tmp_occ <- tempfile(fileext = ".csv")
    tmp_out <- tempfile()
    dir.create(tmp_out, showWarnings = FALSE)

    occ <- data.frame(
      species = "Synthetic species",
      longitude = seq(140.15, 141.85, length.out = 40),
      latitude = seq(-23.85, -22.15, length.out = 40),
      source = rep(c("A", "B"), each = 20),
      stringsAsFactors = FALSE
    )
    utils::write.csv(occ, tmp_occ, row.names = FALSE)

    r1 <- terra::rast(nrows = 30, ncols = 30, xmin = 137, xmax = 145, ymin = -27, ymax = -19)
    r2 <- r1
    terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
    terra::values(r2) <- rep(seq(0, 1, length.out = 30), each = 30)
    env <- c(r1, r2)
    names(env) <- c("bio1", "bio12")

    tmp_env <- tempfile()
    dir.create(tmp_env, showWarnings = FALSE)
    terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
    terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

    result <- run_fast_sdm(
      species = "Synthetic species",
      occurrence_file = tmp_occ,
      worldclim_dir = tmp_env,
      selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22),
      background_n = 120,
      thin_by_cell = FALSE,
      model_id = "glm",
      include_quadratic = FALSE,
      threshold = 0.5,
      aggregation_factor = 1,
      cv_folds = 2,
      n_cores = 1,
      allow_download = FALSE,
      output_dir = tmp_out,
      seed = 42
    )

    expect_true(is.list(result))
    expect_true("suitability" %in% names(result))
    expect_true("occurrence" %in% names(result))
    expect_true("summary" %in% names(result))
    expect_true("metrics" %in% names(result))
    expect_true("config" %in% names(result))
    expect_true("paths" %in% names(result))
    expect_true("cv" %in% names(result))
    expect_true("environment" %in% names(result))
    expect_true(is.list(result$summary))
    expect_true(is.list(result$metrics))
    expect_true(is.list(result$cv))
    expect_true(is.list(result$config))
    expect_true(is.list(result$paths))
    expect_true(is.numeric(result$metrics$auc_mean))
    expect_true(result$metrics$auc_mean >= 0)
    expect_true(result$metrics$auc_mean <= 1)
    expect_true(file.exists(result$paths$tif))
    expect_true(file.exists(result$paths$png))
    expect_true(file.exists(result$report_text))

    unlink(tmp_out, recursive = TRUE)
  }
})