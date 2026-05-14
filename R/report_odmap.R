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
    if (is.null(x) || (length(x) == 0) || all(is.na(x))) return(default)
    if (inherits(x, "character") && !nzchar(x[1])) return(default)
    x
  }

  .fmt_num <- function(x, digits = 3, default = "Not available") {
    if (is.null(x) || length(x) == 0 || !is.finite(as.numeric(x[1]))) return(default)
    fmt_str <- if (digits == 0) "%.0f" else paste0("%.", digits, "f")
    sprintf(fmt_str, as.numeric(x[1]))
  }

  .fmt_aggr <- function(x, default = "Not available") {
    if (is.null(x) || length(x) == 0) return(default)
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
  algorithm_label <- .fmt(result$model_label, "GLM / Logistic regression")

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
  cleaning_steps <- "lon/lat bounds check, duplicate removal, NA covariate removal"
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
    auc_text <- paste0(sprintf("%.3f", auc_mean),
                      if (!is.null(auc_sd) && is.finite(auc_sd)) {
                        paste0(" +/- ", sprintf("%.3f", auc_sd))
                      } else {
                        ""
                      })
  } else {
    auc_text <- "Not computed"
  }

  tss_mean <- .get_cv("tss_mean")
  tss_sd <- .get_cv("tss_sd")
  if (!is.null(tss_mean) && is.finite(tss_mean)) {
    tss_text <- paste0(sprintf("%.3f", tss_mean),
                      if (!is.null(tss_sd) && is.finite(tss_sd)) {
                        paste0(" +/- ", sprintf("%.3f", tss_sd))
                      } else {
                        ""
                      })
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
    "",
    "# Model",
    paste0("algorithm,", algorithm),
    paste0("algorithm_settings,", algorithm_settings),
    paste0("variable_selection,", variable_selection),
    paste0("threshold_rule,", threshold_rule),
    if (!is.null(result$esm_config)) {
      esm <- result$esm_config
      c(paste0("esm_algorithm,", esm$algorithm),
        paste0("esm_pairs_total,", .fmt_num(esm$n_pairs_total, 0)),
        paste0("esm_pairs_used,", .fmt_num(esm$n_pairs_used, 0)),
        paste0("esm_pairs_dropped,", .fmt_num(esm$n_pairs_dropped, 0)),
        paste0("esm_min_auc,", esm$min_auc))
    } else character(),
    "",
    "# Assessment",
    paste0("CV_strategy,", cv_strategy),
    paste0("AUC,", auc_text),
    paste0("TSS,", tss_text),
    paste0("sensitivity,", sensitivity_text),
    paste0("specificity,", specificity_text),
    paste0("Boyce_index,", boyce_index),
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
      "",
      "## Model",
      paste0("- **Algorithm:** ", algorithm),
      paste0("- **Algorithm settings:** ", algorithm_settings),
      paste0("- **Variable selection:** ", variable_selection),
      paste0("- **Threshold rule:** ", threshold_rule),
      if (!is.null(result$esm_config)) {
        esm <- result$esm_config
        c(paste0("- **ESM strategy:** ", esm$n_pairs_used, " bivariate ", toupper(esm$algorithm),
                 " models (AUC-weighted; ", esm$n_pairs_dropped, " dropped, AUC < ", esm$min_auc, ")"))
      } else character(),
      "",
      "## Assessment",
      paste0("- **CV strategy:** ", cv_strategy),
      paste0("- **AUC:** ", auc_text),
      paste0("- **TSS:** ", tss_text),
      paste0("- **Sensitivity:** ", sensitivity_text),
      paste0("- **Specificity:** ", specificity_text),
      paste0("- **Boyce index:** ", boyce_index),
      "",
      "## Prediction",
      paste0("- **Projection extent:** ", projection_extent_text),
      paste0("- **Mean suitability:** ", mean_suitability),
      paste0("- **Threshold area:** ", threshold_area),
      paste0("- **Future projection:** ", future_projection_text),
      paste0("- **Extrapolation diagnostics:** ", extrapolation_diagnostics)
    )

    tryCatch({
      writeLines(md_lines, con = path_md)
    }, error = function(e) {
      warning("Failed to write Markdown report: ", conditionMessage(e), call. = FALSE)
    })
  }

  invisible(path_csv)
}