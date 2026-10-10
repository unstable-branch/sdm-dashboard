test_that("DNN external CV Off fits full data without reported validation folds", {
  skip_if_not_installed("terra")
  skip_if_not_installed("cito")
  skip_if_not_installed("torch")

  env <- new.env(parent = globalenv())
  env$fit_dnn_sdm <- fit_dnn_sdm
  environment(env$fit_dnn_sdm) <- env
  old_predict_method <- get0("predict.dnn_cv_test_model", envir = .GlobalEnv, inherits = FALSE)
  assign("predict.dnn_cv_test_model", function(object, newdata, ...) {
    rep(0.5, nrow(newdata))
  }, envir = .GlobalEnv)
  on.exit({
    if (is.null(old_predict_method)) {
      rm("predict.dnn_cv_test_model", envir = .GlobalEnv)
    } else {
      assign("predict.dnn_cv_test_model", old_predict_method, envir = .GlobalEnv)
    }
  }, add = TRUE)
  calls <- list()
  logs <- character()
  env$train_dnn_model <- function(train_data, ...) {
    calls[[length(calls) + 1L]] <<- train_data
    frame <- as.data.frame(train_data$train_x)
    frame$presence <- train_data$train_y
    stats::glm(presence ~ ., data = frame, family = stats::binomial())
  }
  r <- terra::rast(nrows = 30, ncols = 30, xmin = 0, xmax = 30,
                   ymin = 0, ymax = 30, crs = "EPSG:4326")
  terra::values(r) <- seq_len(terra::ncell(r))
  names(r) <- c("elevation")
  cell_ids <- seq(1, terra::ncell(r), length.out = 25) |> as.integer()
  xy <- terra::xyFromCell(r, cell_ids)
  occ <- data.frame(longitude = xy[, 1], latitude = xy[, 2])

  result <- env$fit_dnn_sdm(
    occ = occ, env_train_scaled = r, background_n = 100L,
    cv_folds = 0L, seed = 17L, dnn_device = "cpu", n_seeds = 5L,
    use_fused_adam = "off", dnn_mixed_precision = "off", dnn_cuda_graphs = "off",
    log_fun = function(message) logs <<- c(logs, message)
  )

  expect_equal(length(calls), 1L)
  expect_equal(nrow(calls[[1]]$train_x), nrow(result$model_data))
  expect_equal(nrow(calls[[1]]$train_x), 125L)
  expect_equal(length(calls[[1]]$train_y), 125L)
  expect_equal(nrow(calls[[1]]$test_x), 0L)
  expect_equal(result$n_seeds, 1L)
  expect_true(is.list(result$scaler))
  expect_identical(result$model, result$ensemble_models[[1]])
  expect_equal(result$cv$k, 0L)
  expect_identical(result$cv$strategy, "disabled")
  expect_identical(result$cv$status, "disabled")
  expect_length(result$cv$fold_auc, 0L)
  expect_length(result$cv$fold_n_test, 0L)
  expect_equal(result$cv$auc_mean, NA_real_)
  expect_equal(result$cv$auc_sd, NA_real_)
  expect_equal(nrow(result$cv$predictions), 0L)
  expect_length(result$fold_predictions, 0L)
  expect_length(result$ensemble_models, 1L)
  expect_match(paste(logs, collapse = " "), "CV.*disabled|CV.*unavailable", ignore.case = TRUE)
})

test_that("DNN enabled/default CV continues to fit and report folds", {
  skip_if_not_installed("terra")
  skip_if_not_installed("cito")
  skip_if_not_installed("torch")

  env <- new.env(parent = globalenv())
  env$fit_dnn_sdm <- fit_dnn_sdm
  environment(env$fit_dnn_sdm) <- env
  old_predict_method <- get0("predict.dnn_cv_test_model", envir = .GlobalEnv, inherits = FALSE)
  assign("predict.dnn_cv_test_model", function(object, newdata, ...) {
    rep(0.5, nrow(newdata))
  }, envir = .GlobalEnv)
  on.exit({
    if (is.null(old_predict_method)) {
      rm("predict.dnn_cv_test_model", envir = .GlobalEnv)
    } else {
      assign("predict.dnn_cv_test_model", old_predict_method, envir = .GlobalEnv)
    }
  }, add = TRUE)
  calls <- list()
  env$train_dnn_model <- function(train_data, ...) {
    calls[[length(calls) + 1L]] <<- train_data
    structure(list(), class = "dnn_cv_test_model")
  }
  r <- terra::rast(nrows = 30, ncols = 30, xmin = 0, xmax = 30,
                   ymin = 0, ymax = 30, crs = "EPSG:4326")
  terra::values(r) <- seq_len(terra::ncell(r))
  names(r) <- "elevation"
  xy <- terra::xyFromCell(r, seq(1, terra::ncell(r), length.out = 25) |> as.integer())
  occ <- data.frame(longitude = xy[, 1], latitude = xy[, 2])

  explicit <- env$fit_dnn_sdm(
    occ = occ, env_train_scaled = r, background_n = 100L,
    cv_folds = 3L, seed = 17L, dnn_device = "cpu", n_seeds = 1L,
    use_fused_adam = "off", dnn_mixed_precision = "off", dnn_cuda_graphs = "off"
  )
  defaulted <- env$fit_dnn_sdm(
    occ = occ, env_train_scaled = r, background_n = 100L,
    seed = 17L, dnn_device = "cpu", n_seeds = 1L,
    use_fused_adam = "off", dnn_mixed_precision = "off", dnn_cuda_graphs = "off"
  )

  malformed_low_folds <- c(1, 0.5, -0.5)
  for (value in malformed_low_folds) {
    normalized <- env$fit_dnn_sdm(
      occ = occ, env_train_scaled = r, background_n = 100L,
      cv_folds = value, seed = 17L, dnn_device = "cpu", n_seeds = 1L,
      use_fused_adam = "off", dnn_mixed_precision = "off", dnn_cuda_graphs = "off"
    )
    expect_equal(normalized$cv$k, 3L)
    expect_equal(length(normalized$fold_predictions), 3L)
  }

  expect_equal(length(calls), 3L + sdm_default_cv_folds + 3L * length(malformed_low_folds))
  expect_equal(explicit$cv$k, 3L)
  expect_equal(length(explicit$cv$fold_auc), 3L)
  expect_equal(length(explicit$fold_predictions), 3L)
  expect_equal(defaulted$cv$k, sdm_default_cv_folds)
  expect_equal(length(defaulted$cv$fold_auc), sdm_default_cv_folds)
  expect_equal(length(defaulted$fold_predictions), sdm_default_cv_folds)
})
