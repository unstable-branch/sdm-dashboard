## Helper functions for extracting summary information from biomod2 results

#' Extract occurrence and background counts, and simple CV metrics from a biomod2 object
#'
#' @param biomod_mod The object returned by BIOMOD_Modeling
#' @return A list with elements:
#'   occurrence_used, background_points, auc_mean, auc_sd, cv_folds
#' @export
extract_biomod_metrics <- function(biomod_mod) {
  eval_tbl <- tryCatch({
    biomod_mod@models.evaluation@data
  }, error = function(e) {
    tryCatch({
      biomod_mod@evaluation@eval
    }, error = function(e2) NULL)
  })
  if (is.null(eval_tbl) || nrow(eval_tbl) == 0) {
    return(list(
      occurrence_used = NA_integer_,
      background_points = NA_integer_,
      auc_mean = NA_real_,
      auc_sd = NA_real_,
      cv_folds = NA_integer_
    ))
  }
  auc_vals <- eval_tbl$AUC
  list(
    occurrence_used = as.integer(biomod_mod@formated.input.data@species[[1]]$pa),
    background_points = as.integer(biomod_mod@formated.input.data@nbg),
    auc_mean = mean(auc_vals, na.rm = TRUE),
    auc_sd = sd(auc_vals, na.rm = TRUE),
    cv_folds = length(auc_vals)
  )
}

#' Combine biomod2 and DNN predictions into ensemble
#'
#' @param biomod_pred SpatRaster with biomod2 ensemble prediction (0-1)
#' @param dnn_results Output from run_dnn() or single DNN SpatRaster
#' @param method Ensemble method: "weighted_average", "simple_mean", "consensus_binary"
#' @param dnn_weight Weight for DNN component (0-1), only used for weighted_average
#' @param threshold Threshold for binary predictions (default 0.5)
#' @return SpatRaster with combined ensemble prediction
#' @export
combine_ensemble <- function(biomod_pred, dnn_results, method = "weighted_average",
                              dnn_weight = 0.3, threshold = 0.5) {

  # Handle different dnn_results formats
  if (is.null(dnn_results)) {
    return(biomod_pred)
  }

  if (inherits(dnn_results, "SpatRaster")) {
    dnn_pred <- dnn_results
  } else if (is.list(dnn_results) && !is.null(dnn_results$results)) {
    # Multiple DNN models - average them
    dnn_preds <- lapply(dnn_results$results, function(x) x$prediction)
    dnn_pred <- terra::app(terra::rast(dnn_preds), fun = mean, na.rm = TRUE)
  } else if (is.list(dnn_results) && !is.null(dnn_results$prediction)) {
    # Single DNN result
    dnn_pred <- dnn_results$prediction
  } else {
    stop("Invalid dnn_results format")
  }

  # Align extents if needed
  if (!terra::ext(biomod_pred) == terra::ext(dnn_pred)) {
    dnn_pred <- terra::resample(dnn_pred, biomod_pred, method = "bilinear")
  }

  # Ensure same resolution
  if (terra::res(biomod_pred)[1] != terra::res(dnn_pred)[1]) {
    dnn_pred <- terra::resample(dnn_pred, biomod_pred, method = "bilinear")
  }

  # Combine based on method
  combined <- switch(method,
    "weighted_average" = {
      w_trad <- 1 - dnn_weight
      w_dnn <- dnn_weight
      biomod_pred * w_trad + dnn_pred * w_dnn
    },
    "simple_mean" = {
      (biomod_pred + dnn_pred) / 2
    },
    "consensus_binary" = {
      biomod_binary <- biomod_pred >= threshold
      dnn_binary <- dnn_pred >= threshold
      # Majority vote (both must agree for presence)
      terra::app(c(biomod_binary, dnn_binary), fun = function(x) {
        sum(x, na.rm = TRUE) >= 1
      })
    },
    stop("Unknown ensemble method: ", method)
  )

  combined
}

#' Compute AUC-weighted ensemble weights from model metrics
#'
#' @param metrics_list Named list of metric objects (each with AUC element)
#' @return Named vector of weights summing to 1
#' @export
compute_ensemble_weights <- function(metrics_list) {
  aucs <- sapply(metrics_list, function(m) {
    if (is.list(m) && !is.null(m$AUC)) m$AUC
    else if (is.numeric(m)) m
    else NA_real_
  })

  aucs[is.na(aucs)] <- 0.5  # Replace NA with baseline

  # Weight = AUC - 0.5 (baseline), normalized
  weights <- aucs - 0.5
  weights[weights < 0] <- 0  # No negative weights

  if (sum(weights) > 0) {
    weights / sum(weights)
  } else {
    rep(1 / length(weights), length(weights))
  }
}

#' Get ensemble metrics from combined prediction
#'
#' @param ensemble_pred SpatRaster with ensemble prediction
#' @param test_data Optional test data for evaluation
#' @param threshold Threshold for binary classification
#' @return List with ensemble metrics
#' @export
get_ensemble_metrics <- function(ensemble_pred, test_data = NULL, threshold = 0.5) {
  result <- list(
    method = "ensemble",
    prediction_available = TRUE
  )

  if (!is.null(test_data) && !is.null(test_data$y_true)) {
    preds <- terra::extract(ensemble_pred, test_data$xy_coords)
    preds <- preds[, 1]

    pred_binary <- ifelse(preds >= threshold, 1, 0)
    y_true <- test_data$y_true

    tp <- sum(pred_binary == 1 & y_true == 1)
    tn <- sum(pred_binary == 0 & y_true == 0)
    fp <- sum(pred_binary == 1 & y_true == 0)
    fn <- sum(pred_binary == 0 & y_true == 1)

    result$sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else 0
    result$specificity <- if ((tn + fp) > 0) tn / (tn + fp) else 0
    result$TSS <- result$sensitivity + result$specificity - 1
  }

  result
}
