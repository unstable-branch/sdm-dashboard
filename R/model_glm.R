# Presence/background GLM fitting and diagnostics.

sample_background_points <- function(env_train_scaled, n, seed = 42, presence_xy = NULL,
                                     bias_method = c("uniform", "target_group", "thickened"),
                                     target_group_occ = NULL,
                                     thickening_distance_km = NULL) {
  bias_method <- match.arg(bias_method)
  set.seed(seed)
  n <- as.integer(n)
  if (is.na(n) || n < 1) n <- 100L

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
           length(target_valid), " available, ", n, " requested).", call. = FALSE)
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
    sigma_deg <- sigma_km / 111
    all_cell_idx <- get_valid_cell_indices()
    if (length(all_cell_idx) < n) {
      stop("Not enough valid cells for thickened background sampling (",
           length(all_cell_idx), " available, ", n, " requested).", call. = FALSE)
    }
    cell_xy <- terra::xyFromCell(template_rast, all_cell_idx)
    pres_df <- data.frame(x = presence_xy$x, y = presence_xy$y)
    weights <- numeric(nrow(cell_xy))
    for (j in seq_len(nrow(pres_df))) {
      d2 <- (cell_xy[, "x"] - pres_df$x[j])^2 + (cell_xy[, "y"] - pres_df$y[j])^2
      weights <- weights + exp(-d2 / (2 * sigma_deg^2))
    }
    weights <- weights / max(weights, na.rm = TRUE)
    weights[is.na(weights)] <- 0
    excl <- which(all_cell_idx %in% presence_cells)
    if (length(excl) > 0) weights[excl] <- 0
    valid_w <- which(weights > 0)
    if (length(valid_w) < n) {
      stop("Not enough valid cells for thickened background sampling (",
           length(valid_w), " available, ", n, " requested).", call. = FALSE)
    }
    probs <- weights[valid_w]
    probs <- probs / sum(probs)
    sel <- sample.int(length(valid_w), size = n, replace = TRUE, prob = probs)
    xy <- terra::xyFromCell(template_rast, all_cell_idx[valid_w[sel]])
    return(data.frame(x = xy[, 1], y = xy[, 2], check.names = FALSE))
  }

  all_valid <- setdiff(get_valid_cell_indices(), presence_cells)
  if (length(all_valid) < n) {
    warning("Sampled fewer background points than requested after excluding ",
            "incomplete and presence cells.", call. = FALSE)
    all_valid <- get_valid_cell_indices()
    all_valid <- setdiff(all_valid, presence_cells)
    if (length(all_valid) == 0) {
      stop("No valid background cells available in the training raster.", call. = FALSE)
    }
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
  if (n1 == 0 || n0 == 0) return(rep(1, n))
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
                               threshold = sdm_default_threshold) {
  k <- as.integer(k)
  cv_strategy <- normalize_cv_strategy(cv_strategy)
  threshold <- normalize_threshold(threshold)
  if (is.na(k) || k < 2) {
    return(list(k = 0, strategy = cv_strategy, auc_mean = NA_real_, auc_sd = NA_real_,
                tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
                fold_metrics = data.frame(), fold_sizes = data.frame()))
  }
  k <- min(k, sum(model_data$presence == 1), sum(model_data$presence == 0))
  if (k < 2) {
    return(list(k = 0, strategy = cv_strategy, auc_mean = NA_real_, auc_sd = NA_real_,
                tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(),
                fold_metrics = data.frame(), fold_sizes = data.frame()))
  }
  n_cores <- min(normalize_core_count(n_cores), k)

  block_id <- NULL
  block_size_mode <- "not_applicable"
  block_size_used <- NA_real_
  if (identical(cv_strategy, "spatial_blocks") && all(c(".x", ".y") %in% names(model_data))) {
    folds <- make_cv_folds_spatial_blocks(model_data$.x, model_data$.y, model_data$presence, k = k,
                                          block_size_km = normalize_cv_block_size_km(cv_block_size_km), seed = seed)
    fold_id <- folds$fold_id
    block_id <- folds$block_id
    block_size_mode <- folds$block_size_mode
    block_size_used <- folds$block_size_km
    k <- max(fold_id, na.rm = TRUE)
  } else {
    cv_strategy <- "random"
    fold_id <- make_cv_folds_random(model_data$presence, k = k, seed = seed)
  }
  fold_sizes <- summarise_cv_folds(fold_id, model_data$presence, block_id = block_id)

  fit_one_fold <- function(i, model_data_arg, fold_id_arg, formula_arg, threshold_arg) {
    train <- model_data_arg[fold_id_arg != i, , drop = FALSE]
    test <- model_data_arg[fold_id_arg == i, , drop = FALSE]
    train_model <- train[, !names(train) %in% c(".x", ".y"), drop = FALSE]
    test_model <- test[, !names(test) %in% c(".x", ".y"), drop = FALSE]
    y <- as.integer(train_model$presence)
    n1 <- sum(y == 1)
    n0 <- sum(y == 0)
    n <- length(y)
    w <- if (n1 == 0 || n0 == 0) rep(1, n) else ifelse(y == 1, n / (2 * n1), n / (2 * n0))
    train_model$case_weight_sdm <- w
    fit <- stats::glm(formula_arg, data = train_model, family = stats::binomial(),
                      weights = case_weight_sdm, control = stats::glm.control(maxit = 60))
    pred <- stats::predict(fit, newdata = test_model, type = "response")
    metrics_list_to_row(compute_binary_metrics(test_model$presence, pred, threshold = threshold_arg), fold = i)
  }

  run_single_core_cv <- function() {
    do.call(rbind, lapply(seq_len(k), fit_one_fold,
                          model_data_arg = model_data, fold_id_arg = fold_id,
                          formula_arg = formula, threshold_arg = threshold))
  }

  fold_metrics <- if (n_cores > 1 && k > 1) {
    parallel_result <- tryCatch({
      cl <- parallel::makeCluster(n_cores)
      on.exit(parallel::stopCluster(cl), add = TRUE)
      parallel::clusterExport(cl, c("auc_rank", "compute_binary_metrics", "metrics_list_to_row", "normalize_threshold"), envir = environment(cross_validate_glm))
      rows <- parallel::parLapply(cl, seq_len(k), fit_one_fold,
                                   model_data_arg = model_data, fold_id_arg = fold_id,
                                   formula_arg = formula, threshold_arg = threshold)
      do.call(rbind, rows)
    }, error = function(e) e)
    if (inherits(parallel_result, "error")) {
      warning("Parallel cross-validation failed; falling back to single-core CV: ", conditionMessage(parallel_result), call. = FALSE)
      run_single_core_cv()
    } else {
      parallel_result
    }
  } else {
    run_single_core_cv()
  }

  list(
    k = k,
    strategy = cv_strategy,
    block_size_km = block_size_used,
    block_size_mode = block_size_mode,
    fold_sizes = fold_sizes,
    fold_metrics = fold_metrics,
    auc_mean = metric_mean(fold_metrics$auc),
    auc_sd = metric_sd(fold_metrics$auc),
    tss_mean = metric_mean(fold_metrics$tss),
    tss_sd = metric_sd(fold_metrics$tss),
    sensitivity_mean = metric_mean(fold_metrics$sensitivity),
    specificity_mean = metric_mean(fold_metrics$specificity),
    fold_auc = fold_metrics$auc
  )
}

fit_fast_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n, include_quadratic = TRUE,
                          cv_folds = 3, seed = 42, n_cores = 1, log_fun = NULL,
                          cv_strategy = sdm_default_cv_strategy, cv_block_size_km = sdm_default_cv_block_size_km,
                          threshold = sdm_default_threshold,
                          bias_method = c("uniform", "target_group", "thickened"),
                          target_group_occ = NULL,
                          thickening_distance_km = NULL) {
  bias_method <- match.arg(bias_method)
  covariates <- names(env_train_scaled)
  if (length(covariates) < 2) stop("At least two covariates are required for modelling.", call. = FALSE)

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  if (sum(!pres_keep) > 0) log_message(log_fun, "Dropped ", sum(!pres_keep), " occurrence records with missing covariates")
  pres_vals <- pres_vals[pres_keep, , drop = FALSE]
  pres_xy_used <- pres_xy[pres_keep, , drop = FALSE]
  occ_used <- occ[pres_keep, , drop = FALSE]
  if (nrow(pres_vals) < 20) stop("Too few presence records with complete environmental data.", call. = FALSE)

  bg_xy <- sample_background_points(env_train_scaled, background_n, seed = seed, presence_xy = pres_xy_used,
                                      bias_method = bias_method, target_group_occ = target_group_occ,
                                      thickening_distance_km = thickening_distance_km)
  bg_vals <- extract_covariates(env_train_scaled, bg_xy)
  bg_keep <- stats::complete.cases(bg_vals)
  bg_vals <- bg_vals[bg_keep, , drop = FALSE]
  bg_xy <- bg_xy[bg_keep, , drop = FALSE]
  if (nrow(bg_vals) < 100) stop("Too few background points could be sampled.", call. = FALSE)

  model_data <- rbind(
    data.frame(presence = 1L, pres_vals, .x = pres_xy_used$x, .y = pres_xy_used$y, check.names = FALSE),
    data.frame(presence = 0L, bg_vals, .x = bg_xy$x, .y = bg_xy$y, check.names = FALSE)
  )
  names(model_data) <- make.names(names(model_data))
  covariates <- make.names(covariates)
  formula <- make_sdm_formula(covariates, include_quadratic = include_quadratic)
  environment(formula) <- baseenv()

  log_message(log_fun, "Fitting fast GLM SDM with ", nrow(pres_vals), " presences and ", nrow(bg_vals), " background points")
  model_fit_data <- model_data[, !names(model_data) %in% c(".x", ".y"), drop = FALSE]
  model_fit_data$case_weight_sdm <- class_balance_weights(model_fit_data$presence)
  model <- stats::glm(formula, data = model_fit_data, family = stats::binomial(),
                      weights = case_weight_sdm, control = stats::glm.control(maxit = 80))

  train_pred <- stats::predict(model, newdata = model_fit_data, type = "response")
  train_metrics <- compute_binary_metrics(model_fit_data$presence, train_pred, threshold = threshold)

  cv <- cross_validate_glm(model_data, formula, k = cv_folds, seed = seed, n_cores = n_cores,
                           cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km, threshold = threshold)
  if (is.finite(cv$auc_mean)) {
    log_message(log_fun, "Cross-validation (", cv$strategy, ") AUC: ", sprintf("%.3f", cv$auc_mean),
                if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else "")
  }

  pres_vals_for_cbi <- model_fit_data$presence
  bg_vals_for_cbi <- train_pred[model_fit_data$presence == 0]
  cbi_result <- continuous_boyce_index(
    pres_suit = train_pred[model_fit_data$presence == 1],
    bg_suit = bg_vals_for_cbi
  )
  if (is.finite(cbi_result$cbi)) {
    log_message(log_fun, "Continuous Boyce Index (CBI): ", sprintf("%.3f", cbi_result$cbi))
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

  list(model = model, formula = formula, coefficients = coefficients, model_data = model_fit_data,
       occurrence_used = occ_used, background_xy = bg_xy, cv = cv, binary_metrics = train_metrics,
       metrics = list(auc = train_metrics$auc, tss = train_metrics$tss,
                      sensitivity = train_metrics$sensitivity, specificity = train_metrics$specificity,
                      cbi = cbi_result$cbi, cbi_pe_ratio = cbi_result$pe_ratio, cbi_note = cbi_result$note),
       cbi_detail = cbi_result, covariates = covariates,
       bias_method = bias_method,
       thickening_distance_km = if (identical(bias_method, "thickened")) thickening_distance_km else NULL)
}