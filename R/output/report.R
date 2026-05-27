# Text report generation.

write_summary_report <- function(result, path) {
  fmt_num <- function(x, digits = 0, suffix = "") {
    if (length(x) == 0) {
      return("not available")
    }
    x <- suppressWarnings(as.numeric(x[1]))
    if (!is.finite(x)) {
      return("not available")
    }
    paste0(format(round(x, digits), big.mark = ",", nsmall = digits, trim = TRUE), suffix)
  }
  fmt_chr <- function(x, empty = "not provided") {
    x <- as.character(x)
    x <- x[!is.na(x) & nzchar(x)]
    if (length(x) == 0) {
      return(empty)
    }
    paste(x, collapse = ", ")
  }
  fmt_extent <- function(x) {
    x <- suppressWarnings(as.numeric(x))
    if (length(x) != 4 || any(!is.finite(x))) {
      return("not available")
    }
    paste(format(round(x, 4), trim = TRUE), collapse = ", ")
  }
  fmt_bool <- function(x) if (isTRUE(x)) "yes" else "no"
  finite_one <- function(x) {
    if (length(x) == 0) {
      return(FALSE)
    }
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
    paste0(
      sprintf("%.3f", result$metrics$auc_mean),
      if (finite_one(result$metrics$auc_sd)) paste0(" +/- ", sprintf("%.3f", result$metrics$auc_sd)) else ""
    )
  } else {
    "not run"
  }
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
  if (!is.null(result$paths$mess_tif)) extra_output_lines <- c(extra_output_lines, paste0("- MESS extrapolation GeoTIFF: ", fmt_chr(result$paths$mess_tif)))
  if (!is.null(result$paths$mod_tif)) extra_output_lines <- c(extra_output_lines, paste0("- Most dissimilar variable GeoTIFF: ", fmt_chr(result$paths$mod_tif)))
  multi_ens_comp <- grep("^multi_ens_comp_", names(result$paths), value = TRUE)
  for (p in multi_ens_comp) {
    label <- sub("^multi_ens_comp_", "", p)
    extra_output_lines <- c(extra_output_lines, paste0("- ", label, " component GeoTIFF: ", fmt_chr(result$paths[[p]])))
  }
  if (!is.null(result$paths$multi_ens_disagreement_tif)) {
    extra_output_lines <- c(extra_output_lines, paste0("- Ensemble disagreement GeoTIFF: ", fmt_chr(result$paths$multi_ens_disagreement_tif)))
  }
  future_lines <- character()
  if (!is.null(result$future)) {
    future_lines <- c(
      "", "Future projection",
      paste0("- Scenario label: ", fmt_chr(result$config$future_label, "Future climate")),
      paste0("- Future climate directory: ", fmt_chr(result$config$future_worldclim_dir)),
      paste0("- Mean future suitability: ", fmt_num(result$future$summary$mean, 3)),
      paste0("- Cells above threshold ", fmt_num(result$future$summary$threshold, 2), ": ", fmt_num(result$future$summary$cells_above_threshold))
    )
    if (!is.null(result$future$mess$pct_extrapolation)) {
      future_lines <- c(
        future_lines,
        paste0(
          "- ", sprintf("%.1f", result$future$mess$pct_extrapolation * 100),
          "% of projected cells lie outside training envelope on at least one variable."
        )
      )
    }
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
    paste0("- Soil enabled: ", fmt_bool(result$config$use_soil), if (isTRUE(result$config$use_soil)) paste0(" (", fmt_chr(result$config$selected_soil_vars), " at ", fmt_chr(result$config$selected_soil_depths), ")") else ""),
    paste0("- Training extent: ", fmt_extent(result$config$training_extent)),
    paste0("- Projection extent: ", fmt_extent(result$config$projection_extent)),
    "", "Cleaned occurrence data",
    paste0("- Valid records: ", fmt_num(nrow(result$occurrence))),
    paste0("- Sources: ", fmt_num(length(result$source_counts))),
    paste0("- Removed invalid coordinates: ", fmt_num(result$cleaning$removed_bad_coordinates)),
    paste0("- Removed duplicate records: ", fmt_num(result$cleaning$removed_duplicates)),
    "", "Model",
    paste0("- Method: ", model_method),
    "- Background sampling: complete covariate cells; presence-cell overlap excluded where raster cells are available",
    paste0("- Observation records used: ", fmt_num(result$metrics$presence_records)),
    paste0("- Background points used: ", fmt_num(result$metrics$background_points)),
    paste0("- Requested background points: ", fmt_num(result$config$background_n)),
    paste0("- CPU cores requested/used: ", fmt_num(result$metrics$n_cores)),
    paste0("- Cross-validation AUC: ", auc_text),
    if (!is.null(result$esm_config)) {
      esm <- result$esm_config
      c(
        "",
        "Ensembles of Small Models (ESM)",
        paste0("- Algorithm: ", esm$algorithm),
        paste0("- Covariates: ", esm$n_vars, " -> ", esm$n_pairs_total, " bivariate pairs"),
        paste0(
          "- Pairs used: ", esm$n_pairs_used,
          if (esm$n_pairs_dropped > 0) paste0(" (dropped: ", esm$n_pairs_dropped, " with AUC < ", esm$min_auc, ")") else ""
        ),
        paste0("- Runs: ", esm$n_runs, " | Train split: ", esm$data_split, "%"),
        paste0(
          "- Method: Lomba et al. (2010) Biol. Conserv. 143:2647-2657; ",
          "Breiner et al. (2015) Methods Ecol. Evol. 6:1210-1218; ",
          "Breiner et al. (2018) Methods Ecol. Evol. 9:802-808"
        )
      )
    } else {
      character()
    },
    if (!is.null(result$variable_importance) && is.data.frame(result$variable_importance) && nrow(result$variable_importance) > 0) {
      imp <- result$variable_importance
      top5 <- head(imp, 5)
      c(
        "",
        "Variable importance",
        paste0("- Method: permutation (AUC drop, ", getOption("sdm.n_perm", sdm_default_n_perm), " permutations)"),
        paste0("- Baseline AUC: ", sprintf("%.4f", imp$baseline[1])),
        "",
        "Top 5 variables:",
        paste0("  ", seq_len(nrow(top5)), ". ", top5$variable, ": ", sprintf("%.3f", top5$importance), " (AUC drop)")
      )
    } else {
      character()
    },
    if (!is.null(result$response_curves) && length(result$response_curves) > 0) {
      c(
        "",
        paste0("Response curves: ", length(result$response_curves), " covariates analysed"),
        paste0("File: response_curves_combined.png")
      )
    } else {
      character()
    },
    "", "Projection summary",
    paste0("- Valid projected cells: ", fmt_num(result$summary$cell_count)),
    paste0("- Mean suitability: ", fmt_num(result$summary$mean, 3)),
    paste0("- Median suitability: ", fmt_num(result$summary$median, 3)),
    paste0("- Maximum suitability: ", fmt_num(result$summary$max, 3)),
    paste0("- Cells above threshold ", fmt_num(result$summary$threshold, 2), ": ", fmt_num(result$summary$cells_above_threshold), " (", percent_text, ")"),
    paste0("- Estimated high-suitability area (km2): ", fmt_num(result$summary$high_risk_area_km2),
      if (finite_one(result$summary$high_risk_area_uncertainty_km2) && result$summary$high_risk_area_uncertainty_km2 > 0) {
        paste0(" +/- ", fmt_num(result$summary$high_risk_area_uncertainty_km2, 0),
          " (95% CI: ", fmt_num(result$summary$high_risk_area_ci95_lower, 0), " - ",
          fmt_num(result$summary$high_risk_area_ci95_upper, 0), ")")
      } else ""
    ),
    if (!is.null(result$metrics$projection)) {
      pm <- result$metrics$projection
      proj_cbi_text <- if (finite_one(pm$projection_cbi)) sprintf("%.3f", pm$projection_cbi) else "not available"
      c(
        "",
        "Projection region validation (cross-region biosecurity assessment)",
        paste0("- Projection CBI (environmental analog): ", proj_cbi_text, if (!is.null(pm$risk_level)) paste0(" [", pm$risk_level, "]") else ""),
        "  - pCBI interpretation: pCBI >0.7 = HIGH risk (projection region has similar niche to training region)",
        "  - pCBI 0.4-0.7 = MEDIUM risk | pCBI <0.4 = LOW risk (environmentally dissimilar)",
        paste0("- Threshold (", fmt_num(result$config$threshold, 2), ") excess: ", sprintf("%.1f", pm$pct_above_threshold), "% of projection area above threshold"),
        paste0("- Mean suitability in projection region: ", sprintf("%.3f", pm$mean_projection_suitability)),
        if (!is.null(pm$validation)) {
          validation <- pm$validation
          c(
            paste0("- Validation occurrences (user-provided): ", fmt_num(validation$n_provided), " total | ", fmt_num(validation$n_valid), " with coordinates"),
            paste0("- Points exceeding threshold: ", fmt_num(validation$n_exceeding_threshold), " (", sprintf("%.1f", validation$pct_exceeding), "%)"),
            paste0("- Mean suitability at validation points: ", sprintf("%.3f", validation$mean_suitability))
          )
        } else {
          character()
        }
      )
    } else {
      character()
    },
    future_lines,
    "", "Outputs",
    paste0("- Suitability GeoTIFF: ", fmt_chr(result$paths$tif)),
    paste0("- Suitability PNG: ", fmt_chr(result$paths$png)),
    extra_output_lines
  )
  writeLines(lines, con = path)
  invisible(path)
}
