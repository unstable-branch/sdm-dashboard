# Text report generation.

write_summary_report <- function(result, path) {
  fmt_num <- function(x, digits = 0, suffix = "") {
    if (length(x) == 0) return("not available")
    x <- suppressWarnings(as.numeric(x[1]))
    if (!is.finite(x)) return("not available")
    paste0(format(round(x, digits), big.mark = ",", nsmall = digits, trim = TRUE), suffix)
  }
  fmt_chr <- function(x, empty = "not provided") {
    x <- as.character(x)
    x <- x[!is.na(x) & nzchar(x)]
    if (length(x) == 0) return(empty)
    paste(x, collapse = ", ")
  }
  fmt_extent <- function(x) {
    x <- suppressWarnings(as.numeric(x))
    if (length(x) != 4 || any(!is.finite(x))) return("not available")
    paste(format(round(x, 4), trim = TRUE), collapse = ", ")
  }
  fmt_bool <- function(x) if (isTRUE(x)) "yes" else "no"
  finite_one <- function(x) {
    if (length(x) == 0) return(FALSE)
    x <- suppressWarnings(as.numeric(x[1]))
    is.finite(x)
  }

  covariates <- if (!is.null(result$environment$names)) result$environment$names else character()
  model_method <- if (!is.null(result$model_info$method) && nzchar(result$model_info$method)) {
    result$model_info$method
  } else {
    "Fast presence/background GLM with balanced class weights"
  }
  auc_text <- if (finite_one(result$metrics$auc_mean)) {
    paste0(sprintf("%.3f", result$metrics$auc_mean),
           if (finite_one(result$metrics$auc_sd)) paste0(" +/- ", sprintf("%.3f", result$metrics$auc_sd)) else "")
  } else {
    "not run"
  }
<<<<<<< HEAD
  tss_text <- if (finite_one(result$metrics$tss_mean)) {
    paste0(sprintf("%.3f", result$metrics$tss_mean),
           if (finite_one(result$metrics$tss_sd)) paste0(" +/- ", sprintf("%.3f", result$metrics$tss_sd)) else "")
  } else {
    "not available"
  }
  thinning_mode <- result$config$thinning_mode %||% if (isTRUE(result$config$thin_by_cell)) "raster_cell" else "none"
  thinning_text <- paste0(thinning_mode, if (identical(thinning_mode, "distance")) paste0(" (", fmt_num(result$config$thinning_distance_km, 1), " km)") else "")
  random_cv_warning <- if (identical(result$metrics$cv_strategy %||% result$config$cv_strategy %||% "random", "random")) {
    c("", "Warnings", "- Random cross-validation can overestimate performance when occurrence records are spatially autocorrelated. Use spatial block CV for stronger out-of-area validation.")
  } else character()
=======
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
  percent_text <- if (finite_one(result$summary$percent_above_threshold)) {
    sprintf("%.1f%%", result$summary$percent_above_threshold)
  } else {
    "not available"
  }
  extra_output_lines <- character()
  if (!is.null(result$paths$disagreement_tif)) extra_output_lines <- c(extra_output_lines, paste0("- Model disagreement GeoTIFF: ", fmt_chr(result$paths$disagreement_tif)))
  if (!is.null(result$paths$glm_tif)) extra_output_lines <- c(extra_output_lines, paste0("- GLM component GeoTIFF: ", fmt_chr(result$paths$glm_tif)))
  if (!is.null(result$paths$rangebag_tif)) extra_output_lines <- c(extra_output_lines, paste0("- Rangebag component GeoTIFF: ", fmt_chr(result$paths$rangebag_tif)))
  if (!is.null(result$paths$future_tif)) extra_output_lines <- c(extra_output_lines, paste0("- Future suitability GeoTIFF: ", fmt_chr(result$paths$future_tif)))
  if (!is.null(result$paths$delta_tif)) extra_output_lines <- c(extra_output_lines, paste0("- Future delta GeoTIFF: ", fmt_chr(result$paths$delta_tif)))
  future_lines <- character()
  if (!is.null(result$future)) {
    future_lines <- c(
      "", "Future projection",
      paste0("- Scenario label: ", fmt_chr(result$config$future_label, "Future climate")),
      paste0("- Future climate directory: ", fmt_chr(result$config$future_worldclim_dir)),
      paste0("- Mean future suitability: ", fmt_num(result$future$summary$mean, 3)),
      paste0("- Cells above threshold ", fmt_num(result$future$summary$threshold, 2), ": ", fmt_num(result$future$summary$cells_above_threshold))
    )
  }
  lines <- c(
    paste0("Species Distribution Model Report: ", fmt_chr(result$config$species, "Species")),
    paste0("Generated: ", format(Sys.time(), "%Y-%m-%d %H:%M:%S")),
    "", "Inputs",
    paste0("- Observation record source: ", fmt_chr(result$config$occurrence_source, "not recorded")),
    paste0("- Observation record file: ", fmt_chr(result$config$occurrence_file)),
    paste0("- WorldClim directory: ", fmt_chr(result$config$worldclim_dir)),
    paste0("- BIO variables: ", fmt_chr(paste0("BIO", result$config$selected_biovars))),
    paste0("- Covariates used: ", fmt_chr(covariates, "none")),
    paste0("- Elevation enabled: ", fmt_bool(result$config$use_elevation), if (isTRUE(result$config$use_elevation)) paste0(" (", fmt_chr(result$config$elevation_demtype), ")") else ""),
    paste0("- Soil enabled: ", fmt_bool(result$config$use_soil), if (isTRUE(result$config$use_soil)) paste0(" (", fmt_chr(result$config$selected_soil_vars), ")") else ""),
    paste0("- Training extent: ", fmt_extent(result$config$training_extent)),
    paste0("- Projection extent: ", fmt_extent(result$config$projection_extent)),
    "", "Cleaned occurrence data",
    paste0("- Valid records: ", fmt_num(nrow(result$occurrence))),
    paste0("- Sources: ", fmt_num(length(result$source_counts))),
    paste0("- Removed invalid coordinates: ", fmt_num(result$cleaning$removed_bad_coordinates)),
    paste0("- Removed duplicate records: ", fmt_num(result$cleaning$removed_duplicates)),
<<<<<<< HEAD
    paste0("- Thinning mode: ", thinning_text),
    paste0("- Records removed by thinning: ", fmt_num(result$thinning$removed_total)),
=======
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
    "", "Model",
    paste0("- Method: ", model_method),
    "- Background sampling: complete covariate cells; presence-cell overlap excluded where raster cells are available",
    paste0("- Observation records used: ", fmt_num(result$metrics$presence_records)),
    paste0("- Background points used: ", fmt_num(result$metrics$background_points)),
    paste0("- Requested background points: ", fmt_num(result$config$background_n)),
    paste0("- CPU cores requested/used: ", fmt_num(result$metrics$n_cores)),
<<<<<<< HEAD
    paste0("- Cross-validation strategy: ", fmt_chr(result$metrics$cv_strategy %||% result$config$cv_strategy, "random")),
    paste0("- Cross-validation folds: ", fmt_num(result$metrics$cv_folds)),
    paste0("- Spatial block size (km): ", fmt_num(result$metrics$cv_block_size_km, 1), " (", fmt_chr(result$metrics$cv_block_size_mode, "not applicable"), ")"),
    paste0("- Cross-validation AUC: ", auc_text),
    paste0("- Cross-validation TSS: ", tss_text),
    paste0("- Sensitivity / specificity: ", fmt_num(result$metrics$sensitivity_mean, 3), " / ", fmt_num(result$metrics$specificity_mean, 3)),
    random_cv_warning,
=======
    paste0("- Cross-validation AUC: ", auc_text),
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
    "", "Projection summary",
    paste0("- Valid projected cells: ", fmt_num(result$summary$cell_count)),
    paste0("- Mean suitability: ", fmt_num(result$summary$mean, 3)),
    paste0("- Median suitability: ", fmt_num(result$summary$median, 3)),
    paste0("- Maximum suitability: ", fmt_num(result$summary$max, 3)),
    paste0("- Cells above threshold ", fmt_num(result$summary$threshold, 2), ": ", fmt_num(result$summary$cells_above_threshold), " (", percent_text, ")"),
    paste0("- Estimated high-suitability area (km2): ", fmt_num(result$summary$high_risk_area_km2)),
    future_lines,
    "", "Outputs",
    paste0("- Suitability GeoTIFF: ", fmt_chr(result$paths$tif)),
    paste0("- Suitability PNG: ", fmt_chr(result$paths$png)),
    extra_output_lines
  )
  writeLines(lines, con = path)
  invisible(path)
}
