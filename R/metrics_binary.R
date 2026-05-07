# Shared binary classification metrics for SDM evaluation.

auc_rank <- function(obs, score) {
  ok <- is.finite(obs) & is.finite(score)
  obs <- as.integer(obs[ok])
  score <- as.numeric(score[ok])
  n1 <- sum(obs == 1)
  n0 <- sum(obs == 0)
  if (n1 == 0 || n0 == 0) return(NA_real_)
  r <- rank(score, ties.method = "average")
  as.numeric((sum(r[obs == 1]) - n1 * (n1 + 1) / 2) / (n1 * n0))
}

compute_binary_metrics <- function(obs, score, threshold = sdm_default_threshold) {
  threshold <- normalize_threshold(threshold)
  ok <- is.finite(obs) & is.finite(score)
  obs <- as.integer(obs[ok])
  score <- as.numeric(score[ok])
  if (length(obs) == 0) {
    return(list(auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_,
                threshold = threshold, tp = NA_integer_, fp = NA_integer_, tn = NA_integer_, fn = NA_integer_, n = 0L))
  }
  pred <- as.integer(score >= threshold)
  tp <- sum(obs == 1 & pred == 1)
  fn <- sum(obs == 1 & pred == 0)
  tn <- sum(obs == 0 & pred == 0)
  fp <- sum(obs == 0 & pred == 1)
  sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else NA_real_
  specificity <- if ((tn + fp) > 0) tn / (tn + fp) else NA_real_
  tss <- if (is.finite(sensitivity) && is.finite(specificity)) sensitivity + specificity - 1 else NA_real_
  list(
    auc = auc_rank(obs, score),
    tss = as.numeric(tss),
    sensitivity = as.numeric(sensitivity),
    specificity = as.numeric(specificity),
    threshold = threshold,
    tp = as.integer(tp), fp = as.integer(fp), tn = as.integer(tn), fn = as.integer(fn),
    n = as.integer(length(obs))
  )
}

metrics_list_to_row <- function(metrics, fold = NA_integer_) {
  data.frame(
    fold = as.integer(fold),
    auc = as.numeric(metrics$auc),
    tss = as.numeric(metrics$tss),
    sensitivity = as.numeric(metrics$sensitivity),
    specificity = as.numeric(metrics$specificity),
    threshold = as.numeric(metrics$threshold),
    tp = as.integer(metrics$tp), fp = as.integer(metrics$fp),
    tn = as.integer(metrics$tn), fn = as.integer(metrics$fn),
    n = as.integer(metrics$n),
    stringsAsFactors = FALSE
  )
}

metric_mean <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  if (length(x) == 0 || all(!is.finite(x))) return(NA_real_)
  mean(x, na.rm = TRUE)
}

metric_sd <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  if (length(x) < 2 || sum(is.finite(x)) < 2) return(NA_real_)
  stats::sd(x, na.rm = TRUE)
}

continuous_boyce_index <- function(pres_suit, bg_suit, n_bins = 101, win = 0.1) {
  pres_suit <- as.numeric(pres_suit)[is.finite(as.numeric(pres_suit))]
  bg_suit <- as.numeric(bg_suit)[is.finite(as.numeric(bg_suit))]
  n_pres <- length(pres_suit)
  n_bg <- length(bg_suit)

  note <- character(0)
  if (n_pres < 5) {
    return(list(cbi = NA_real_, bins = data.frame(), pe_ratio = NA_real_,
                note = "Insufficient presence points (< 5)"))
  }
  if (n_bg < 50) {
    return(list(cbi = NA_real_, bins = data.frame(), pe_ratio = NA_real_,
                note = "Insufficient background points (< 50)"))
  }

  all_vals <- c(pres_suit, bg_suit)
  min_v <- min(all_vals)
  max_v <- max(all_vals)
  if (abs(max_v - min_v) < 1e-10) {
    return(list(cbi = NA_real_, bins = data.frame(), pe_ratio = NA_real_,
                note = "No variance in predictions"))
  }

  bin_edges <- seq(min_v, max_v, length.out = n_bins + 1)
  bin_mid <- (bin_edges[-length(bin_edges)] + bin_edges[-1]) / 2
  pred_per_bin <- n_bg / n_bins
  obs_per_bin <- sapply(seq_len(n_bins), function(i) {
    sum(pres_suit >= bin_edges[i] & pres_suit < bin_edges[i + 1])
  })

  ratio <- ifelse(pred_per_bin > 0, obs_per_bin / pred_per_bin, 0)

  win_size <- max(1, floor(win * n_bins))
  smoothed <- sapply(seq_along(ratio), function(i) {
    lo <- max(1, i - win_size)
    hi <- min(n_bins, i + win_size)
    mean(ratio[lo:hi], na.rm = TRUE)
  })

  spearman_result <- tryCatch({
    test <- stats::cor.test(bin_mid, smoothed, method = "spearman", exact = FALSE)
    test$estimate
  }, error = function(e) NA_real_)

  cbi_value <- if (is.finite(spearman_result)) spearman_result else NA_real_
  pe_ratio <- mean(smoothed, na.rm = TRUE)

  list(
    cbi = as.numeric(cbi_value),
    bins = data.frame(bin_mid = bin_mid, ratio = ratio, smoothed = smoothed,
                      stringsAsFactors = FALSE),
    pe_ratio = as.numeric(pe_ratio),
    note = if (length(note) == 0) character(0) else note
  )
}
