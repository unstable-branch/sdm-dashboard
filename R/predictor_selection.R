# VIF-based predictor selection for reducing multicollinearity in SDM models.

compute_vif <- function(values) {
  if (!is.data.frame(values) && !is.matrix(values)) {
    stop("values must be a data.frame or matrix", call. = FALSE)
  }

  if (ncol(values) < 2) {
    return(numeric(0))
  }

  cor_matrix <- tryCatch(
    cor(values, use = "pairwise.complete.obs"),
    error = function(e) {
      stop("Cannot compute correlation matrix: ", conditionMessage(e), call. = FALSE)
    }
  )

  cor_matrix[is.na(cor_matrix)] <- 0

  diag(cor_matrix) <- 1

  det_cor <- det(cor_matrix)
  if (is.na(det_cor) || abs(det_cor) < 1e-10) {
    result <- rep(Inf, ncol(values))
    names(result) <- colnames(values)
    return(result)
  }

  cor_matrix_inv <- tryCatch(
    solve(cor_matrix),
    error = function(e) {
      result <- rep(Inf, ncol(values))
      names(result) <- colnames(values)
      return(result)
    }
  )

  vif_values <- diag(cor_matrix_inv)

  vif_values[vif_values < 1] <- 1

  vif_values[is.na(vif_values) | is.nan(vif_values)] <- Inf

  vif_values
}

select_by_vif <- function(values, threshold = 10) {
  if (!is.data.frame(values) && !is.matrix(values)) {
    stop("values must be a data.frame or matrix", call. = FALSE)
  }

  if (ncol(values) < 2) {
    return(list(
      selected = colnames(values),
      dropped = character(0),
      vif_final = 1,
      vif_history = data.frame(iteration = integer(), variable_removed = character(), max_vif = numeric())
    ))
  }

  valid_rows <- complete.cases(values)
  if (sum(valid_rows) < 10) {
    stop("Insufficient complete cases for VIF computation (need at least 10)", call. = FALSE)
  }

  values_clean <- values[valid_rows, , drop = FALSE]

  zero_var_cols <- which(vapply(values_clean, function(x) var(x, na.rm = TRUE) < 1e-10, logical(1)))
  zero_var_names <- colnames(values_clean)[zero_var_cols]
  if (length(zero_var_cols) > 0) {
    warning("Removing zero-variance variables: ", paste(zero_var_names, collapse = ", "))
    values_clean <- values_clean[, -zero_var_cols, drop = FALSE]
  }

  if (ncol(values_clean) < 2) {
    return(list(
      selected = colnames(values_clean),
      dropped = zero_var_names,
      vif_final = 1,
      vif_history = data.frame(iteration = integer(), variable_removed = character(), max_vif = numeric())
    ))
  }

  var_names <- colnames(values_clean)
  remaining_vars <- var_names
  dropped_vars <- zero_var_names
  vif_history <- data.frame(iteration = integer(), variable_removed = character(), max_vif = numeric())
  iteration <- 0

  while (length(remaining_vars) >= 2) {
    current_values <- values_clean[, remaining_vars, drop = FALSE]

    vif_values <- compute_vif(current_values)
    names(vif_values) <- remaining_vars

    max_vif <- max(vif_values, na.rm = TRUE)

    if (is.infinite(max_vif) || is.na(max_vif)) {
      inf_vars <- remaining_vars[is.infinite(vif_values) | is.na(vif_values)]
      if (length(inf_vars) > 0) {
        var_to_remove <- inf_vars[1]
      } else {
        break
      }
    } else if (max_vif <= threshold) {
      break
    } else {
      var_to_remove <- remaining_vars[which.max(vif_values)]
    }

    iteration <- iteration + 1
    vif_history <- rbind(vif_history, data.frame(
      iteration = iteration,
      variable_removed = var_to_remove,
      max_vif = max_vif
    ))

    dropped_vars <- c(dropped_vars, var_to_remove)
    remaining_vars <- remaining_vars[remaining_vars != var_to_remove]
  }

  if (length(remaining_vars) >= 1) {
    final_vif <- compute_vif(values_clean[, remaining_vars, drop = FALSE])
    vif_final <- max(final_vif, na.rm = TRUE)
    if (is.infinite(vif_final) || is.na(vif_final)) {
      vif_final <- 1
    }
  } else {
    vif_final <- 1
  }

  list(
    selected = remaining_vars,
    dropped = dropped_vars,
    vif_final = vif_final,
    vif_history = vif_history
  )
}

apply_vif_selection <- function(covariate_values, threshold = 10, log_fun = NULL) {
  if (!is.data.frame(covariate_values) && !is.matrix(covariate_values)) {
    log_message(log_fun, "VIF selection skipped: covariate data must be a data.frame or matrix")
    return(list(
      selected = colnames(covariate_values),
      dropped = character(0),
      vif_result = NULL,
      covars_selected = covariate_values
    ))
  }

  if (ncol(covariate_values) < 3) {
    log_message(log_fun, "VIF selection skipped: fewer than 3 variables")
    return(list(
      selected = colnames(covariate_values),
      dropped = character(0),
      vif_result = NULL,
      covars_selected = covariate_values
    ))
  }

  log_message(log_fun, "Running VIF collinearity reduction (threshold = ", threshold, ")...")

  vif_result <- select_by_vif(covariate_values, threshold = threshold)

  if (length(vif_result$dropped) > 0) {
    log_message(log_fun, "VIF reduction dropped: ", paste(vif_result$dropped, collapse = ", "),
                " (final VIF max = ", sprintf("%.2f", vif_result$vif_final), ")")
  } else {
    log_message(log_fun, "VIF reduction: all variables passed (max VIF = ", sprintf("%.2f", vif_result$vif_final), ")")
  }

  covars_selected <- covariate_values[, vif_result$selected, drop = FALSE]

  list(
    selected = vif_result$selected,
    dropped = vif_result$dropped,
    vif_result = vif_result,
    covars_selected = covars_selected
  )
}