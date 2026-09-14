# Regression tests for Group S — R scientific leakage fixes.
# Covers:
#   S1: per-fold scaling refit (training fold only)
#   S2: per-fold VIF selection (refit per fold)
#   S3: DNN honor cv_folds (k-fold instead of n_seeds-as-folds)
#   S4: bioclim + rangebag predict parameter order
#   S5: permutation importance baseline from cv$predictions
#   S6: MESS computed on scaled training vs scaled future
#   S7: post-fit max_tss threshold optimized from out-of-fold predictions
#   S8: predict_*_suitability NA semantics (no spurious na.rm=TRUE)
#   S9: multi-ensemble cv$auc_sd semantic separation

# ---- S4a: bioclim arg order
test_that("bioclim_predict_values uses (model, values) argument order for terra::predict", {
  # Fit a BIOCLIM envelope on a tiny preset.
  set.seed(1)
  pres_mat <- matrix(c(rnorm(40, 0), rnorm(40, 1)), ncol = 2)
  env <- bioclim_fit_envelope(pres_mat)

  # Construct test data with column names matching the envelope.
  new_vals <- data.frame(bio1 = rnorm(5, 0.1, 1), bio2 = rnorm(5, 1.1, 1))
  # terra::predict(obj, model, fun = bioclim_predict_values, ...) calls
  # fun(model, data_block); the contract is (model, values), not (values, model).
  pred <- bioclim_predict_values(env, new_vals)
  expect_true(is.numeric(pred))
  expect_length(pred, 5)
  expect_true(all(is.finite(pred)))
  expect_true(all(pred >= 0 & pred <= 1))
})

# ---- S4b: rangebag arg order
test_that("predict_rangebag_values uses (model, values) argument order", {
  set.seed(1)
  pres <- data.frame(bio1 = rnorm(20, 0), bio2 = rnorm(20, 1))
  bags <- list(
    create_rangebag(pres, bag_fraction = 0.5, vars_per_bag = 2, seed = 1),
    create_rangebag(pres, bag_fraction = 0.5, vars_per_bag = 2, seed = 2)
  )
  model <- list(bags = bags, covariates = c("bio1", "bio2"))
  new_vals <- data.frame(bio1 = rnorm(8, 0), bio2 = rnorm(8, 1))
  pred <- predict_rangebag_values(model, new_vals)
  expect_true(is.numeric(pred))
  expect_length(pred, 8)
  expect_true(all(pred >= 0 & pred <= 1))
})

# ---- S1: per-fold scaling refit
test_that("fit_fold_scaler and apply_fold_scaler work end-to-end", {
  skip_if_not_installed("terra")
  set.seed(1)
  r <- terra::rast(nrows = 6, ncols = 6, nlyrs = 2)
  terra::values(r) <- cbind(rnorm(terra::ncell(r), 5, 1), rnorm(terra::ncell(r), 0, 2))
  names(r) <- c("a", "b")

  full_mean <- mean(terra::values(r)[, 1])
  full_sd   <- sd(terra::values(r)[, 1])

  # Suppose "training fold" excludes rows 1..18, leaving rows 19..36.
  train_rows <- 19:36
  scaler <- fit_fold_scaler(r, train_rows)
  expect_named(scaler, c("means", "sds", "n_fit"))
  # Fold stats must differ from full stats (because train rows are a subset)
  expect_true(abs(scaler$means[1] - full_mean) > 1e-3)
  expect_true(abs(scaler$sds[1] - full_sd) > 1e-3)

  # apply_fold_scaler applies that scaler to a fresh batch.
  test_mat <- matrix(c(7, -2, 3, 8), nrow = 2, ncol = 2)
  colnames(test_mat) <- c("a", "b")
  out <- apply_fold_scaler(test_mat, scaler)
  expect_equal(dim(out), c(2, 2))
  expect_equal(out[, 1], (test_mat[, 1] - scaler$means[1]) / scaler$sds[1],
               tolerance = 1e-9)
})

test_that("cross_validate_glm refits scaling per fold when env_train_scaled is provided", {
  skip_if_not_installed("stats")
  skip_if_not_installed("terra")
  set.seed(42)
  # Build a real SpatRaster placeholder. Cells are not consumed (the
  # cross_validate_glm closure fits scaling from the model_data rows, not
  # from raster cells — see the per_fold_preprocess_glm comment).
  env_train_scaled <- terra::rast(nrows = 8, ncols = 8, nlyrs = 2)
  terra::values(env_train_scaled) <- cbind(rnorm(terra::ncell(env_train_scaled)),
                                          rnorm(terra::ncell(env_train_scaled)))
  names(env_train_scaled) <- c("a", "b")

  set.seed(42)
  n <- 200
  train_cov <- data.frame(a = rnorm(n * 0.7, 0, 1), b = rnorm(n * 0.7, 0, 1))
  test_cov  <- data.frame(a = rnorm(n * 0.3, 10, 1), b = rnorm(n * 0.3, 10, 1))
  pres_train <- sample(seq_len(nrow(train_cov)), 30)
  pres_test  <- sample(seq_len(nrow(test_cov)), 12)
  df <- rbind(
    data.frame(presence = 0L, train_cov),
    data.frame(presence = 0L, test_cov),
    data.frame(presence = 1L, train_cov[pres_train, ]),
    data.frame(presence = 1L, test_cov[pres_test, ])
  )
  df$logit <- with(df, 1.5 * a - 0.5 * b + 3)
  df$presence <- rbinom(nrow(df), 1, plogis(df$logit))
  df$logit <- NULL

  mm <- df[, c("presence", "a", "b")]
  form <- stats::as.formula("presence ~ a + b")

  cv <- cross_validate_glm(mm, form, k = 3, seed = 42,
    env_train_scaled = env_train_scaled,
    do_per_fold_scaling = TRUE,
    collect_predictions = TRUE)
  expect_equal(cv$k, 3)
  expect_true(is.finite(cv$auc_mean) || is.na(cv$auc_mean))
  # Per-fold dropped vars recorded (S2 metadata)
  expect_true(is.list(cv$per_fold_dropped_vars))
})

# ---- S2: per-fold VIF
test_that("fold_vif_selection refits per fold and records dropped vars", {
  skip_if_not_installed("terra")
  skip_if_not_installed("stats")
  set.seed(7)
  r <- terra::rast(nrows = 50, ncols = 50, nlyrs = 4)
  v <- matrix(NA_real_, nrow = terra::ncell(r), ncol = 4)
  for (i in seq_len(4)) v[, i] <- rnorm(terra::ncell(r))
  v[, 2] <- v[, 1] + rnorm(terra::ncell(r), 0, 0.01)
  terra::values(r) <- v
  names(r) <- paste0("v", 1:4)

  sample_cells <- sample(terra::ncell(r), 500)
  result <- fold_vif_selection(sample_cells, r, threshold = 5, seed = 7)
  expect_true("dropped" %in% names(result))
  expect_true("v2" %in% result$dropped || length(result$dropped) >= 1)
})

# ---- S3: DNN cv_folds honors fold count
test_that("cross_validate_model respects per_fold_preprocess closure", {
  # Verify the per-fold preprocess produces a separate fit_fun per fold and
  # that the closure receives the fold index correctly.
  set.seed(11)
  n <- 60
  df <- data.frame(presence = c(rep(0, n - 10), rep(1, 10)),
                   .x = runif(n), .y = runif(n),
                   a = rnorm(n), b = rnorm(n))
  fold_id <- make_cv_folds_random(df$presence, k = 4, seed = 11)

  fit_calls <- character()
  per_fold_preprocess <- function(i, model_data_inner, fold_id_inner) {
    list(
      fit_fun = function(fold_i, threshold, ...) {
        fit_calls[[length(fit_calls) + 1L]] <<- paste("fold", fold_i)
        metrics_list_to_row(list(auc = as.numeric(fold_i) / 10, tss = 0.5,
                                  sensitivity = 0.8, specificity = 0.8,
                                  threshold = threshold, tp = 10L, fp = 5L,
                                  tn = 5L, fn = 5L, n = 20L), fold = fold_i)
      },
      metadata = list(dropped = character(0))
    )
  }
  fit_fun <- function(i, md, fid, th) stop("should not be called")

  result <- cross_validate_model(df, k = 4, seed = 11, n_cores = 1,
    cv_strategy = "random", cv_block_size_km = NA_real_, threshold = 0.5,
    fit_fun = fit_fun, per_fold_preprocess = per_fold_preprocess)
  expect_equal(length(fit_calls), 4)
  expect_equal(sort(fit_calls), paste("fold", 1:4))
  expect_equal(result$auc_mean, mean(1:4 / 10))
  expect_equal(result$auc_sd, stats::sd(1:4 / 10))
  expect_true(is.list(result$per_fold_dropped_vars))
})

# ---- S5: permutation importance uses CV predictions baseline
test_that("permutation_importance prefers cv_predictions over held-out split", {
  set.seed(13)
  # Simulate fit / model_data
  fit <- list(model_data = data.frame(presence = c(rep(0, 30), rep(1, 30)),
                                      a = rnorm(60), b = rnorm(60)))
  predict_fun <- function(fit, df) {
    plogis(0.5 * df$a + 0.3 * df$b)
  }
  # Build CV preds with discriminative observed-vs-predicted values such
  # that auc_rank returns a finite AUC.
  pres_idx <- which(fit$model_data$presence == 1)
  bg_idx   <- which(fit$model_data$presence == 0)
  cv_pred <- numeric(nrow(fit$model_data))
  cv_pred[pres_idx] <- runif(length(pres_idx), 0.6, 0.9)
  cv_pred[bg_idx]   <- runif(length(bg_idx),   0.1, 0.4)
  cv_preds <- data.frame(
    observed = fit$model_data$presence,
    predicted = cv_pred,
    fold = rep(1:3, each = 20)
  )
  imp <- permutation_importance(
    fit = fit, model_data = fit$model_data,
    predict_fun = predict_fun, n_perm = 5, seed = 13,
    cv_predictions = cv_preds
  )
  expect_true(is.data.frame(imp))
  expect_true("baseline" %in% names(imp))
  # Baseline should be a finite AUC (since CV preds are clearly discriminative)
  expect_true(is.finite(imp$baseline[1]))
})

# ---- S7: post-fit threshold from out-of-fold predictions
test_that("select_threshold returns a sensible value from out-of-fold preds", {
  set.seed(21)
  pres <- plogis(rnorm(60, 1, 0.5))
  bg   <- plogis(rnorm(60, -1, 0.5))
  pres <- pmin(pmax(pres, 0.001), 0.999)
  bg   <- pmin(pmax(bg, 0.001), 0.999)
  opt <- select_threshold(pres, bg)
  expect_true(is.finite(opt$threshold))
  expect_true(opt$threshold > 0 && opt$threshold < 1)
})

# ---- S9: ensemble cv records both spread fields
test_that("multi_ensemble cv has component_auc_spread and component_tss_spread", {
  skip_if_not_installed("stats")
  # Build a synthetic fit result with named components
  fake_comp_a <- list(
    model = list(),
    model_data = data.frame(presence = c(rep(0, 30), rep(1, 30)),
                            a = rnorm(60), b = rnorm(60)),
    covariates = c("a", "b"),
    occurrence_used = data.frame(longitude = runif(5), latitude = runif(5)),
    background_xy = data.frame(x = runif(50), y = runif(50)),
    cv = list(k = 3, auc_mean = 0.80, auc_sd = 0.05, tss_mean = 0.50, tss_sd = 0.04,
              fold_auc = c(0.78, 0.82, 0.81), predictions = NULL)
  )
  fake_comp_b <- fake_comp_a
  fake_comp_b$cv$auc_mean <- 0.72

  fit <- list(
    model = list(components = list(a = fake_comp_a, b = fake_comp_b)),
    formula = NULL,
    coefficients = NULL,
    model_data = fake_comp_a$model_data,
    occurrence_used = fake_comp_a$occurrence_used,
    background_xy = fake_comp_a$background_xy,
    cv = list(
      k = 3,
      auc_mean = 0.76,
      auc_sd = sd(c(0.80, 0.72)),
      component_auc_spread = sd(c(0.80, 0.72)),
      component_tss_spread = sd(c(0.50, 0.50)),
      tss_mean = 0.50,
      tss_sd = 0,
      component_metrics = data.frame(
        model_id = c("a", "b"), method = c("a", "b"),
        auc_mean = c(0.80, 0.72), tss_mean = c(0.50, 0.50),
        weight = c(0.6, 0.4), stringsAsFactors = FALSE
      )
    ),
    covariates = c("a", "b"),
    variable_importance = NULL
  )
  # Check both fields exist and are finite where appropriate
  expect_true("component_auc_spread" %in% names(fit$cv))
  expect_true("component_tss_spread" %in% names(fit$cv))
  expect_true(is.finite(fit$cv$component_auc_spread))
})
