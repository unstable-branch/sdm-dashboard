# ODMAP Report Generator.
# Produces machine-readable CSV and human-readable Markdown reports
# following the ODMAP (Overview/Data/Model/Assessment/Prediction) standard.
# See Zurell et al. 2020, Ecography 43:1261-1277.

#' Write ODMAP Report
#'
#' @param result Output from run_fast_sdm() via fit_sdm_model()
#' @param path_csv Path to write key/value CSV report
#' @param path_md Optional path to write human-readable Markdown report
#' @return Invisible NULL (writes files as side effect)
#' @examples
#' \dontrun{
#' write_odmap_report(result, "odmap.csv", "odmap.md")
#' }
write_odmap_report <- function(result, path_csv, path_md = NULL) {
  stopifnot(is.list(result))
  stopifnot(is.character(path_csv), length(path_csv) == 1)

  .fmt <- function(x, default = "Not available") {
    if (is.null(x) || (length(x) == 0) || all(is.na(x))) {
      return(default)
    }
    if (inherits(x, "character") && !nzchar(x[1])) {
      return(default)
    }
    x
  }

  .fmt_num <- function(x, digits = 3, default = "Not available") {
    if (is.null(x) || length(x) == 0 || !is.finite(as.numeric(x[1]))) {
      return(default)
    }
    fmt_str <- if (digits == 0) "%.0f" else paste0("%.", digits, "f")
    sprintf(fmt_str, as.numeric(x[1]))
  }

  .fmt_aggr <- function(x, default = "Not available") {
    if (is.null(x) || length(x) == 0) {
      return(default)
    }
    paste(x, collapse = ", ")
  }

  .get_config <- function(.name, .default = NULL) {
    if (!is.null(result$config) && .name %in% names(result$config)) {
      result$config[[.name]]
    } else {
      .default
    }
  }

  .get_cv <- function(.name, .default = NULL) {
    if (!is.null(result$cv) && .name %in% names(result$cv)) {
      result$cv[[.name]]
    } else {
      .default
    }
  }

  .get_metrics <- function(.name, .default = NULL) {
    if (!is.null(result$metrics) && .name %in% names(result$metrics)) {
      result$metrics[[.name]]
    } else {
      .default
    }
  }

  authorship <- .get_config("sdm_author", "Anonymous")
  objective <- .fmt(.get_config("species"), "Species distribution model")
  target_output <- "Suitability raster for presence/background SDM"
  hypotheses <- ""
  algorithm <- .fmt(.get_config("model_id"), "glm")
  algorithm_label <- .fmt(.get_config("model_label"), "GLM / Logistic regression")

  model_method <- if (!is.null(result$model_method)) {
    result$model_method
  } else {
    "Fast presence/background GLM with balanced class weights"
  }

  assumptions <- paste0(algorithm_label, " assumes presence locations are representative")

  taxon <- .fmt(.get_config("species"), "Not specified")
  gbif_doi <- .get_config("gbif_doi")
  occurrence_source <- if (!is.null(gbif_doi) && !is.na(gbif_doi) && nzchar(gbif_doi)) {
    paste0("GBIF (", gbif_doi, ")")
  } else {
    .fmt(.get_config("occurrence_source"), "uploaded CSV")
  }
  raw_n <- .get_config("occurrence_raw_n")
  if (is.null(raw_n)) {
    raw_n <- nrow(result$occurrence)
  }
  cleaned_n <- nrow(result$occurrence_used)
  cleaning_parts <- character(0)
  if (!is.null(result$cleaning)) {
    cl <- result$cleaning
    if (!is.null(cl$removed_bad_coordinates) && cl$removed_bad_coordinates > 0) {
      cleaning_parts <- c(cleaning_parts, paste0(cl$removed_bad_coordinates, " invalid coordinates"))
    }
    if (!is.null(cl$removed_duplicates) && cl$removed_duplicates > 0) {
      cleaning_parts <- c(cleaning_parts, paste0(cl$removed_duplicates, " duplicates"))
    }
    if (!is.null(cl$original_rows) && !is.null(cleaned_n) && cl$original_rows > cleaned_n) {
      cleaning_parts <- c(cleaning_parts, paste0(cl$original_rows - cleaned_n, " missing covariates"))
    }
    if (length(cleaning_parts) == 0) cleaning_parts <- "none"
  } else {
    cleaning_parts <- "not available"
  }
  cleaning_steps <- paste(cleaning_parts, collapse = ", ")
  extent <- .get_config("projection_extent")
  spatial_extent <- if (!is.null(extent)) .fmt_aggr(extent) else "Not available"
  aggregation_factor <- .get_config("aggregation_factor", 1)
  spatial_resolution <- paste0(aggregation_factor, " arc-min")

  covariates_used <- if (!is.null(result$covariates)) {
    result$covariates
  } else if (!is.null(result$environment$names)) {
    result$environment$names
  } else {
    character()
  }
  predictors <- .fmt_aggr(covariates_used, "Not available")
  predictor_source <- "WorldClim 2.1 (Fick & Hijmans 2017)"

  thinning_method <- .get_config("thinning_method", "cell thinning")
  sampling_bias_correction <- .fmt(thinning_method, "cell thinning")

  bias_method <- .get_config("bias_method", "uniform")
  background_strategy <- switch(bias_method,
    "uniform" = "uniform random (target area)",
    "target_group" = "target-group bias correction",
    "thickened" = "thickened presence bias correction",
    bias_method
  )

  algorithm_settings <- model_method

  biovars_selected <- .get_config("selected_biovars")
  variable_selection <- if (!is.null(biovars_selected)) {
    paste0("BIO", paste(biovars_selected, collapse = ", BIO"))
  } else {
    .fmt_aggr(covariates_used)
  }

  threshold_val <- .get_config("threshold", 0.5)
  threshold_rule <- paste0("Fixed threshold = ", threshold_val)

  cv_strategy <- .get_cv("strategy", "random")
  cv_k <- .get_cv("k", 3)

  auc_mean <- .get_cv("auc_mean")
  auc_sd <- .get_cv("auc_sd")
  if (!is.null(auc_mean) && is.finite(auc_mean)) {
    auc_text <- paste0(
      sprintf("%.3f", auc_mean),
      if (!is.null(auc_sd) && is.finite(auc_sd)) {
        paste0(" +/- ", sprintf("%.3f", auc_sd))
      } else {
        ""
      }
    )
  } else {
    auc_text <- "Not computed"
  }

  tss_mean <- .get_cv("tss_mean")
  tss_sd <- .get_cv("tss_sd")
  if (!is.null(tss_mean) && is.finite(tss_mean)) {
    tss_text <- paste0(
      sprintf("%.3f", tss_mean),
      if (!is.null(tss_sd) && is.finite(tss_sd)) {
        paste0(" +/- ", sprintf("%.3f", tss_sd))
      } else {
        ""
      }
    )
  } else {
    tss_text <- "Not computed"
  }

  sensitivity <- .get_cv("sensitivity_mean")
  sensitivity_text <- if (!is.null(sensitivity) && is.finite(sensitivity)) {
    sprintf("%.3f", sensitivity)
  } else {
    "Not computed"
  }

  specificity <- .get_cv("specificity_mean")
  specificity_text <- if (!is.null(specificity) && is.finite(specificity)) {
    sprintf("%.3f", specificity)
  } else {
    "Not computed"
  }

  cbi <- .get_metrics("cbi")
  boyce_index <- if (!is.null(cbi) && is.finite(cbi)) {
    sprintf("%.3f", cbi)
  } else {
    "not computed"
  }

  projection_extent <- .get_config("projection_extent")
  projection_extent_text <- if (!is.null(projection_extent)) {
    .fmt_aggr(projection_extent)
  } else {
    "Not available"
  }

  mean_suitability <- "Not computed"
  if (!is.null(result$suitability)) {
    r <- result$suitability
    if (inherits(r, "SpatRaster")) {
      global_mean <- tryCatch(terra::global(r, "mean", na.rm = TRUE), error = function(e) NULL)
      if (!is.null(global_mean) && is.finite(global_mean$mean)) {
        mean_suitability <- sprintf("%.3f", global_mean$mean)
      }
    }
  }

  threshold_area <- "NA"
  future_projection <- .get_config("future_projection", FALSE)
  if (isTRUE(future_projection)) {
    future_label <- .get_config("future_label", "Future climate")
    future_gcm <- .get_config("future_gcm", "Unknown GCM")
    future_ssp <- .get_config("future_ssp", "Unknown SSP")
    future_projection_text <- paste(future_label, future_gcm, future_ssp)
  } else {
    future_projection_text <- "current conditions only"
  }

  extrapolation_diagnostics <- "not computed"
  if (!is.null(result$mess)) {
    extrapolation_diagnostics <- "MESS computed"
  }

  csv_lines <- c(
    "# Overview",
    paste0("authorship,", authorship),
    paste0("objective,", objective),
    paste0("target_output,", target_output),
    paste0("hypotheses,", hypotheses),
    paste0("assumptions,", assumptions),
    "",
    "# Data",
    paste0("taxon,", taxon),
    paste0("occurrence_source,", occurrence_source),
    paste0("raw_N,", .fmt_num(raw_n, 0)),
    paste0("cleaned_N,", .fmt_num(cleaned_n, 0)),
    paste0("cleaning_steps,", cleaning_steps),
    paste0("spatial_extent,", spatial_extent),
    paste0("spatial_resolution,", spatial_resolution),
    paste0("predictors,", predictors),
    paste0("predictor_source,", predictor_source),
    paste0("sampling_bias_correction,", sampling_bias_correction),
    paste0("background_strategy,", background_strategy),
    "",
    "# Model",
    paste0("algorithm,", algorithm),
    paste0("algorithm_settings,", algorithm_settings),
    paste0("variable_selection,", variable_selection),
    paste0("threshold_rule,", threshold_rule),
    if (!is.null(result$esm_config)) {
      esm <- result$esm_config
      c(
        paste0("esm_algorithm,", esm$algorithm),
        paste0("esm_pairs_total,", .fmt_num(esm$n_pairs_total, 0)),
        paste0("esm_pairs_used,", .fmt_num(esm$n_pairs_used, 0)),
        paste0("esm_pairs_dropped,", .fmt_num(esm$n_pairs_dropped, 0)),
        paste0("esm_min_auc,", esm$min_auc)
      )
    } else {
      character()
    },
    "",
    if (identical(.get_config("model_id"), "multi_ensemble")) {
      ens <- result$model
      cv_df <- result$cv$component_metrics
      n_total <- length(ens$components)
      n_succeeded <- nrow(cv_df)
      n_failed <- n_total - n_succeeded
      weight_lines <- if (!is.null(ens$weights) && length(ens$weights) > 0) {
        paste0("ensemble_weight,", paste(names(ens$weights), sprintf("%.4f", ens$weights), sep = "=", collapse = "; "))
      } else {
        character()
      }
      disagreement_tif <- result$paths$multi_ens_sd_tif %||% NA_character_
      c(
        "# Ensemble",
        paste0("ensemble_components_attempted,", n_total),
        paste0("ensemble_components_succeeded,", n_succeeded),
        paste0("ensemble_components_failed,", n_failed),
        paste0("ensemble_disagreement_raster,", disagreement_tif),
        weight_lines,
        if (!is.null(cv_df) && nrow(cv_df) > 0) {
          comp_header <- c(paste0("ensemble_component,", paste(names(cv_df), collapse = ",")))
          comp_rows <- apply(cv_df, 1, function(row) {
            paste0("ensemble_component,", paste(as.character(row), collapse = ","))
          })
          c(comp_header, comp_rows)
        } else {
          character()
        }
      )
    } else {
      character()
    },
    "",
    "# Assessment",
    paste0("CV_strategy,", cv_strategy),
    paste0("AUC,", auc_text),
    paste0("TSS,", tss_text),
    paste0("sensitivity,", sensitivity_text),
    paste0("specificity,", specificity_text),
    paste0("Boyce_index,", boyce_index),
    if (!is.null(result$variable_importance) && is.data.frame(result$variable_importance) && nrow(result$variable_importance) > 0) {
      imp <- result$variable_importance
      c(
        paste0("importance_method,", "permutation"),
        paste0("n_variables,", nrow(imp)),
        paste0("top_variable,", imp$variable[1]),
        paste0("top_importance,", sprintf("%.4f", imp$importance[1])),
        paste0("baseline_auc,", sprintf("%.4f", imp$baseline[1])),
        paste0("importance_", imp$variable, ",", sprintf("%.4f", imp$importance), collapse = "\n")
      )
    } else {
      character()
    },
    "",
    if (!is.null(result$response_curves) && length(result$response_curves) > 0) {
      paste0("response_curves,", length(result$response_curves), " covariates analysed")
    } else {
      character()
    },
    "",
    "# Prediction",
    paste0("projection_extent,", projection_extent_text),
    paste0("mean_suitability,", mean_suitability),
    paste0("threshold_area,", threshold_area),
    paste0("future_projection,", future_projection_text),
    paste0("extrapolation_diagnostics,", extrapolation_diagnostics)
  )

  writeLines(csv_lines, con = path_csv)

  if (!is.null(path_md) && nzchar(path_md)) {
    md_lines <- c(
      "# ODMAP Report",
      "",
      "## Overview",
      paste0("- **Author:** ", authorship),
      paste0("- **Objective:** ", objective),
      paste0("- **Target output:** ", target_output),
      paste0("- **Hypotheses:** ", ifelse(nzchar(hypotheses), hypotheses, "(none)")),
      paste0("- **Assumptions:** ", assumptions),
      "",
      "## Data",
      paste0("- **Taxon:** ", taxon),
      paste0("- **Occurrence source:** ", occurrence_source),
      paste0("- **Raw N (before cleaning):** ", .fmt_num(raw_n, 0)),
      paste0("- **Cleaned N:** ", .fmt_num(cleaned_n, 0)),
      paste0("- **Cleaning steps:** ", cleaning_steps),
      paste0("- **Spatial extent:** ", spatial_extent),
      paste0("- **Spatial resolution:** ", spatial_resolution),
      paste0("- **Predictors:** ", predictors),
      paste0("- **Predictor source:** ", predictor_source),
      paste0("- **Sampling bias correction:** ", sampling_bias_correction),
      paste0("- **Background strategy:** ", background_strategy),
      "",
      "## Model",
      paste0("- **Algorithm:** ", algorithm),
      paste0("- **Algorithm settings:** ", algorithm_settings),
      paste0("- **Variable selection:** ", variable_selection),
      paste0("- **Threshold rule:** ", threshold_rule),
      if (!is.null(result$esm_config)) {
        esm <- result$esm_config
        c(paste0(
          "- **ESM strategy:** ", esm$n_pairs_used, " bivariate ", toupper(esm$algorithm),
          " models (AUC-weighted; ", esm$n_pairs_dropped, " dropped, AUC < ", esm$min_auc, ")"
        ))
      } else {
        character()
      },
      "",
      if (identical(.get_config("model_id"), "multi_ensemble")) {
        ens <- result$model
        cv_df <- result$cv$component_metrics
        n_total <- length(ens$components)
        n_succeeded <- nrow(cv_df)
        n_failed <- n_total - n_succeeded
        disagreement_tif <- result$paths$multi_ens_sd_tif %||% NA_character_
        weight_lines <- if (!is.null(ens$weights) && length(ens$weights) > 0) {
          paste0("- **Component weights:** ", paste(names(ens$weights), sprintf("%.4f", ens$weights), sep = " = ", collapse = ", "))
        } else {
          character()
        }
        comp_rows <- if (!is.null(cv_df) && nrow(cv_df) > 0) {
          paste0(
            "- **", cv_df$model_id, ":** AUC = ", sprintf("%.3f", cv_df$auc_mean),
            ", TSS = ", sprintf("%.3f", cv_df$tss_mean),
            ", weight = ", sprintf("%.4f", cv_df$weight)
          )
        } else {
          character()
        }
        c(
          "## Ensemble",
          paste0("- **Components attempted:** ", n_total),
          paste0("- **Components succeeded:** ", n_succeeded),
          paste0("- **Components failed:** ", n_failed),
          paste0("- **Disagreement raster:** ", disagreement_tif),
          weight_lines,
          comp_rows,
          ""
        )
      } else {
        character()
      },
      "## Assessment",
      paste0("- **CV strategy:** ", cv_strategy),
      paste0("- **AUC:** ", auc_text),
      paste0("- **TSS:** ", tss_text),
      paste0("- **Sensitivity:** ", sensitivity_text),
      paste0("- **Specificity:** ", specificity_text),
      paste0("- **Boyce index:** ", boyce_index),
      if (!is.null(result$variable_importance) && is.data.frame(result$variable_importance) && nrow(result$variable_importance) > 0) {
        imp <- result$variable_importance
        top5 <- head(imp, 5)
        top5_text <- paste(
          sprintf("    %d. **%s**: %.3f (AUC drop)", seq_len(nrow(top5)), top5$variable, top5$importance),
          collapse = "\n"
        )
        c(
          paste0("- **Variable importance:** Top 5 by permutation"),
          top5_text,
          paste0("- **Baseline AUC:** ", sprintf("%.4f", imp$baseline[1]))
        )
      } else {
        character()
      },
      "",
      "## Prediction",
      paste0("- **Projection extent:** ", projection_extent_text),
      paste0("- **Mean suitability:** ", mean_suitability),
        paste0("- **Threshold area:** ", threshold_area,
          if (!is.null(result$summary) && is.finite(result$summary$high_risk_area_uncertainty_km2 %||% NA_real_) && result$summary$high_risk_area_uncertainty_km2 > 0) {
            paste0(" (", .fmt_num(result$summary$high_risk_area_ci95_lower, 0),
              " - ", .fmt_num(result$summary$high_risk_area_ci95_upper, 0), " km2, 95% CI)")
          } else ""),
      paste0("- **Future projection:** ", future_projection_text),
      paste0("- **Extrapolation diagnostics:** ", extrapolation_diagnostics)
    )

    tryCatch(
      {
        writeLines(md_lines, con = path_md)
      },
      error = function(e) {
        warning("Failed to write Markdown report: ", conditionMessage(e), call. = FALSE)
      }
    )
  }

  invisible(path_csv)
}
