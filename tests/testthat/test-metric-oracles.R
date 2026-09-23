# P1-04 acceptance oracle: AUC direction, ties, NA/constant/single-class
# handling, and label-domain strictness for auc_rank / compute_binary_metrics.
#
# The pairwise oracle below is an independent implementation of the
# Mann-Whitney statistic: AUC = P(score_presence > score_background)
# + 0.5 * P(tie), averaged over all presence/background pairs. It shares no
# code with auc_rank (which uses average ranks), so agreement is evidence, not
# tautology. auc_rank attaches an "unreliable" attribute for small groups, so
# numeric comparisons strip attributes; the attribute itself is asserted
# separately in test-binary-metrics.R.

pairwise_auc_oracle <- function(obs, score) {
  # Strict domain: fractional (e.g. soft 0.5), negative, and out-of-range
  # labels are not binary and must be excluded from both pairing and the
  # score pool — matching auc_rank's filter without integer truncation.
  ok <- is.finite(obs) & is.finite(score) & (obs %in% c(0, 1))
  obs <- obs[ok]
  score <- as.numeric(score[ok])
  pres <- score[obs == 1]
  bg <- score[obs == 0]
  if (length(pres) == 0L || length(bg) == 0L) return(NA_real_)
  gt <- 0
  tie <- 0
  for (p in pres) {
    gt <- gt + sum(bg < p)
    tie <- tie + sum(bg == p)
  }
  (gt + 0.5 * tie) / (length(pres) * length(bg))
}

test_that("auc_rank matches the pairwise Mann-Whitney oracle on deterministic fixtures", {
  fixtures <- list(
    list(obs = c(1, 1, 0, 0), score = c(0.9, 0.8, 0.2, 0.1)),   # perfect
    list(obs = c(1, 1, 0, 0), score = c(0.1, 0.2, 0.8, 0.9)),   # perfectly inverted
    list(obs = c(1, 0, 1, 0, 1, 0), score = c(0.9, 0.85, 0.5, 0.4, 0.3, 0.1)),
    list(obs = c(1, 1, 1, 0, 0, 0), score = c(0.9, 0.2, 0.8, 0.1, 0.7, 0.3)),
    list(obs = c(rep(1, 30), rep(0, 30)),
         score = c(seq(0.51, 0.80, length.out = 30), seq(0.20, 0.50, length.out = 30)))
  )
  for (fx in fixtures) {
    expect_equal(as.numeric(auc_rank(fx$obs, fx$score)), pairwise_auc_oracle(fx$obs, fx$score))
  }
  # Hand-computed anchor points.
  expect_equal(as.numeric(auc_rank(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1))), 1)
  expect_equal(as.numeric(auc_rank(c(1, 1, 0, 0), c(0.1, 0.2, 0.8, 0.9))), 0)
  # 3x3 with exactly five inversions: presence 2 loses to background 5 and 10,
  # presence 4 loses to 5 and 10, presence 9 loses to 10 -> (9 - 5) / 9.
  expect_equal(as.numeric(auc_rank(c(1, 1, 1, 0, 0, 0), c(2, 4, 9, 1, 5, 10))), 4 / 9)
  # Perfectly interleaved large fixture: presence 0.51..0.80 all above
  # background 0.20..0.50 -> separation holds at n = 30 per class.
  expect_equal(as.numeric(auc_rank(c(rep(1, 30), rep(0, 30)),
                                   c(seq(0.51, 0.80, length.out = 30), seq(0.20, 0.50, length.out = 30)))), 1)
})

test_that("auc_rank ignores labels outside {0,1} when ranking", {
  # The 2 label is neither presence nor background: it must neither pair nor
  # contribute its score to the rank pool. AUC stays 1.0.
  expect_equal(as.numeric(auc_rank(c(1, 0, 2), c(1, 0, 0.5))), 1)
  # Same fixture with a poison score on the stray label: still 1.0.
  expect_equal(as.numeric(auc_rank(c(1, 0, 2), c(1, 0, 1e9))), 1)
})

test_that("auc_rank excludes fractional soft labels instead of truncating them", {
  # as.integer(0.5) == 0, so pre-fix code counted the 0.5 label as background
  # and scored 0.5; the strict domain omits it entirely -> 1.0.
  expect_equal(as.numeric(auc_rank(c(1, 0, 0.5), c(0.9, 0.1, 1))), 1)
  # as.integer(-0.5) == 0 truncates a negative soft label to background too.
  expect_equal(as.numeric(auc_rank(c(1, 0, -0.5), c(0.9, 0.1, 1))), 1)
  # as.integer(1.9) == 1 promoted an out-of-range label to presence; with its
  # low poison score the truncated run scores 0.5 vs the strict-domain 1.0.
  expect_equal(as.numeric(auc_rank(c(1, 0, 1.9), c(0.9, 0.1, 0.05))), 1)
  # Oracle agreement on the same non-binary fixtures (strict-domain oracle).
  expect_equal(as.numeric(auc_rank(c(1, 0, 0.5), c(0.9, 0.1, 1))),
               pairwise_auc_oracle(c(1, 0, 0.5), c(0.9, 0.1, 1)))
  expect_equal(as.numeric(auc_rank(c(1, 0, 1.9), c(0.9, 0.1, 0.05))),
               pairwise_auc_oracle(c(1, 0, 1.9), c(0.9, 0.1, 0.05)))
  # Binary integer callers are unaffected by the stricter filter.
  expect_equal(as.numeric(auc_rank(c(1, 0, 1, 0), c(0.9, 0.1, 0.8, 0.2))), 1)
})

test_that("auc_rank scores all-tied predictions at 0.5 regardless of class mix", {
  expect_equal(as.numeric(auc_rank(c(1, 1, 0, 0), c(0.5, 0.5, 0.5, 0.5))), 0.5)
  expect_equal(as.numeric(auc_rank(c(1, 1, 1, 0), rep(0.7, 4))), 0.5)
})

test_that("auc_rank partial ties average correctly", {
  # 1 background ties 1 presence: tie contributes 0.5 -> (3 + 0.5)/4 = 0.875.
  expect_equal(as.numeric(auc_rank(c(1, 1, 0, 0), c(0.9, 0.5, 0.5, 0.1))), 0.875)
})

test_that("auc_rank returns NA for single-class, empty, and all-NA inputs", {
  expect_equal(as.numeric(auc_rank(c(1, 1, 1), c(0.9, 0.5, 0.1))), NA_real_)
  expect_equal(as.numeric(auc_rank(c(0, 0), c(0.9, 0.1))), NA_real_)
  expect_equal(as.numeric(auc_rank(numeric(0), numeric(0))), NA_real_)
  expect_equal(as.numeric(auc_rank(c(NA, NA), c(NA, NA))), NA_real_)
  expect_equal(as.numeric(auc_rank(c(1, 0, NA, 0), c(0.9, 0.1, 0.5, 0.2))), 1)
})

test_that("auc_rank filters non-finite scores before ranking", {
  expect_equal(as.numeric(auc_rank(c(1, 0, 1, 0), c(0.9, 0.1, Inf, 0.2))), 1)
})

test_that("compute_binary_metrics reports fixed-direction AUC below 0.5 for inverted scores", {
  m <- compute_binary_metrics(c(1, 1, 0, 0), c(0.1, 0.2, 0.8, 0.9), threshold = 0.5)
  expect_equal(m$auc, 0)
  expect_true(isTRUE(m$auc_unreliable))
  # Swapping scores must complement the AUC exactly: direction is a property
  # of the score, never of the labels.
  m2 <- compute_binary_metrics(c(1, 1, 0, 0), c(0.9, 0.8, 0.2, 0.1), threshold = 0.5)
  expect_equal(m$auc + m2$auc, 1)
})

# ---- downstream ensemble weights (P1-04: ranking/weights consumers) ---------

test_that("multi-ensemble AUC weights are proportional to squared excess over random", {
  # (0.9 - 0.5)^2 : (0.7 - 0.5)^2 = 0.16 : 0.04 -> 0.8 / 0.2.
  cv_list <- list(a = list(auc_mean = 0.9, tss_mean = 0.6),
                  b = list(auc_mean = 0.7, tss_mean = 0.4))
  w <- compute_multi_ensemble_weights(cv_list, "auc", power = 2)
  expect_equal(unname(w), c(0.8, 0.2), tolerance = 1e-8)
})

test_that("multi-ensemble AUC weights give an inverted component zero weight", {
  cv_list <- list(good = list(auc_mean = 0.9, tss_mean = 0.8),
                  inverted = list(auc_mean = 0.1, tss_mean = -0.2))
  w <- compute_multi_ensemble_weights(cv_list, "auc", power = 2)
  expect_equal(unname(w), c(1, 0), tolerance = 1e-8)
})

test_that("multi-ensemble TSS weights use raw skill, not a 0.5 floor", {
  # TSS has no-information level 0 (not 0.5): a component with tss 0.2 must
  # keep real weight (0.2^2) instead of being conflated with random skill
  # via the AUC-style 0.5 floor. Expected (0.6^2, 0.2^2) / (0.36 + 0.04).
  cv_list <- list(a = list(tss_mean = 0.6, auc_mean = 0.9),
                  b = list(tss_mean = 0.2, auc_mean = 0.6))
  w <- compute_multi_ensemble_weights(cv_list, "tss", power = 2)
  expect_equal(unname(w), c(0.36 / 0.40, 0.04 / 0.40), tolerance = 1e-8)
})

test_that("multi-ensemble TSS weights give a component with missing TSS zero weight", {
  # A component without any tss_mean entry carries no measured skill; its
  # fallback is the TSS no-information level 0, not the AUC random level 0.5.
  cv_list <- list(good = list(tss_mean = 0.6), missing = list())
  w <- compute_multi_ensemble_weights(cv_list, "tss", power = 2)
  expect_equal(unname(w), c(1, 0), tolerance = 1e-8)
})

test_that("multi-ensemble TSS weights give an NA-TSS component zero weight", {
  cv_list <- list(good = list(tss_mean = 0.6), bad = list(tss_mean = NA_real_))
  w <- compute_multi_ensemble_weights(cv_list, "tss", power = 2)
  expect_equal(unname(w), c(1, 0), tolerance = 1e-8)
  # All components unmeasured: no evidence, equal fallback weights.
  w_all <- compute_multi_ensemble_weights(
    list(x = list(tss_mean = NA_real_), y = list(auc_mean = 0.7)), "tss", power = 2)
  expect_equal(unname(w_all), c(0.5, 0.5), tolerance = 1e-8)
})

test_that("multi-ensemble AUC weights are equal when no component beats random", {
  cv_list <- list(x = list(auc_mean = 0.3, tss_mean = -0.4),
                  y = list(auc_mean = 0.1, tss_mean = -0.8))
  w <- compute_multi_ensemble_weights(cv_list, "auc", power = 2)
  expect_equal(unname(w), c(0.5, 0.5), tolerance = 1e-8)
})

test_that("multi-ensemble treats missing metrics as random-skill components in AUC mode", {
  cv_list <- list(with_metric = list(auc_mean = 0.9, tss_mean = 0.5),
                  missing = list(tss_mean = 0.5))
  w <- compute_multi_ensemble_weights(cv_list, "auc", power = 2)
  # missing -> 0.5 fallback -> zero evidence; with_metric takes all weight.
  expect_equal(unname(w), c(1, 0), tolerance = 1e-8)
})

test_that("two-model ensemble weights give an inverted component zero weight", {
  glm_fit <- list(cv = list(auc_mean = 0.9, tss_mean = 0.6))
  rangebag_fit <- list(cv = list(auc_mean = 0.2, tss_mean = -0.3))
  w <- ensemble_model_weights(glm_fit, rangebag_fit, weighting = "auc")
  expect_equal(unname(w), c(1, 0), tolerance = 1e-8)
})

test_that("two-model ensemble weights fall back to 0.5/0.5 when no AUC evidence", {
  glm_fit <- list(cv = list(auc_mean = 0.4, tss_mean = -0.2))
  rangebag_fit <- list(cv = list(auc_mean = 0.1))
  w <- ensemble_model_weights(glm_fit, rangebag_fit, weighting = "auc")
  expect_equal(unname(w), c(0.5, 0.5), tolerance = 1e-8)
})
