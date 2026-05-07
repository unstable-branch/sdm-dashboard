test_that("permutation_importance returns required columns", {
  set.seed(42)
  obs <- c(rep(1, 30), rep(0, 70))
  model_data <- data.frame(
    presence = obs,
    bio1 = rnorm(100, mean = ifelse(obs == 1, 15, 10), sd = 3),
    bio12 = rnorm(100, mean = ifelse(obs == 1, 800, 600), sd = 200),
    noisy = rnorm(100)
  )

  mock_model <- list(model = NULL)
  mock_pred <- function(mod, newdata) {
    vals <- newdata$bio1 * 0.1 + newdata$bio12 * 0.001 + newdata$noisy * 0.0001
    1 / (1 + exp(-vals))
  }

  result <- permutation_importance(mock_model, model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 3, seed = 42)

  expect_true(is.data.frame(result))
  expect_true(all(c("variable", "importance", "sd", "baseline") %in% names(result)))
  expect_equal(nrow(result), 3)
  expect_true(all(result$variable %in% c("bio1", "bio12", "noisy")))
  expect_true(is.numeric(result$importance))
  expect_true(is.numeric(result$sd))
  expect_true(is.numeric(result$baseline))
})

test_that("permutation_importance respects n_perm = 1", {
  set.seed(99)
  obs <- c(rep(1, 20), rep(0, 50))
  model_data <- data.frame(
    presence = obs,
    var_a = rnorm(70, mean = ifelse(obs == 1, 10, 5), sd = 2),
    var_b = rnorm(70)
  )

  mock_model <- list()
  mock_pred <- function(mod, newdata) {
    1 / (1 + exp(-newdata$var_a * 0.3))
  }

  result <- permutation_importance(mock_model, model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 1, seed = 99)

  expect_equal(nrow(result), 2)
  expect_true(is.finite(result$baseline[1]))
})

test_that("permutation_importance gives higher importance to informative variable", {
  set.seed(123)
  n_pres <- 40
  n_bg <- 80
  obs <- c(rep(1, n_pres), rep(0, n_bg))

  truly_informative <- rnorm(n_pres + n_bg, mean = c(rep(12, n_pres), rep(8, n_bg)), sd = 2)
  noise_col <- rnorm(n_pres + n_bg, sd = 10)

  model_data <- data.frame(
    presence = obs,
    informative = truly_informative,
    noise = noise_col
  )

  mock_pred <- function(mod, newdata) {
    eta <- newdata$informative * 0.5 + newdata$noise * 0.001
    1 / (1 + exp(-eta))
  }

  result <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 5, seed = 123)

  imp_informative <- result$importance[result$variable == "informative"]
  imp_noise <- result$importance[result$variable == "noise"]

  expect_true(imp_informative > imp_noise,
              info = "Informative variable should have higher importance than noise")
})

test_that("noisy variable has importance close to zero", {
  set.seed(7)
  n <- 100
  obs <- sample(c(0, 1), size = n, replace = TRUE)
  noise_var <- rnorm(n, sd = 100)

  model_data <- data.frame(
    presence = obs,
    noise = noise_var
  )

  mock_pred <- function(mod, newdata) {
    rnorm(nrow(newdata), mean = 0.5, sd = 0.1)
  }

  result <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 5, seed = 7)

  imp_noise <- result$importance[result$variable == "noise"]
  expect_true(imp_noise < 0.05,
              info = paste("Noise variable should have near-zero importance, got:", round(imp_noise, 4)))
})

test_that("edge case: constant column returns zero importance", {
  model_data <- data.frame(
    presence = c(1, 0, 1, 0),
    constant_col = rep(5.0, 4),
    var2 = c(1.0, 2.0, 3.0, 4.0)
  )

  mock_pred <- function(mod, newdata) {
    rnorm(nrow(newdata), mean = 0.5, sd = 0.05)
  }

  result <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 3, seed = 42)

  const_row <- result[result$variable == "constant_col", ]
  expect_equal(const_row$importance, 0)
  expect_equal(const_row$sd, 0)
})

test_that("excluded columns are not treated as covariates", {
  model_data <- data.frame(
    presence = c(1, 0, 1, 0),
    .x = c(100, 101, 102, 103),
    .y = c(-30, -31, -32, -33),
    case_weight_sdm = c(1.2, 0.8, 1.1, 0.9),
    real_cov = c(1.5, 2.0, 2.5, 3.0)
  )

  mock_pred <- function(mod, newdata) {
    1 / (1 + exp(-newdata$real_cov))
  }

  result <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 2, seed = 42)

  expect_equal(nrow(result), 1)
  expect_equal(result$variable, "real_cov")
  expect_false(any(c(".x", ".y", "case_weight_sdm", "presence") %in% result$variable))
})

test_that("result is ordered by importance descending", {
  set.seed(55)
  obs <- c(rep(1, 30), rep(0, 70))
  model_data <- data.frame(
    presence = obs,
    strong = rnorm(100, mean = ifelse(obs == 1, 20, 10), sd = 2),
    weak = rnorm(100, mean = ifelse(obs == 1, 11, 9), sd = 2),
    noise = rnorm(100)
  )

  mock_pred <- function(mod, newdata) {
    1 / (1 + exp(-newdata$strong * 0.5 - newdata$weak * 0.05 + newdata$noise * 0.001))
  }

  result <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                   metric_fun = auc_rank, n_perm = 3, seed = 55)

  expect_true(result$importance[1] >= result$importance[2])
  expect_true(result$importance[2] >= result$importance[3])
})

test_that("null metric_fun uses auc_rank as default", {
  set.seed(321)
  model_data <- data.frame(
    presence = c(rep(1, 25), rep(0, 75)),
    cov1 = rnorm(100, mean = 10, sd = 2),
    cov2 = rnorm(100, mean = 5, sd = 1)
  )

  mock_pred <- function(mod, newdata) {
    rnorm(nrow(newdata), mean = 0.5, sd = 0.1)
  }

  result_with_explicit <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                                  metric_fun = auc_rank, n_perm = 2, seed = 321)
  result_with_null <- permutation_importance(list(), model_data, predict_fun = mock_pred,
                                            metric_fun = NULL, n_perm = 2, seed = 321)

  expect_equal(result_with_explicit$baseline, result_with_null$baseline)
  expect_equal(nrow(result_with_explicit), nrow(result_with_null))
})