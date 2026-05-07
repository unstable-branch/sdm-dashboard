# Rangebagging SDM backend.
#
# This is a conservative, dependency-free Rangebag implementation based on
# repeated environmental range bags. It intentionally uses rectangular bags
# rather than optional convex-hull geometry so the backend is reliable on
# Windows and release builds.

find_optimal_threshold <- function(obs, pred) {
  obs <- as.integer(obs)
  pred <- as.numeric(pred)
  ok <- is.finite(obs) & is.finite(pred)
  obs <- obs[ok]
  pred <- pred[ok]
  if (length(pred) < 3 || sum(obs == 1) < 1 || sum(obs == 0) < 1) return(0.5)
  candidates <- sort(unique(pred))
  if (length(candidates) > 2) candidates <- candidates[2:(length(candidates) - 1)]
  best_threshold <- 0.5
  best_tss <- -Inf
  n_presence <- sum(obs == 1)
  n_background <- sum(obs == 0)
  for (threshold in candidates) {
    sensitivity <- sum(obs == 1 & pred >= threshold, na.rm = TRUE) / n_presence
    specificity <- sum(obs == 0 & pred < threshold, na.rm = TRUE) / n_background
    tss <- sensitivity + specificity - 1
    if (is.finite(tss) && tss > best_tss) {
      best_tss <- tss
      best_threshold <- threshold
    }
  }
  best_threshold
}

create_rangebag <- function(presence_covariates, bag_fraction = 0.5, vars_per_bag = 1, seed = NULL) {
  presence_covariates <- as.data.frame(presence_covariates, check.names = FALSE)
  if (nrow(presence_covariates) < 3) stop("Need at least 3 presence records to create a range bag.", call. = FALSE)
  if (!is.null(seed)) set.seed(seed)

  bag_fraction <- suppressWarnings(as.numeric(bag_fraction[1]))
  if (!is.finite(bag_fraction) || bag_fraction <= 0 || bag_fraction > 1) bag_fraction <- 0.5
  vars_per_bag <- suppressWarnings(as.integer(vars_per_bag[1]))
  if (!is.finite(vars_per_bag) || vars_per_bag < 1) vars_per_bag <- 1L
  vars_per_bag <- min(vars_per_bag, ncol(presence_covariates))

  n_sample <- max(3L, ceiling(nrow(presence_covariates) * bag_fraction))
  n_sample <- min(n_sample, nrow(presence_covariates))
  row_idx <- sample.int(nrow(presence_covariates), n_sample, replace = FALSE)
  var_names <- sample(names(presence_covariates), vars_per_bag, replace = FALSE)
  bag_data <- presence_covariates[row_idx, var_names, drop = FALSE]
  ranges <- vapply(bag_data, function(x) c(min(x, na.rm = TRUE), max(x, na.rm = TRUE)), numeric(2))
  if (any(!is.finite(ranges))) stop("Invalid range bag; sampled covariates contained no finite values.", call. = FALSE)

  structure(list(vars = var_names, ranges = ranges), class = "sdm_rangebag")
}

predict_rangebag_bag <- function(bag, newdata) {
  newdata <- as.data.frame(newdata, check.names = FALSE)
  if (!all(bag$vars %in% names(newdata))) {
    missing <- setdiff(bag$vars, names(newdata))
    stop("Rangebag prediction data missing covariate(s): ", paste(missing, collapse = ", "), call. = FALSE)
  }
  vals <- newdata[, bag$vars, drop = FALSE]
  ok <- stats::complete.cases(vals)
  inside <- rep(NA_integer_, nrow(vals))
  if (any(ok)) {
    lower <- bag$ranges[1, , drop = TRUE]
    upper <- bag$ranges[2, , drop = TRUE]
    inside[ok] <- as.integer(rowSums(sweep(vals[ok, , drop = FALSE], 2, lower, `>=`)) +
      rowSums(sweep(vals[ok, , drop = FALSE], 2, upper, `<=`)) == 2 * length(bag$vars))
  }
  inside
}

predict_rangebag_values <- function(model, data) {
  data <- as.data.frame(data, check.names = FALSE)
  bags <- model$bags
  if (length(bags) < 1) return(rep(NA_real_, nrow(data)))
  votes <- rep(0, nrow(data))
  for (bag in bags) votes <- votes + predict_rangebag_bag(bag, data)
  votes / length(bags)
}

fit_rangebag_sdm <- function(occ, env_train_scaled, background_n = sdm_default_background_n,
                             include_quadratic = FALSE, cv_folds = sdm_default_cv_folds,
                             seed = sdm_default_seed, n_cores = 1, log_fun = NULL,
                             n_bags = sdm_default_rangebag_n_bags,
                             bag_fraction = sdm_default_rangebag_fraction,
                             vars_per_bag = sdm_default_rangebag_vars_per_bag) {
  covariates <- names(env_train_scaled)
  if (length(covariates) < 2) stop("At least two covariates are required for Rangebagging.", call. = FALSE)
  n_bags <- suppressWarnings(as.integer(n_bags[1]))
  if (!is.finite(n_bags) || n_bags < 10) n_bags <- sdm_default_rangebag_n_bags
  seed <- suppressWarnings(as.integer(seed[1]))
  if (!is.finite(seed) || seed < 1) seed <- sdm_default_seed

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  if (sum(!pres_keep) > 0) log_message(log_fun, "Dropped ", sum(!pres_keep), " occurrence records with missing covariates")
  pres_vals <- as.data.frame(pres_vals[pres_keep, , drop = FALSE], check.names = FALSE)
  occ_used <- occ[pres_keep, , drop = FALSE]
  if (nrow(pres_vals) < 20) stop("Too few presence records with complete environmental data for Rangebagging.", call. = FALSE)

  bg_xy <- sample_background_points(env_train_scaled, background_n, seed = seed, presence_xy = pres_xy[pres_keep, , drop = FALSE])
  bg_vals <- extract_covariates(env_train_scaled, bg_xy)
  bg_keep <- stats::complete.cases(bg_vals)
  bg_vals <- as.data.frame(bg_vals[bg_keep, , drop = FALSE], check.names = FALSE)
  bg_xy <- bg_xy[bg_keep, , drop = FALSE]
  if (nrow(bg_vals) < 100) stop("Too few background points could be sampled for Rangebagging.", call. = FALSE)

  log_message(log_fun, "Fitting Rangebagging SDM with ", nrow(pres_vals), " presences, ", nrow(bg_vals), " background points, and ", n_bags, " bags")

  cv <- list(k = 0, auc_mean = NA_real_, auc_sd = NA_real_, tss_mean = NA_real_, tss_sd = NA_real_, fold_auc = numeric(), fold_tss = numeric(), threshold = 0.5)
  k <- suppressWarnings(as.integer(cv_folds[1]))
  if (is.finite(k) && k >= 2) {
    k <- min(k, nrow(pres_vals))
    if (k >= 2) {
      set.seed(seed)
      fold_id <- sample(rep(seq_len(k), length.out = nrow(pres_vals)))
      fold_auc <- rep(NA_real_, k)
      fold_tss <- rep(NA_real_, k)
      fold_threshold <- rep(NA_real_, k)
      for (fold in seq_len(k)) {
        train_pres <- pres_vals[fold_id != fold, , drop = FALSE]
        test_pres <- pres_vals[fold_id == fold, , drop = FALSE]
        bags <- vector("list", n_bags)
        for (i in seq_len(n_bags)) {
          bags[[i]] <- tryCatch(create_rangebag(train_pres, bag_fraction, vars_per_bag, seed = seed + fold * 10000L + i), error = function(e) NULL)
        }
        bags <- Filter(Negate(is.null), bags)
        if (length(bags) == 0) next
        fold_model <- list(bags = bags, covariates = covariates)
        test_data <- rbind(test_pres, bg_vals)
        obs <- c(rep(1L, nrow(test_pres)), rep(0L, nrow(bg_vals)))
        pred <- predict_rangebag_values(fold_model, test_data)
        fold_auc[fold] <- auc_rank(obs, pred)
        threshold <- find_optimal_threshold(obs, pred)
        fold_threshold[fold] <- threshold
        sensitivity <- sum(obs == 1 & pred >= threshold, na.rm = TRUE) / sum(obs == 1)
        specificity <- sum(obs == 0 & pred < threshold, na.rm = TRUE) / sum(obs == 0)
        fold_tss[fold] <- sensitivity + specificity - 1
      }
      cv <- list(
        k = k,
        auc_mean = mean(fold_auc, na.rm = TRUE),
        auc_sd = stats::sd(fold_auc, na.rm = TRUE),
        tss_mean = mean(fold_tss, na.rm = TRUE),
        tss_sd = stats::sd(fold_tss, na.rm = TRUE),
        fold_auc = fold_auc,
        fold_tss = fold_tss,
        threshold = if (any(is.finite(fold_threshold))) mean(fold_threshold, na.rm = TRUE) else 0.5
      )
      if (is.finite(cv$auc_mean)) log_message(log_fun, "Rangebag CV AUC: ", sprintf("%.3f", cv$auc_mean), if (is.finite(cv$auc_sd)) paste0(" +/- ", sprintf("%.3f", cv$auc_sd)) else "")
    }
  }

  final_bags <- vector("list", n_bags)
  for (i in seq_len(n_bags)) {
    final_bags[[i]] <- tryCatch(create_rangebag(pres_vals, bag_fraction, vars_per_bag, seed = seed + i), error = function(e) NULL)
  }
  final_bags <- Filter(Negate(is.null), final_bags)
  if (length(final_bags) < 1) stop("No Rangebagging bags could be fitted.", call. = FALSE)

  model <- list(
    bags = final_bags,
    covariates = covariates,
    n_bags_requested = n_bags,
    n_bags = length(final_bags),
    bag_fraction = bag_fraction,
    vars_per_bag = vars_per_bag,
    threshold = cv$threshold
  )

  list(
    model = model,
    formula = NULL,
    coefficients = data.frame(Message = "Rangebagging does not produce GLM-style coefficients."),
    model_data = rbind(
      data.frame(presence = 1L, pres_vals, check.names = FALSE),
      data.frame(presence = 0L, bg_vals, check.names = FALSE)
    ),
    occurrence_used = occ_used,
    background_xy = bg_xy,
    cv = cv,
    covariates = covariates,
    variable_importance = NULL,
    threshold = cv$threshold
  )
}

predict_rangebag_suitability <- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
  if (!is.list(fit) || is.null(fit$model) || is.null(fit$model$bags)) {
    stop("fit must be a Rangebag fit result, not the raw model object.", call. = FALSE)
  }
  log_message(log_fun, "Predicting suitability raster with Rangebagging")
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  suit <- terra::predict(
    env_project_scaled,
    fit$model,
    fun = predict_rangebag_values,
    filename = output_tif,
    overwrite = TRUE,
    cores = 1,
    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
  )
  names(suit) <- "suitability"
  suit
}
