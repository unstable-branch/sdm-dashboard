# Presence/background GLM fitting and diagnostics.

sample_background_points <- function(env_train_scaled, n, seed = 42, presence_xy = NULL,
                                     bias_method = c("uniform", "target_group", "thickened"),
                                     target_group_occ = NULL,
                                     thickening_distance_km = NULL) {
  bias_method <- match.arg(bias_method)
  n <- as.integer(n)
  if (is.na(n) || n < 1) n <- 100L
  set.seed(seed)

  template_rast <- env_train_scaled[[1]]
  all_cells <- seq_len(terra::ncell(template_rast))

  presence_cells <- integer()
  if (!is.null(presence_xy) && nrow(presence_xy) > 0) {
    presence_cells <- tryCatch(
      terra::cellFromXY(template_rast, presence_xy),
      error = function(e) integer()
    )
    presence_cells <- unique(stats::na.omit(as.integer(presence_cells)))
  }

  get_valid_cell_indices <- function() {
    nlyrs <- terra::nlyr(env_train_scaled)
    if (nlyrs == 1) {
      v <- terra::values(template_rast, dataframe = FALSE)
      which(is.finite(v))
    } else {
      valid <- terra::app(env_train_scaled, fun = function(...) all(is.finite(c(...))), raw = FALSE)
      v <- terra::values(valid, dataframe = FALSE)
      which(v > 0)
    }
  }

  if (identical(bias_method, "target_group")) {
    if (is.null(target_group_occ) || nrow(target_group_occ) < 1) {
      stop("bias_method = 'target_group' requires target_group_occ (data.frame with longitude and latitude columns).", call. = FALSE)
    }
    tg_xy <- target_group_occ[, c("longitude", "latitude"), drop = FALSE]
    names(tg_xy) <- c("x", "y")
    target_cells <- tryCatch(
      terra::cellFromXY(template_rast, tg_xy),
      error = function(e) integer()
    )
    target_cells <- unique(stats::na.omit(as.integer(target_cells)))
    if (length(target_cells) == 0) {
      stop("No target-group occurrence cells fall within the training raster.", call. = FALSE)
    }
    target_valid <- setdiff(target_cells, presence_cells)
    if (length(target_valid) < n) {
      stop("Not enough valid cells for target-group background sampling (",
        length(target_valid), " available, ", n, " requested).",
        call. = FALSE
      )
    }
    sampled <- sample.int(length(target_valid), n, replace = FALSE)
    sampled_cells <- target_valid[sampled]
    xy <- terra::xyFromCell(template_rast, sampled_cells)
    return(data.frame(x = xy[, 1], y = xy[, 2], check.names = FALSE))
  }

  if (identical(bias_method, "thickened")) {
    if (is.null(presence_xy) || nrow(presence_xy) < 2) {
      stop("bias_method = 'thickened' requires at least 2 presence points.", call. = FALSE)
    }
    sigma_km <- if (is.numeric(thickening_distance_km) && thickening_distance_km > 0) thickening_distance_km else 10
    all_cell_idx <- get_valid_cell_indices()
    if (length(all_cell_idx) < n) {
      stop("Not enough valid cells for thickened background sampling (",
        length(all_cell_idx), " available, ", n, " requested).",
        call. = FALSE
      )
    }
    # Convert to km for latitude-corrected distance computation
    cell_xy <- terra::xyFromCell(template_rast, all_cell_idx)
    cell_km <- lonlat_to_km(cell_xy[, "x"], cell_xy[, "y"])
    pres_km <- lonlat_to_km(presence_xy$x, presence_xy$y)
    if (sdm_use_gpu_for(nrow(cell_km) * nrow(pres_km), min_n = 50000L)) {
      dev <- gpu_device()
      cell_tensor <- torch::torch_tensor(as.matrix(cell_km), device = dev)
      pres_tensor <- torch::torch_tensor(as.matrix(pres_km), device = dev)
      d2 <- torch::torch_cdist(pres_tensor, cell_tensor)$pow(2)
      weights_tensor <- torch::torch_exp(-d2 / (2 * sigma_km^2))$sum(dim = 1)
      weights <- as.numeric(weights_tensor$to(device = "cpu"))
      gpu_empty_cache()
    } else {
      weights <- numeric(nrow(cell_km))
      for (j in seq_len(nrow(pres_km))) {
        d2 <- (cell_km$x_km - pres_km$x_km[j])^2 + (cell_km$y_km - pres_km$y_km[j])^2
        weights <- weights + exp(-d2 / (2 * sigma_km^2))
      }
    }
    weights <- weights / max(weights, na.rm = TRUE)
    weights[is.na(weights)] <- 0
    excl <- which(all_cell_idx %in% presence_cells)
    if (length(excl) > 0) weights[excl] <- 0
    valid_w <- which(weights > 0)
    if (length(valid_w) < n) {
      stop("Not enough valid cells for thickened background sampling (",
        length(valid_w), " available, ", n, " requested).",
        call. = FALSE
      )
    }
    probs <- weights[valid_w]
    total_weight <- sum(probs)
    if (!is.finite(total_weight) || total_weight <= 0) {
      sel <- sample.int(length(valid_w), size = n, replace = TRUE)
    } else {
      probs <- probs / total_weight
      sel <- sample.int(length(valid_w), size = n, replace = TRUE, prob = probs)
    }
    xy <- terra::xyFromCell(template_rast, all_cell_idx[valid_w[sel]])
    return(data.frame(x = xy[, 1], y = xy[, 2], check.names = FALSE))
  }

  all_valid <- setdiff(get_valid_cell_indices(), presence_cells)
  if (length(all_valid) < n) {
    warning("Sampled fewer background points than requested after excluding ",
      "incomplete and presence cells.",
      call. = FALSE
    )
    n <- length(all_valid)
  }
  sampled <- sample.int(length(all_valid), n, replace = FALSE)
  xy <- terra::xyFromCell(template_rast, all_valid[sampled])
  data.frame(x = xy[, 1], y = xy[, 2], check.names = FALSE)
}

extract_covariates <- function(r, xy) {
  vals <- terra::extract(r, xy)
  if ("ID" %in% names(vals)) vals <- vals[, setdiff(names(vals), "ID"), drop = FALSE]
  vals
}

class_balance_weights <- function(y) {
  y <- as.integer(y)
  n1 <- sum(y == 1)
  n0 <- sum(y == 0)
  n <- length(y)
  if (n1 == 0 || n0 == 0) {
    return(rep(1, n))
  }
  ifelse(y == 1, n / (2 * n1), n / (2 * n0))
}

make_sdm_formula <- function(covariates, include_quadratic = TRUE) {
  covariates <- make.names(covariates)
  terms <- covariates
  if (include_quadratic) terms <- c(terms, sprintf("I(%s^2)", covariates))
  stats::as.formula(paste("presence ~", paste(terms, collapse = " + ")))
}

cross_validate_glm <- function(model_data, formula, k = 3, seed = 42, n_cores = 1,
                               cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                               threshold = sdm_default_threshold, collect_predictions = FALSE,
                               log_fun = NULL) {
  fit_fun <- function(i, model_data, fold_id, threshold) {
    train <- model_data[fold_id != i, , drop = FALSE]
    test <- model_data[fold_id == i, , drop = FALSE]
    train_model <- train[, !names(train) %in% c(".x", ".y"), drop = FALSE]
    test_model <- test[, !names(test) %in% c(".x", ".y"), drop = FALSE]
    train_model$case_weight_sdm <- class_balance_weights(train_model$presence)
    fit <- tryCatch(
      suppressWarnings(stats::glm(formula,
        data = train_model, family = stats::binomial(),
        weights = case_weight_sdm, control = stats::glm.control(maxit = 60)
      )),
      error = function(e) NULL
    )
    if (is.null(fit)) {
      row <- metrics_list_to_row(list(auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_, threshold = threshold), fold = i)
      if (collect_predictions) return(list(metrics = row, predictions = NULL)) else return(row)
    }
    pred <- tryCatch(
      stats::predict(fit, newdata = test_model, type = "response"),
      error = function(e) rep(NA_real_, nrow(test_model))
    )
    if (all(is.na(pred))) {
      row <- metrics_list_to_row(list(auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_, threshold = threshold), fold = i)
      if (collect_predictions) return(list(metrics = row, predictions = NULL)) else return(row)
    }
    row <- metrics_list_to_row(compute_binary_metrics(test_model$presence, pred, threshold = threshold), fold = i)
    if (collect_predictions) {
      list(metrics = row, predictions = data.frame(observed = test_model$presence, predicted = pred))
    } else {
      row
    }
  }

  cross_validate_model(model_data,
    k = k, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km,
    threshold = threshold, fit_fun = fit_fun,
    collect_predictions = collect_predictions,
    cluster_exports = c("auc_rank", "compute_binary_metrics", "metrics_list_to_row", "normalize_threshold", "class_balance_weights"),
    log_fun = log_fun
  )
}

fit_fast_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n, include_quadratic = TRUE,
                         cv_folds = 3, seed = 42, n_cores = 1, log_fun = NULL, progress_fun = NULL,
                         cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                         threshold = sdm_default_threshold,
                         bias_method = c("uniform", "target_group", "thickened"),
                         target_group_occ = NULL,
                         thickening_distance_km = NULL,
                         model_data = NULL) {
  bias_method <- match.arg(bias_method)
  if (is.null(model_data)) {
    d <- prepare_sdm_data(occ, env_train_scaled, background_n,
      seed = seed, log_fun = log_fun,
      bias_method = bias_method,
      target_group_occ = target_group_occ,
      thickening_distance_km = thickening_distance_km
    )
  } else {
    d <- model_data
  }
  pres_vals <- d$pres_vals
  pres_xy_used <- d$pres_xy_used
  occ_used <- d$occ_used
  bg_vals <- d$bg_vals
  bg_xy <- d$bg_xy
  model_data <- d$model_data
  covariates <- d$covariates
  formula <- make_sdm_formula(covariates, include_quadratic = include_quadratic)
  environment(formula) <- baseenv()

  log_message(log_fun, "Fitting fast GLM SDM with ", nrow(pres_vals), " presences and ", nrow(bg_vals), " background points")
  model_fit_data <- model_data[, !names(model_data) %in% c(".x", ".y"), drop = FALSE]
  model_fit_data$case_weight_sdm <- class_balance_weights(model_fit_data$presence)
  model <- tryCatch({
    suppressWarnings(stats::glm(formula,
      data = model_fit_data, family = stats::binomial(),
      weights = case_weight_sdm, control = stats::glm.control(maxit = 80)
    ))
  }, error = function(e) {
    stop("GLM fitting failed: ", conditionMessage(e), call. = FALSE)
  })

  train_pred <- stats::predict(model, newdata = model_fit_data, type = "response")
  train_metrics <- compute_binary_metrics(model_fit_data$presence, train_pred, threshold = threshold)

  cv <- cross_validate_glm(model_data, formula,
    k = cv_folds, seed = seed, n_cores = n_cores,
    cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km, threshold = threshold,
    collect_predictions = TRUE
  )
  if (is.finite(cv$auc_mean)) {
    log_message(
      log_fun, "Cross-validation (", cv$strategy, ") AUC: ", sprintf("%.3f", cv$auc_mean),
      if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else ""
    )
  }

  # In-sample CBI (optimistic)
  cbi_result <- continuous_boyce_index(
    pres_suit = train_pred[model_fit_data$presence == 1],
    bg_suit = train_pred[model_fit_data$presence == 0]
  )
  if (is.finite(cbi_result$cbi)) {
    log_message(log_fun, "In-sample CBI: ", sprintf("%.3f", cbi_result$cbi))
  }

  # Cross-validated CBI (from out-of-fold predictions)
  cv_cbi <- NULL
  if (!is.null(cv$predictions) && nrow(cv$predictions) > 0) {
    preds <- cv$predictions
    cv_cbi <- continuous_boyce_index(
      pres_suit = preds$predicted[preds$observed == 1],
      bg_suit = preds$predicted[preds$observed == 0]
    )
    if (!is.null(cv_cbi) && is.finite(cv_cbi$cbi)) {
      log_message(log_fun, "Cross-validated CBI: ", sprintf("%.3f", cv_cbi$cbi))
    }
  }

  coefficients <- as.data.frame(summary(model)$coefficients)
  coefficients$term <- rownames(coefficients)
  rownames(coefficients) <- NULL
  coefficients <- coefficients[, c("term", setdiff(names(coefficients), "term")), drop = FALSE]

  model$model <- NULL
  model$data <- NULL
  model$y <- NULL
  model$formula <- formula
  if (!is.null(model$formula)) environment(model$formula) <- baseenv()
  if (!is.null(model$terms)) attr(model$terms, ".Environment") <- baseenv()
  model$call <- base::call("glm", formula = formula, family = stats::binomial())

  list(
    model = model, formula = formula, coefficients = coefficients, model_data = model_fit_data,
    occurrence_used = occ_used, background_xy = bg_xy, cv = cv, binary_metrics = train_metrics,
    metrics = list(
      auc = train_metrics$auc, tss = train_metrics$tss,
      sensitivity = train_metrics$sensitivity, specificity = train_metrics$specificity,
      cbi = cbi_result$cbi, cbi_pe_ratio = cbi_result$pe_ratio, cbi_note = cbi_result$note,
      cv_cbi = if (!is.null(cv_cbi)) cv_cbi$cbi else NA_real_
    ),
    cbi_detail = cbi_result, covariates = covariates,
    bias_method = bias_method,
    thickening_distance_km = if (identical(bias_method, "thickened")) thickening_distance_km else NULL,
    presence_suit = train_pred[model_fit_data$presence == 1],
    background_suit = train_pred[model_fit_data$presence == 0]
  )
}
