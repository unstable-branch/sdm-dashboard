test_that("two-component AUC weights give no evidence to reversal", {
  glm_fit <- list(cv = list(auc_mean = 0.9))
  rangebag_fit <- list(cv = list(auc_mean = 0.4))

  weights <- ensemble_model_weights(glm_fit, rangebag_fit, weighting = "auc")
  expect_equal(weights, c(glm = 1, rangebag = 0))

  inverted <- ensemble_model_weights(
    list(cv = list(auc_mean = 0)),
    list(cv = list(auc_mean = 1)),
    weighting = "auc"
  )
  expect_equal(inverted, c(glm = 0, rangebag = 1))
})

test_that("GLM + Rangebag ensemble fits and writes component rasters", {
  if (!requireNamespace("terra", quietly = TRUE)) {
    message("Skipping ensemble backend test because terra is not installed")
  } else {
    set.seed(42)
    r1 <- terra::rast(nrows = 20, ncols = 20, xmin = 140, xmax = 142, ymin = -24, ymax = -22)
    r2 <- r1
    terra::values(r1) <- seq_len(terra::ncell(r1)) / terra::ncell(r1)
    terra::values(r2) <- rep(seq(0, 1, length.out = 20), each = 20)
    env <- c(r1, r2)
    names(env) <- c("bio1", "bio12")

    occ <- data.frame(
      species = "Synthetic species",
      longitude = seq(140.15, 141.85, length.out = 24),
      latitude = seq(-23.85, -22.15, length.out = 24),
      source = rep(c("A", "B"), each = 12),
      stringsAsFactors = FALSE
    )

    fit <- fit_sdm_model("ensemble_glm_rangebag", occ, env, background_n = 120, include_quadratic = FALSE, cv_folds = 2, seed = 99, n_cores = 1)
    expect_equal(fit$model_id, "ensemble_glm_rangebag")
    expect_equal(fit$model_label, "Ensemble (GLM + Rangebagging)")
    expect_true(is.list(fit$model$glm))
    expect_true(is.list(fit$model$rangebag))
    expect_true(abs(sum(fit$model$weights) - 1) < 1e-8)
    expect_true(abs(ensemble_weighted_metric(c(NA_real_, 0.8), c(0.5, 0.5)) - 0.8) < 1e-8)
    expect_true(is.na(fit$cv$auc_sd))
    expect_true(is.finite(fit$cv$auc_component_sd))
    expect_true(is.data.frame(fit$coefficients))

    output_tif <- tempfile(fileext = ".tif")
    suit <- predict_sdm_model(fit, env, output_tif, n_cores = 1)
    expect_true(inherits(suit, "SpatRaster"))
    expect_equal(names(suit), "suitability")
    expect_true(file.exists(output_tif))
    expect_true(file.exists(ensemble_component_path(output_tif, "glm")))
    expect_true(file.exists(ensemble_component_path(output_tif, "rangebag")))
    expect_true(file.exists(ensemble_component_path(output_tif, "disagreement")))

    result <- list(
      paths = list(tif = output_tif, png = tempfile(fileext = ".png"), report = tempfile(fileext = ".txt"),
                   glm_tif = ensemble_component_path(output_tif, "glm"),
                   rangebag_tif = ensemble_component_path(output_tif, "rangebag"),
                   disagreement_tif = ensemble_component_path(output_tif, "disagreement")),
      config = list(species = "Synthetic species", occurrence_source = "synthetic", occurrence_file = "synthetic.csv",
                    worldclim_dir = "Worldclim", selected_biovars = c(1, 12), use_elevation = FALSE, use_soil = FALSE,
                    training_extent = c(140, 142, -24, -22), projection_extent = c(140, 142, -24, -22),
                    background_n = 120),
      environment = list(names = names(env)), occurrence = occ, source_counts = table(occ$source),
      cleaning = list(removed_bad_coordinates = 0, removed_duplicates = 0),
      model_info = list(method = "AUC-weighted ensemble of GLM and Rangebagging suitability predictions"),
      metrics = list(auc_mean = fit$cv$auc_mean, auc_sd = fit$cv$auc_sd, presence_records = nrow(fit$occurrence_used),
                     background_points = nrow(fit$background_xy), n_cores = 1),
      summary = list(cell_count = terra::ncell(suit), mean = 0.5, median = 0.5, max = 1,
                     threshold = 0.5, cells_above_threshold = 10, percent_above_threshold = 10,
                     high_risk_area_km2 = 1)
    )
    report_path <- tempfile(fileext = ".txt")
    write_summary_report(result, report_path)
    report_text <- paste(readLines(report_path), collapse = "\n")
    expect_true(grepl("Model disagreement GeoTIFF", report_text, fixed = TRUE))
  }
})
