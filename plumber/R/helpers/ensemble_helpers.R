# Ensemble raster generation handler.
# Called on-demand from the frontend to regenerate ensemble summary rasters
# (mean, median, sd, committee, disagreement) from per-component suitability
# rasters after a multi_ensemble model run.

`%||%` <- function(a, b) if (!is.null(a)) a else b

handle_ensemble_rasters <- function(res, job_id, app_dir) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }

  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Job meta not found"))
  }

  meta <- tryCatch(jsonlite::read_json(meta_file), error = function(e) NULL)
  if (is.null(meta)) {
    res$status <- 500L; return(list(error = "Failed to read job metadata"))
  }

  # Verify this is a completed multi-ensemble run
  if (!identical(meta$model_id %||% meta$config$model_id, "multi_ensemble")) {
    res$status <- 400L; return(list(error = "Not a multi-ensemble model run"))
  }
  if (!identical(meta$status, "completed")) {
    res$status <- 409L; return(list(error = "Run is not completed"))
  }

  # Get component TIFF paths from output_files or by scanning the directory
  output_files <- meta$output_files %||% list()
  component_keys <- grep("^multi_ens_comp_", names(output_files), value = TRUE)
  component_tifs <- unlist(output_files[component_keys], use.names = FALSE)

  # If no components in metadata, scan output directory for per-model TIFFs
  output_tif <- output_files$tif %||% ""
  if (length(component_tifs) == 0 && nzchar(output_tif)) {
    base_dir <- dirname(output_tif)
    base_name <- sub("_suitability\\.tif$", "", basename(output_tif))
    candidate_files <- list.files(base_dir, pattern = paste0("^", base_name, "_.+\\.tif$"), full.names = TRUE)
    summary_patterns <- c("_mean\\.tif$", "_median\\.tif$", "_sd\\.tif$",
      "_committee\\.tif$", "_disagreement\\.tif$", "_richness\\.tif$",
      "_ensemble_mean\\.tif$", "_ensemble_median\\.tif$", "_ensemble_sd\\.tif$",
      "_ensemble_committee\\.tif$")
    for (sp in summary_patterns) {
      candidate_files <- grep(sp, candidate_files, invert = TRUE, value = TRUE)
    }
    component_tifs <- candidate_files
  }

  if (length(component_tifs) < 2) {
    res$status <- 500L; return(list(error = "Need at least 2 component rasters"))
  }

  # Load component rasters
  comp_stack <- tryCatch(terra::rast(component_tifs), error = function(e) NULL)
  if (is.null(comp_stack)) {
    res$status <- 500L; return(list(error = "Failed to load component rasters"))
  }

  generated <- character()
  output_dir <- if (nzchar(output_tif)) dirname(output_tif) else job_dir

  # Write a raster if it doesn't already exist, tracking it
  write_if_missing <- function(values, key_suffix, name) {
    existing_key <- paste0("multi_ens_", key_suffix, "_tif")
    existing_path <- output_files[[existing_key]] %||% ""
    if (nzchar(existing_path) && file.exists(existing_path)) {
      return(existing_path)
    }
    out_path <- file.path(output_dir, paste0(name, ".tif"))
    template <- terra::rast(comp_stack[[1]])
    terra::values(template) <- NA_real_
    idx <- which(!is.na(terra::values(comp_stack[[1]])))
    if (length(idx) > 0) {
      terra::values(template)[idx] <- values
    }
    names(template) <- key_suffix
    terra::writeRaster(template, out_path, overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999")))
    output_files[[existing_key]] <<- out_path
    generated <<- c(generated, out_path)
    out_path
  }

  # Compute cell-wise values across component stack
  vals <- terra::values(comp_stack)
  valid <- which(complete.cases(vals))
  if (length(valid) == 0) {
    res$status <- 500L; return(list(error = "No valid cells in component rasters"))
  }
  comp_vals <- vals[valid, , drop = FALSE]

  # Determine output base name from first component
  out_name <- sub("\\.tif$", "", basename(component_tifs[1]))
  out_name <- sub("_[^_]+$", "", out_name)

  # Mean
  write_if_missing(rowMeans(comp_vals, na.rm = TRUE), "mean", paste0(out_name, "_ensemble_mean"))
  # Median
  write_if_missing(apply(comp_vals, 1, stats::median, na.rm = TRUE), "median", paste0(out_name, "_ensemble_median"))
  # SD
  write_if_missing(apply(comp_vals, 1, stats::sd, na.rm = TRUE), "sd", paste0(out_name, "_ensemble_sd"))
  # Committee — proportion of models predicting suitability > 0.5
  committee <- rowMeans(comp_vals > 0.5, na.rm = TRUE)
  write_if_missing(committee, "committee", paste0(out_name, "_ensemble_committee"))
  # Disagreement — 1 minus the max agreement
  prop_above <- rowMeans(comp_vals > 0.5, na.rm = TRUE)
  prop_below <- 1 - prop_above
  disagreement <- 1 - pmax(prop_above, prop_below)
  write_if_missing(disagreement, "disagreement", paste0(out_name, "_disagreement"))

  # Write updated meta.json
  if (length(generated) > 0) {
    meta$output_files <- output_files
    sdm_write_json(meta, meta_file)
  }

  list(ok = TRUE, generated = unname(generated), n_components = length(component_tifs))
}
