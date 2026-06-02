# Raster prediction and suitability summary helpers.

predict_suitability <- function(model, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  n_cores <- normalize_core_count(n_cores)
  log_message(log_fun, "Predicting suitability raster with ", n_cores, " core(s)")
  predict_args <- list(
    object = env_project_scaled, model = model, type = "response", na.rm = TRUE,
    filename = output_tif, overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999"))
  )
  if (n_cores > 1) predict_args$cores <- n_cores
  suit <- tryCatch(do.call(terra::predict, predict_args), error = function(e) {
    err_msg <- conditionMessage(e)
    log_message(log_fun, "Prediction error: ", err_msg)
    if (n_cores > 1) {
      log_message(log_fun, "Parallel terra prediction fell back to single-core mode: ", err_msg)
      predict_args$cores <- NULL
      do.call(terra::predict, predict_args)
    } else {
      stop(err_msg, call. = FALSE)
    }
  })
  names(suit) <- "suitability"
  suit
}

summarise_suitability <- function(suitability, threshold = sdm_default_threshold,
                                  uncertainty_raster = NULL) {
  threshold <- normalize_threshold(threshold)

  cell_count <- tryCatch(
    {
      valid <- !is.na(suitability)
      as.numeric(terra::global(valid, "sum", na.rm = TRUE)[1, 1])
    },
    error = function(e) NA_real_
  )

  if (!is.finite(cell_count) || cell_count == 0) {
    base <- list(
      cell_count = 0, mean = NA_real_, median = NA_real_, max = NA_real_, threshold = threshold,
      cells_above_threshold = 0, percent_above_threshold = NA_real_, high_risk_area_km2 = NA_real_
    )
    base$high_risk_area_uncertainty_km2 <- NA_real_
    base$high_risk_area_ci95_lower <- NA_real_
    base$high_risk_area_ci95_upper <- NA_real_
    return(base)
  }

  mean_val <- tryCatch(as.numeric(terra::global(suitability, "mean", na.rm = TRUE)[1, 1]), error = function(e) NA_real_)
  median_val <- tryCatch(as.numeric(terra::global(suitability, "median", na.rm = TRUE)[1, 1]), error = function(e) NA_real_)
  max_val <- tryCatch(as.numeric(terra::global(suitability, "max", na.rm = TRUE)[1, 1]), error = function(e) NA_real_)
  risk_cells <- tryCatch(
    {
      risk <- suitability >= threshold
      as.numeric(terra::global(risk, "sum", na.rm = TRUE)[1, 1])
    },
    error = function(e) NA_real_
  )
  if (!is.finite(risk_cells)) risk_cells <- 0

  high_risk_area <- tryCatch(
    {
      area <- terra::cellSize(suitability, unit = "km")
      area_risk <- terra::ifel(suitability >= threshold, area, NA)
      as.numeric(terra::global(area_risk, "sum", na.rm = TRUE)[1, 1])
    },
    error = function(e) NA_real_
  )

  area_uncertainty <- NA_real_
  ci95_lower <- NA_real_
  ci95_upper <- NA_real_

  if (!is.null(uncertainty_raster) && inherits(uncertainty_raster, "SpatRaster")) {
    tryCatch({
      area <- terra::cellSize(suitability, unit = "km")
      risk_mask <- terra::ifel(suitability >= threshold, 1, NA)
      area_risk <- risk_mask * area
      n_risk_cells <- terra::global(risk_mask, "sum", na.rm = TRUE)[1, 1]
      total_risk_area <- terra::global(area_risk, "sum", na.rm = TRUE)[1, 1]

      if (is.finite(n_risk_cells) && n_risk_cells > 1 && is.finite(total_risk_area) && total_risk_area > 0) {
        unc_weighted <- uncertainty_raster * area_risk
        unc_sum <- terra::global(unc_weighted, "sum", na.rm = TRUE)[1, 1]
        if (is.finite(unc_sum) && unc_sum > 0) {
          mean_unc_in_risk <- unc_sum / total_risk_area
          area_uncertainty <- mean_unc_in_risk * total_risk_area
          ci95_lower <- max(0, high_risk_area - 1.96 * area_uncertainty)
          ci95_upper <- high_risk_area + 1.96 * area_uncertainty
        }
      }
    }, error = function(e) NULL)
  }

  list(
    cell_count = cell_count, mean = mean_val, median = median_val, max = max_val,
    threshold = threshold, cells_above_threshold = risk_cells,
    percent_above_threshold = 100 * risk_cells / cell_count,
    high_risk_area_km2 = high_risk_area,
    high_risk_area_uncertainty_km2 = area_uncertainty,
    high_risk_area_ci95_lower = ci95_lower,
    high_risk_area_ci95_upper = ci95_upper
  )
}
