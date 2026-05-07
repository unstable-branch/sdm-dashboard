# Raster prediction and suitability summary helpers.

<<<<<<< HEAD
=======
predict_biomod2_suitability <- function(biomod_model, env_raster, output_tif, n_cores = 1, log_fun = NULL) {
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  log_message(log_fun, "Running biomod2 projection with ", n_cores, " core(s)")

  proj_dir <- file.path(dirname(output_tif), "current")
  dir.create(proj_dir, recursive = TRUE, showWarnings = FALSE)

  tryCatch({
    proj_res <- biomod2::BIOMOD_Projection(
      bm.mod = biomod_model,
      new.env = env_raster,
      models.chosen = "all",
      proj.name = "current",
      binary.metrics = NULL,
      doNE = FALSE,
      output.format = ".tif",
      output.dir = dirname(output_tif),
      do.stack = FALSE,
      compress = TRUE,
      overwrite = TRUE,
      by = if (n_cores > 1) n_cores else 1
    )

    tif_files <- list.files(proj_dir, pattern = "\\.tif$", full.names = TRUE)
    if (length(tif_files) == 0) {
      tif_files <- list.files(dirname(output_tif), pattern = "\\.tif$", full.names = TRUE)
    }
    if (length(tif_files) == 0) {
      stop("BIOMOD_Projection did not produce any .tif files")
    }

    suit <- terra::rast(tif_files[1])
    names(suit) <- "suitability"

    if (length(tif_files) > 1) {
      for (f in tif_files[-1]) {
        suit <- terra::app(c(suit, terra::rast(f)), fun = mean, na.rm = TRUE)
      }
    }

    terra::writeRaster(suit, output_tif, overwrite = TRUE, wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
    log_message(log_fun, "Biomod2 projection saved to ", output_tif)
    suit
  }, error = function(e) {
    log_message(log_fun, "Biomod2 projection failed: ", conditionMessage(e))
    stop(e)
  })
}

>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
predict_suitability <- function(model, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  n_cores <- normalize_core_count(n_cores)
  log_message(log_fun, "Predicting suitability raster with ", n_cores, " core(s)")
  predict_args <- list(object = env_project_scaled, model = model, type = "response", na.rm = TRUE,
                       filename = output_tif, overwrite = TRUE,
                       wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES")))
  if (n_cores > 1) predict_args$cores <- n_cores
  suit <- tryCatch(do.call(terra::predict, predict_args), error = function(e) {
    if (n_cores > 1) {
      log_message(log_fun, "Parallel terra prediction fell back to single-core mode: ", conditionMessage(e))
      predict_args$cores <- NULL
      do.call(terra::predict, predict_args)
    } else {
      stop(e)
    }
  })
  names(suit) <- "suitability"
  suit
}

summarise_suitability <- function(suitability, threshold = sdm_default_threshold) {
  threshold <- normalize_threshold(threshold)

  cell_count <- tryCatch({
    valid <- !is.na(suitability)
    as.numeric(terra::global(valid, "sum", na.rm = TRUE)[1, 1])
  }, error = function(e) NA_real_)

  if (!is.finite(cell_count) || cell_count == 0) {
    return(list(cell_count = 0, mean = NA_real_, median = NA_real_, max = NA_real_, threshold = threshold,
                cells_above_threshold = 0, percent_above_threshold = NA_real_, high_risk_area_km2 = NA_real_))
  }

  mean_val <- tryCatch(as.numeric(terra::global(suitability, "mean", na.rm = TRUE)[1, 1]), error = function(e) NA_real_)
  median_val <- tryCatch(as.numeric(terra::global(suitability, "median", na.rm = TRUE)[1, 1]), error = function(e) NA_real_)
  max_val <- tryCatch(as.numeric(terra::global(suitability, "max", na.rm = TRUE)[1, 1]), error = function(e) NA_real_)
  risk_cells <- tryCatch({
    risk <- suitability >= threshold
    as.numeric(terra::global(risk, "sum", na.rm = TRUE)[1, 1])
  }, error = function(e) NA_real_)
  if (!is.finite(risk_cells)) risk_cells <- 0

  high_risk_area <- tryCatch({
    area <- terra::cellSize(suitability, unit = "km")
    area_risk <- terra::ifel(suitability >= threshold, area, NA)
    as.numeric(terra::global(area_risk, "sum", na.rm = TRUE)[1, 1])
  }, error = function(e) NA_real_)

  list(cell_count = cell_count, mean = mean_val, median = median_val, max = max_val,
       threshold = threshold, cells_above_threshold = risk_cells,
       percent_above_threshold = 100 * risk_cells / cell_count, high_risk_area_km2 = high_risk_area)
}
