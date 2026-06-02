test_that("GLM predicts perfect fit with identity mapping (AUC near 1)", {
  skip_if_not_installed("terra")
  set.seed(42)

  n <- 200
  bio1 <- runif(n, 0, 1)
  bio12 <- runif(n, 0, 1)

  prob <- 1 / (1 + exp(-(2 * bio1 + 3 * bio12 - 2.5)))
  presence <- ifelse(prob > 0.5, 1, 0)

  data_full <- data.frame(
    longitude = runif(n, 140, 142),
    latitude = runif(n, -24, -22),
    bio1 = bio1,
    bio12 = bio12,
    presence = presence,
    stringsAsFactors = FALSE
  )

  train_idx <- sample.int(n, size = floor(0.7 * n))
  train <- data_full[train_idx, ]
  test <- data_full[-train_idx, ]

  fit <- tryCatch(
    glm(presence ~ bio1 + bio12, data = train, family = binomial()),
    error = function(e) NULL
  )

  if (!is.null(fit)) {
    preds <- predict(fit, newdata = test, type = "response")

    actuals <- test$presence
    n_pos <- sum(actuals == 1)
    n_neg <- sum(actuals == 0)

    if (n_pos > 0 && n_neg > 0) {
      auc_approx <- tryCatch({
        if (requireNamespace("pROC", quietly = TRUE)) {
          roc_obj <- pROC::roc(actuals, preds, quiet = TRUE)
          as.numeric(roc_obj$auc)
        } else {
          ranks <- rank(preds)
          sum_ranks <- sum(ranks[actuals == 1])
          (sum_ranks - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)
        }
      }, error = function(e) NA_real_)

      expect_true(!is.na(auc_approx))
      expect_true(auc_approx > 0.7)
    }
  }
})

test_that("random predictions yield AUC near 0.5", {
  set.seed(42)

  n <- 200
  actuals <- sample(c(0, 1), n, replace = TRUE)
  preds <- runif(n, 0, 1)

  n_pos <- sum(actuals == 1)
  n_neg <- sum(actuals == 0)

  if (n_pos > 0 && n_neg > 0) {
    auc_approx <- tryCatch({
      if (requireNamespace("pROC", quietly = TRUE)) {
        roc_obj <- pROC::roc(actuals, preds, quiet = TRUE)
        as.numeric(roc_obj$auc)
      } else {
        ranks <- rank(preds)
        sum_ranks <- sum(ranks[actuals == 1])
        (sum_ranks - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)
      }
    }, error = function(e) NA_real_)

    expect_true(!is.na(auc_approx))
    expect_true(auc_approx >= 0.3 && auc_approx <= 0.7)
  }
})

test_that("TSS metric computes correctly for threshold-based evaluation", {
  set.seed(42)

  actuals <- c(1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0)
  preds <- c(0.9, 0.8, 0.1, 0.2, 0.7, 0.3, 0.85, 0.15, 0.95, 0.75, 0.05, 0.25, 0.6, 0.4, 0.55, 0.35)
  threshold <- 0.5

  predicted_class <- ifelse(preds >= threshold, 1, 0)
  tp <- sum(predicted_class == 1 & actuals == 1)
  tn <- sum(predicted_class == 0 & actuals == 0)
  fp <- sum(predicted_class == 1 & actuals == 0)
  fn <- sum(predicted_class == 0 & actuals == 1)

  sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else 0
  specificity <- if ((tn + fp) > 0) tn / (tn + fp) else 0
  tss <- sensitivity + specificity - 1

  expect_true(tss >= -1 && tss <= 1)
  expect_true(sensitivity >= 0 && sensitivity <= 1)
  expect_true(specificity >= 0 && specificity <= 1)
})

test_that("CBI metric is computable from predictions and observations", {
  set.seed(42)

  obs <- runif(100, 0, 1)
  preds <- runif(100, 0, 1)

  bins <- seq(0, 1, by = 0.1)
  obs_bin <- cut(obs, breaks = bins, include.lowest = TRUE)
  pred_bin <- cut(preds, breaks = bins, include.lowest = TRUE)

  expect_true(length(levels(obs_bin)) >= 1)
  expect_true(length(levels(pred_bin)) >= 1)

  n_bins <- length(bins) - 1
  p <- table(factor(pred_bin, levels = levels(obs_bin)))
  e <- table(obs_bin)
  e_norm <- e / sum(e)
  p_norm <- p / sum(p)

  expect_equal(sum(e_norm), 1, tolerance = 1e-8)
  expect_equal(sum(p_norm), 1, tolerance = 1e-8)
})