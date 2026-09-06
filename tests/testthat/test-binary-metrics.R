# Tests for binary classification metrics (auc_rank, compute_binary_metrics,
# select_threshold) and the auc_rank inversion correction.
# helper-load.R and helper-fixtures.R are auto-sourced by testthat.

# ---- auc_rank ---------------------------------------------------------------

test_that("auc_rank returns 1 for perfect separation (presence higher)", {
  # All presences score above all backgrounds.
  # n_pos=2, n_neg=2 → unreliable flag is set (small sample).
  obs <- c(1, 1, 0, 0)
  score <- c(0.9, 0.8, 0.2, 0.1)
  val <- auc_rank(obs, score)
  expect_equal(as.numeric(val), 1)
  expect_true(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank inverts when presences score lower (model is reversed)", {
  # Presences (1) score in [0.1, 0.2], backgrounds (0) score in [0.8, 0.9].
  # Raw AUC ~ 0; after inversion = 1. With n=2 each group, unreliable is TRUE.
  obs <- c(1, 1, 0, 0)
  score <- c(0.1, 0.2, 0.8, 0.9)
  val <- auc_rank(obs, score)
  expect_equal(as.numeric(val), 1)
  expect_true(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank inverts AUC < 0.5 for unequal groups", {
  # With unequal groups, a reverse-ordered model produces raw AUC < 0.5.
  obs <- c(rep(1, 8), rep(0, 2))
  score <- c(seq(0.1, 0.8, length.out = 8), 0.9, 1.0)
  # Raw AUC would be < 0.5; after inversion should be > 0.5.
  val <- auc_rank(obs, score)
  expect_gte(val, 0.5)
})

test_that("auc_rank handles all-positive obs and returns NA", {
  obs <- c(1L, 1L, 1L, 1L)
  score <- c(0.9, 0.8, 0.7, 0.6)
  expect_equal(auc_rank(obs, score), NA_real_)
})

test_that("auc_rank handles all-negative obs and returns NA", {
  obs <- c(0L, 0L, 0L, 0L)
  score <- c(0.9, 0.8, 0.7, 0.6)
  expect_equal(auc_rank(obs, score), NA_real_)
})

test_that("auc_rank handles tied scores correctly", {
  # Two presences and two backgrounds, all with identical scores within class.
  # n_pos=2, n0=2 → unreliable flag is set.
  obs <- c(1L, 1L, 0L, 0L)
  score <- c(0.5, 0.5, 0.5, 0.5)
  val <- auc_rank(obs, score)
  expect_equal(as.numeric(val), 0.5)
  expect_true(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank inverts AUC < 0.5 (negative correlation)", {
  # With 15 presences scoring lower than 5 backgrounds, raw AUC < 0.5,
  # inverted to 1 - raw_AUC > 0.5.
  obs <- c(rep(1L, 15), rep(0L, 5))
  score <- c(seq(0.1, 0.4, length.out = 15), seq(0.6, 1.0, length.out = 5))
  val <- auc_rank(obs, score)
  expect_gte(val, 0.5)
})

test_that("auc_rank marks unreliable for n_pos < 25", {
  obs <- c(rep(1, 10), rep(0, 100))
  score <- c(runif(10, 0.6, 0.9), runif(100, 0.1, 0.4))
  val <- auc_rank(obs, score)
  expect_true(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank marks unreliable for n_neg < 25", {
  obs <- c(rep(1, 100), rep(0, 10))
  score <- c(runif(100, 0.6, 0.9), runif(10, 0.1, 0.4))
  val <- auc_rank(obs, score)
  expect_true(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank does not mark reliable for n >= 25 in both classes", {
  obs <- c(rep(1, 30), rep(0, 30))
  score <- c(runif(30, 0.6, 0.9), runif(30, 0.1, 0.4))
  val <- auc_rank(obs, score)
  expect_false(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank filters NA obs and NA scores", {
  obs <- c(1, 1, 0, 0, NA_integer_)
  score <- c(0.9, NA_real_, 0.2, 0.1, 0.5)
  val <- auc_rank(obs, score)
  # Should use only the first 4 valid entries, giving perfect separation.
  # n_pos=2, n0=2 → unreliable.
  expect_equal(as.numeric(val), 1)
  expect_true(isTRUE(attr(val, "unreliable")))
})

test_that("auc_rank is symmetric: swapping presence/background inverts score", {
  obs_a <- c(rep(1, 10), rep(0, 10))
  score_a <- c(runif(10, 0.6, 0.9), runif(10, 0.1, 0.4))
  obs_b <- c(rep(1, 10), rep(0, 10))
  score_b <- 1 - score_a  # perfectly inverted
  # After inversion correction, both should give the same result.
  expect_equal(auc_rank(obs_a, score_a), auc_rank(obs_b, score_b))
})

# ---- compute_binary_metrics -------------------------------------------------

test_that("compute_binary_metrics computes correct confusion matrix at threshold 0.5", {
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 0.5)
  expect_equal(m$tp, 2L)
  expect_equal(m$fp, 0L)
  expect_equal(m$tn, 2L)
  expect_equal(m$fn, 0L)
  expect_equal(m$sensitivity, 1)
  expect_equal(m$specificity, 1)
  expect_equal(m$tss, 1)
  expect_equal(round(m$auc, 3), 1)
})

test_that("compute_binary_metrics at threshold 0.95 (all presence below)", {
  # All presence scores < 0.95, all background scores < 0.95.
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 0.95)
  expect_equal(m$tp, 0L)
  expect_equal(m$fp, 0L)
  expect_equal(m$tn, 2L)
  expect_equal(m$fn, 2L)
  expect_equal(m$sensitivity, 0)
  expect_equal(m$specificity, 1)
  expect_equal(m$tss, 0)  # sens=0, spec=1, tss=0+1-1=0
})

test_that("compute_binary_metrics sensitivity and specificity at threshold 0.5", {
  # 3 presences above threshold, 1 below; 1 background above, 3 below.
  m <- compute_binary_metrics(
    obs = c(1, 1, 1, 1, 0, 0, 0, 0),
    score = c(0.9, 0.8, 0.7, 0.3, 0.6, 0.4, 0.2, 0.1),
    threshold = 0.5
  )
  expect_equal(m$tp, 3L)
  expect_equal(m$fn, 1L)
  expect_equal(m$fp, 1L)
  expect_equal(m$tn, 3L)
  expect_equal(m$sensitivity, 3/4)
  expect_equal(m$specificity, 3/4)
  expect_equal(m$tss, 3/4 + 3/4 - 1)
})

test_that("compute_binary_metrics with NA scores filters them out", {
  # obs and score are same length. Position 2 has NA score.
  # Filtered: obs = c(1, 0, 0), score = c(0.9, 0.2, 0.1), n=3 (1 presence, 2 bg).
  # At threshold 0.5: pred = c(1, 0, 0), tp=1, fn=0, fp=0, tn=2.
  obs <- c(1L, 1L, 0L, 0L)
  score <- c(0.9, NA_real_, 0.2, 0.1)
  m <- compute_binary_metrics(obs, score, threshold = 0.5)
  expect_equal(m$n, 3L)
  expect_equal(m$tp, 1L)
  expect_equal(m$fn, 0L)
  expect_equal(m$fp, 0L)
  expect_equal(m$tn, 2L)
})

test_that("compute_binary_metrics with empty obs returns n=0", {
  m <- compute_binary_metrics(integer(), numeric(), threshold = 0.5)
  expect_equal(m$n, 0L)
  expect_true(is.na(m$auc))
  expect_true(is.na(m$tss))
})

test_that("compute_binary_metrics sets auc_unreliable for n_pres < 25", {
  obs <- c(rep(1, 10), rep(0, 100))
  score <- c(runif(10, 0.6, 0.9), runif(100, 0.1, 0.4))
  m <- compute_binary_metrics(obs, score, threshold = 0.5)
  expect_true(m$auc_unreliable)
  expect_true(m$tss_unreliable)
})

test_that("compute_binary_metrics does not set unreliable for n >= 25", {
  obs <- c(rep(1, 30), rep(0, 30))
  score <- c(runif(30, 0.6, 0.9), runif(30, 0.1, 0.4))
  m <- compute_binary_metrics(obs, score, threshold = 0.5)
  expect_false(m$auc_unreliable)
  expect_false(m$tss_unreliable)
})

test_that("compute_binary_metrics handles threshold=0 (everything above)", {
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 0)
  expect_equal(m$tp, 2L)
  expect_equal(m$fp, 2L)
  expect_equal(m$tn, 0L)
  expect_equal(m$fn, 0L)
  expect_equal(m$sensitivity, 1)
  expect_equal(m$specificity, 0)
})

test_that("compute_binary_metrics handles threshold=1 (nothing above)", {
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 1)
  expect_equal(m$tp, 0L)
  expect_equal(m$fp, 0L)
  expect_equal(m$tn, 2L)
  expect_equal(m$fn, 2L)
  expect_equal(m$sensitivity, 0)
  expect_equal(m$specificity, 1)
})

# ---- select_threshold -------------------------------------------------------

test_that("select_threshold maximises TSS over candidate grid", {
  set.seed(99)
  # Bimodal: presences cluster near 0.8, backgrounds near 0.2.
  pres <- c(rbeta(50, 5, 2))   # mode ~0.7
  bg   <- c(rbeta(50, 2, 5))   # mode ~0.3
  opt <- select_threshold(pres, bg)
  expect_true(is.finite(opt$threshold))
  expect_true(opt$threshold > 0 && opt$threshold < 1)
  expect_true(is.finite(opt$max_tss))
  # The max_tss should be close to 1 for well-separated distributions.
  expect_gte(opt$max_tss, 0.5)
  expect_equal(opt$method, "max_tss")
})

test_that("select_threshold returns NA for too few samples (< 3)", {
  opt <- select_threshold(c(0.7, 0.8), c(0.1, 0.2))
  expect_true(is.na(opt$threshold))
  expect_true(is.na(opt$max_tss))
  expect_equal(opt$method, "fallback")
})

test_that("select_threshold returns NA when no threshold improves -Inf", {
  # When all predictions are tied (every threshold gives identical confusion matrix),
  # the first threshold (0.01) becomes the best. No NA is returned.
  pres <- rep(0.5, 10)
  bg   <- rep(0.5, 10)
  opt <- select_threshold(pres, bg)
  expect_false(is.na(opt$threshold))
  expect_equal(opt$method, "max_tss")
  # The fallback NA case is covered by the "too few samples" test above.
})

test_that("select_threshold deterministic tie-break", {
  # Two thresholds give the same max TSS; function should pick the first encountered.
  set.seed(1)
  pres <- c(rbeta(20, 5, 2))
  bg   <- c(rbeta(20, 2, 5))
  opt1 <- select_threshold(pres, bg)
  opt2 <- select_threshold(pres, bg)  # same seed, should be identical
  expect_identical(opt1$threshold, opt2$threshold)
  expect_identical(opt1$max_tss, opt2$max_tss)
})

test_that("select_threshold respects custom threshold grid", {
  set.seed(1)
  pres <- c(rbeta(50, 5, 2))
  bg   <- c(rbeta(50, 2, 5))
  opt <- select_threshold(pres, bg, thresholds = seq(0.1, 0.9, by = 0.1))
  expect_true(opt$threshold >= 0.1 && opt$threshold <= 0.9)
})

# ---- auc_rank / select_threshold integration --------------------------------

test_that("select_threshold with inverted predictions still finds a threshold", {
  # Presence scores are systematically lower than background (inverted model).
  # select_threshold still returns a threshold (the best available), but TSS=0
  # because no threshold can simultaneously give high sens AND high spec when
  # presences score lower than backgrounds.
  set.seed(42)
  pres <- runif(50, 0.1, 0.3)
  bg   <- runif(50, 0.7, 0.9)
  opt <- select_threshold(pres, bg)
  expect_true(is.finite(opt$threshold))
  expect_true(opt$threshold > 0 && opt$threshold < 1)
  # TSS is 0 for inverted predictions (best sens+spec-1 achieved at boundary).
  expect_equal(as.numeric(opt$max_tss), 0)
})

# ---- metrics_list_to_row ---------------------------------------------------

test_that("metrics_list_to_row preserves all required columns", {
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 0.5)
  row <- metrics_list_to_row(m, fold = 1L)
  expect_true(is.data.frame(row))
  expect_equal(row$fold, 1L)
  expect_equal(row$auc, 1)
  expect_equal(row$tss, 1)
  expect_equal(row$tp, 2L)
  expect_equal(row$fp, 0L)
  expect_equal(row$tn, 2L)
  expect_equal(row$fn, 0L)
})

# ---- metric_mean / metric_sd -----------------------------------------------

test_that("metric_mean returns NA for all-NA input", {
  expect_equal(metric_mean(c(NA_real_, NA_real_)), NA_real_)
})

test_that("metric_mean ignores NA values", {
  expect_equal(metric_mean(c(1, 2, NA_real_, 3)), 2)
})

test_that("metric_sd returns NA for single finite value", {
  expect_equal(metric_sd(c(1, NA_real_, NA_real_)), NA_real_)
})
