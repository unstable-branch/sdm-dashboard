# Ensemble permutation importance across weighted component models.
# Weighted by model AUC/TSS to account for model quality differences.

#' Compute weighted ensemble variable importance.
#'
#' Aggregates permutation importance from each component model,
#' weighted by the component's AUC in the ensemble.
#'
#' @param components list of component fit results
#' @param weights named numeric vector of ensemble weights
#' @param methods named character vector of model method IDs
#' @param env_train SpatRaster of training environment
#' @param log_fun Optional log function
#' @return data.frame with variable, weighted_importance, model_contribution
compute_ensemble_importance <- function(components, weights, methods,
                                        env_train = NULL, log_fun = NULL) {
  log_message(log_fun, "Computing ensemble variable importance")

  # Collect per-component importance
  component_imp <- list()
  all_vars <- character()

  for (m in names(components)) {
    comp <- components[[m]]
    method <- methods[m]

    imp <- NULL
    if (!is.null(comp$variable_importance) && is.data.frame(comp$variable_importance)) {
      imp <- comp$variable_importance
      if (!"variable" %in% names(imp)) imp <- NULL
    }

    if (is.null(imp) && !is.null(comp$fit) && !is.null(comp$fit$variable_importance)) {
      imp <- comp$fit$variable_importance
    }

    if (!is.null(imp) && nrow(imp) > 0) {
      # Normalise importance to 0-1 within each model
      if ("importance" %in% names(imp)) {
        max_imp <- max(imp$importance, na.rm = TRUE)
        if (is.finite(max_imp) && max_imp > 0) {
          imp$importance_norm <- imp$importance / max_imp
        } else {
          imp$importance_norm <- 1
        }
      } else {
        next
      }

      component_imp[[m]] <- imp[, c("variable", "importance_norm")]
      all_vars <- union(all_vars, imp$variable)
    }
  }

  if (length(component_imp) == 0 || length(all_vars) == 0) {
    log_message(log_fun, "No component models have variable importance; returning NULL")
    return(NULL)
  }

  # Weighted average across components
  total_weight <- sum(weights[names(component_imp)], na.rm = TRUE)
  if (total_weight == 0) total_weight <- 1

  result <- data.frame(
    variable = all_vars,
    weighted_importance = 0,
    n_models = 0L,
    model_contribution = "",
    stringsAsFactors = FALSE
  )

  for (i in seq_along(all_vars)) {
    var <- all_vars[i]
    weighted_sum <- 0
    contributing <- character()

    for (m in names(component_imp)) {
      imp <- component_imp[[m]]
      idx <- which(imp$variable == var)
      if (length(idx) == 0) next

      w <- weights[m]
      if (is.na(w) || !is.finite(w)) w <- 1 / length(component_imp)

      weighted_sum <- weighted_sum + imp$importance_norm[idx[1]] * w
      contributing <- c(contributing, m)
    }

    result$weighted_importance[i] <- weighted_sum / total_weight
    result$n_models[i] <- length(contributing)
    result$model_contribution[i] <- paste(contributing, collapse = ", ")
  }

  # Sort by importance (descending)
  result <- result[order(result$weighted_importance, decreasing = TRUE), ]
  rownames(result) <- NULL

  log_message(log_fun, "  Ensemble importance computed for ", nrow(result), " variables across ",
    length(component_imp), " models")

  result
}
