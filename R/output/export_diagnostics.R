# Export all diagnostic data as CSV files in a ZIP archive.
# Called from Plumber model run endpoint after run_fast_sdm() completes.
# Replaces the heavier save_diagnostic_plots() for automatic generation.
# PNG plots can still be generated on demand via POST /api/v1/diagnostics/plots.

export_diagnostics_csv <- function(result, job_dir, log_fun = NULL) {
  tmp_dir <- file.path(job_dir, ".diag_csv")
  dir.create(tmp_dir, showWarnings = FALSE)
  file_count <- 0

  # 1. Variable importance
  imp <- result$variable_importance
  if (!is.null(imp) && is.data.frame(imp) && nrow(imp) > 0) {
    write.csv(imp, file.path(tmp_dir, "importance.csv"), row.names = FALSE)
    file_count <- file_count + 1
  }

  # 2. Response curves
  rc <- result$response_curves
  if (!is.null(rc) && length(rc) > 0 && is.list(rc)) {
    combined <- data.table::rbindlist(lapply(names(rc), function(nm) {
      df <- rc[[nm]]
      if (!is.null(df) && is.data.frame(df) && nrow(df) > 0) {
        df$covariate <- nm
        df
      } else NULL
    }))
    if (!is.null(combined) && nrow(combined) > 0) {
      write.csv(combined, file.path(tmp_dir, "response_curves.csv"), row.names = FALSE)
      file_count <- file_count + 1
    }
  }

  # 3. CV fold metrics
  cv <- result$cv
  if (!is.null(cv) && is.data.frame(cv$fold_metrics) && nrow(cv$fold_metrics) > 0) {
    write.csv(cv$fold_metrics, file.path(tmp_dir, "cv_folds.csv"), row.names = FALSE)
    file_count <- file_count + 1
  }

  # 4. Predictions for threshold/density analysis
  pres_suit <- result$fit$presence_suit
  bg_suit <- result$fit$background_suit
  if (!is.null(pres_suit) && length(pres_suit) > 0) {
    df <- data.frame(suitability = pres_suit, type = "presence")
    write.csv(df, file.path(tmp_dir, "predictions_presence.csv"), row.names = FALSE)
    file_count <- file_count + 1
  }
  if (!is.null(bg_suit) && length(bg_suit) > 0) {
    df <- data.frame(suitability = bg_suit, type = "background")
    write.csv(df, file.path(tmp_dir, "predictions_background.csv"), row.names = FALSE)
    file_count <- file_count + 1
  }

  # 5. CBI bin data (if already computed)
  if (!is.null(result$cbi_data) && is.data.frame(result$cbi_data$bins) && nrow(result$cbi_data$bins) > 0) {
    write.csv(result$cbi_data$bins, file.path(tmp_dir, "cbi_bins.csv"), row.names = FALSE)
    file_count <- file_count + 1
  }

  # Zip everything
  if (file_count > 0) {
    zip_path <- file.path(job_dir, "diagnostics_data.zip")
    owd <- setwd(tmp_dir)
    zip(zip_path, files = list.files(tmp_dir))
    setwd(owd)
    unlink(tmp_dir, recursive = TRUE)
    log_message(log_fun, "Saved diagnostics ZIP (", file_count, " files): ", zip_path)
    return(zip_path)
  }

  unlink(tmp_dir, recursive = TRUE)
  log_message(log_fun, "No diagnostic data to export")
  NULL
}
