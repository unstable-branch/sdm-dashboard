# On-demand generation of ensemble statistics GeoTIFFs from saved components.
# Can be called post-run — no model re-fit needed.
# Reference: Zurell et al. 2020, Ecography 43:1261-1277

#' Generate ensemble statistics rasters from saved component rasters.
#'
#' Reads the component GeoTIFFs from disk, computes the requested ensemble
#' statistics (mean, median, committee, sd, disagreement), and writes them
#' as new GeoTIFFs alongside the original ensemble output.
#'
#' @param result_dir Directory containing result.rds from a previous run.
#' @param stats Character vector of stats to generate. Default generates all.
#' @param overwrite Overwrite existing files. Default FALSE.
#' @return Named list of generated GeoTIFF paths.
generate_ensemble_rasters <- function(result_dir,
                                       stats = c("mean", "median", "committee", "sd", "disagreement"),
                                       overwrite = FALSE) {
  result_path <- file.path(result_dir, "result.rds")
  if (!file.exists(result_path)) {
    stop("result.rds not found in: ", result_dir, call. = FALSE)
  }

  result <- readRDS(result_path)
  output_tif <- result$paths$tif
  if (is.null(output_tif) || !file.exists(output_tif)) {
    stop("No suitability raster found. Cannot generate ensemble stats.", call. = FALSE)
  }

  components <- result$model$model$components
  weights <- result$model$model$weights
  if (is.null(components) || length(components) < 2) {
    stop("Result does not contain a multi-model ensemble with multiple components.", call. = FALSE)
  }

  cv_list <- result$cv$component_cv %||% lapply(components, function(c) list(auc_mean = NA_real_, tss_mean = NA_real_))
  user_threshold <- result$config$threshold %||% 0.5

  # Read component rasters from saved paths
  preds <- list()
  for (m in names(components)) {
    comp_path <- multi_ensemble_component_path(output_tif, m)
    if (file.exists(comp_path)) {
      preds[[m]] <- terra::rast(comp_path)
    } else {
      message("Component raster not found for: ", m, " at ", comp_path)
    }
  }
  if (length(preds) < 2) {
    stop("Need at least 2 component rasters on disk. Found: ", length(preds), call. = FALSE)
  }

  pred_stack <- terra::rast(preds)
  generated <- list()

  if ("mean" %in% stats) {
    r <- terra::app(pred_stack, mean, na.rm = TRUE)
    names(r) <- "ensemble_mean"
    p <- sub(".tif$", "_ensemble_mean.tif", output_tif)
    if (overwrite || !file.exists(p)) {
      terra::writeRaster(r, p, overwrite = TRUE,
        wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      message("Generated: ", p)
    }
    generated$mean <- p
  }

  if ("median" %in% stats) {
    r <- terra::app(pred_stack, median, na.rm = TRUE)
    names(r) <- "ensemble_median"
    p <- sub(".tif$", "_ensemble_median.tif", output_tif)
    if (overwrite || !file.exists(p)) {
      terra::writeRaster(r, p, overwrite = TRUE,
        wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      message("Generated: ", p)
    }
    generated$median <- p
  }

  if ("committee" %in% stats) {
    binary_preds <- lapply(names(preds), function(m) {
      comp_idx <- which(names(components) == m)
      comp_thresh <- if (length(comp_idx) > 0 && !is.null(cv_list[[comp_idx]]$threshold)) {
        cv_list[[comp_idx]]$threshold
      } else {
        0.5
      }
      thresh <- user_threshold %||% comp_thresh
      preds[[m]] >= thresh
    })
    committee_stack <- do.call(c, binary_preds)
    r <- terra::app(committee_stack, mean, na.rm = TRUE)
    names(r) <- "ensemble_committee"
    p <- sub(".tif$", "_ensemble_committee.tif", output_tif)
    if (overwrite || !file.exists(p)) {
      terra::writeRaster(r, p, overwrite = TRUE,
        wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      message("Generated: ", p)
    }
    generated$committee <- p
  }

  if ("sd" %in% stats) {
    r <- terra::app(pred_stack, sd, na.rm = TRUE)
    names(r) <- "ensemble_sd"
    p <- sub(".tif$", "_ensemble_sd.tif", output_tif)
    if (overwrite || !file.exists(p)) {
      terra::writeRaster(r, p, overwrite = TRUE,
        wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      message("Generated: ", p)
    }
    generated$sd <- p
  }

  if ("disagreement" %in% stats) {
    r <- terra::app(pred_stack, function(x) {
      if (all(is.na(x))) NA_real_ else max(x, na.rm = TRUE) - min(x, na.rm = TRUE)
    })
    names(r) <- "ensemble_disagreement"
    p <- multi_ensemble_component_path(output_tif, "disagreement")
    if (overwrite || !file.exists(p)) {
      terra::writeRaster(r, p, overwrite = TRUE,
        wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NAflag=-9999")))
      message("Generated: ", p)
    }
    generated$disagreement <- p
  }

  invisible(generated)
}