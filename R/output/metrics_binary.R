# Shared binary classification metrics for SDM evaluation.

auc_rank <- function(obs, score) {
  ok <- is.finite(obs) & is.finite(score)
  obs <- as.integer(obs[ok])
  score <- as.numeric(score[ok])
  n1 <- sum(obs == 1)
  n0 <- sum(obs == 0)
  if (n1 == 0 || n0 == 0) {
    return(NA_real_)
  }
  r <- rank(score, ties.method = "average")
  result <- as.numeric((sum(r[obs == 1]) - n1 * (n1 + 1) / 2) / (n1 * n0))
  if (n1 < 25 || n0 < 25) {
    attr(result, "unreliable") <- TRUE
  }
  result
}

compute_binary_metrics <- function(obs, score, threshold = sdm_default_threshold) {
  threshold <- normalize_threshold(threshold)
  if (!is.finite(threshold)) {
    threshold <- 0.5
  }
  ok <- is.finite(obs) & is.finite(score)
  obs <- as.integer(obs[ok])
  score <- as.numeric(score[ok])
  if (length(obs) == 0) {
    return(list(
      auc = NA_real_, tss = NA_real_, sensitivity = NA_real_, specificity = NA_real_,
      threshold = threshold, tp = NA_integer_, fp = NA_integer_, tn = NA_integer_, fn = NA_integer_, n = 0L
    ))
  }
  pred <- as.integer(score >= threshold)
  tp <- sum(obs == 1 & pred == 1)
  fn <- sum(obs == 1 & pred == 0)
  tn <- sum(obs == 0 & pred == 0)
  fp <- sum(obs == 0 & pred == 1)
  sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else NA_real_
  specificity <- if ((tn + fp) > 0) tn / (tn + fp) else NA_real_
  tss <- if (is.finite(sensitivity) && is.finite(specificity)) sensitivity + specificity - 1 else NA_real_
  auc_val <- auc_rank(obs, score)
  auc_unreliable <- isTRUE(attr(auc_val, "unreliable"))
  tss_unreliable <- length(obs) > 0 && (sum(obs == 1) < 25 || sum(obs == 0) < 25)
  list(
    auc = as.numeric(auc_val),
    tss = as.numeric(tss),
    sensitivity = as.numeric(sensitivity),
    specificity = as.numeric(specificity),
    threshold = threshold,
    tp = as.integer(tp), fp = as.integer(fp), tn = as.integer(tn), fn = as.integer(fn),
    n = as.integer(length(obs)),
    auc_unreliable = auc_unreliable,
    tss_unreliable = tss_unreliable
  )
}

select_threshold <- function(presence_suit, background_suit,
                              thresholds = seq(0.01, 0.99, by = 0.01)) {
  presence_suit <- as.numeric(presence_suit)[is.finite(as.numeric(presence_suit))]
  background_suit <- as.numeric(background_suit)[is.finite(as.numeric(background_suit))]
  if (length(presence_suit) < 3 || length(background_suit) < 3) {
    return(list(threshold = 0.5, max_tss = NA_real_, method = "fallback"))
  }
  best_tss <- -Inf
  best_threshold <- 0.5
  for (t in thresholds) {
    tp <- sum(presence_suit >= t, na.rm = TRUE)
    fn <- sum(presence_suit < t, na.rm = TRUE)
    tn <- sum(background_suit < t, na.rm = TRUE)
    fp <- sum(background_suit >= t, na.rm = TRUE)
    sens <- if ((tp + fn) > 0) tp / (tp + fn) else 0
    spec <- if ((tn + fp) > 0) tn / (tn + fp) else 0
    tss_val <- sens + spec - 1
    if (is.finite(tss_val) && tss_val > best_tss) {
      best_tss <- tss_val
      best_threshold <- t
    }
  }
  list(threshold = best_threshold, max_tss = best_tss, method = "max_tss")
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
  if (length(x) == 0 || all(!is.finite(x))) {
    return(NA_real_)
  }
  mean(x, na.rm = TRUE)
}

metric_sd <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  if (length(x) < 2 || sum(is.finite(x)) < 2) {
    return(NA_real_)
  }
  stats::sd(x, na.rm = TRUE)
}

continuous_boyce_index <- function(pres_suit, bg_suit, n_bins = 101, win = 0.1) {
  pres_suit <- as.numeric(pres_suit)[is.finite(as.numeric(pres_suit))]
  bg_suit <- as.numeric(bg_suit)[is.finite(as.numeric(bg_suit))]
  n_pres <- length(pres_suit)
  n_bg <- length(bg_suit)

  note <- character(0)
  if (n_pres < 5) {
    return(list(
      cbi = NA_real_, bins = data.frame(), pe_ratio = NA_real_,
      note = "Insufficient presence points (< 5)"
    ))
  }
  if (n_bg < 50) {
    return(list(
      cbi = NA_real_, bins = data.frame(), pe_ratio = NA_real_,
      note = "Insufficient background points (< 50)"
    ))
  }

  all_vals <- c(pres_suit, bg_suit)
  min_v <- min(all_vals)
  max_v <- max(all_vals)
  if (abs(max_v - min_v) < 1e-10) {
    return(list(
      cbi = NA_real_, bins = data.frame(), pe_ratio = NA_real_,
      note = "No variance in predictions"
    ))
  }

  bin_edges <- seq(min_v, max_v, length.out = n_bins + 1)
  bin_mid <- (bin_edges[-length(bin_edges)] + bin_edges[-1]) / 2
  bg_per_bin <- sapply(seq_len(n_bins), function(i) {
    if (i == n_bins) {
      sum(bg_suit >= bin_edges[i] & bg_suit <= bin_edges[i + 1])
    } else {
      sum(bg_suit >= bin_edges[i] & bg_suit < bin_edges[i + 1])
    }
  })
  obs_per_bin <- sapply(seq_len(n_bins), function(i) {
    if (i == n_bins) {
      sum(pres_suit >= bin_edges[i] & pres_suit <= bin_edges[i + 1])
    } else {
      sum(pres_suit >= bin_edges[i] & pres_suit < bin_edges[i + 1])
    }
  })

  bg_prop <- bg_per_bin / n_bg
  obs_prop <- obs_per_bin / n_pres
  ratio <- (obs_prop + .Machine$double.eps) / (bg_prop + .Machine$double.eps)

  win_size <- max(1, floor(win * n_bins))
  smoothed <- sapply(seq_along(ratio), function(i) {
    lo <- max(1, i - win_size)
    hi <- min(n_bins, i + win_size)
    mean(ratio[lo:hi], na.rm = TRUE)
  })

  keep <- is.finite(smoothed) & (bg_per_bin > 0 | obs_per_bin > 0)
  spearman_result <- tryCatch(
    {
      if (sum(keep) < 3) {
        NA_real_
      } else {
        test <- stats::cor.test(bin_mid[keep], smoothed[keep], method = "spearman", exact = FALSE)
        test$estimate
      }
    },
    error = function(e) NA_real_
  )

  cbi_value <- if (is.finite(spearman_result)) spearman_result else NA_real_
  pe_ratio <- mean(smoothed, na.rm = TRUE)

  list(
    cbi = as.numeric(cbi_value),
    bins = data.frame(
      bin_mid = bin_mid, ratio = ratio, smoothed = smoothed,
      stringsAsFactors = FALSE
    ),
    pe_ratio = as.numeric(pe_ratio),
    note = if (length(note) == 0) character(0) else note
  )
}

compute_projection_metrics <- function(suit_raster, train_presence_suit,
                                       threshold, n_bg_samples = 1000L,
                                       validation_occ = NULL,
                                       seed = 42,
                                       log_fun = NULL) {
  bb <- terra::ext(suit_raster)
  set.seed(seed)
  bg_xy <- data.frame(
    x = runif(n_bg_samples, bb$xmin, bb$xmax),
    y = runif(n_bg_samples, bb$ymin, bb$ymax)
  )
  extracted <- terra::extract(suit_raster, bg_xy)
  # terra::extract() prepends an ID column by default; suitability is the
  # raster value column, not the 1..n sample identifier.
  bg_suit <- if (ncol(extracted) > 1) extracted[[2]] else numeric(0)

  pCBI <- continuous_boyce_index(pres_suit = train_presence_suit, bg_suit = bg_suit)$cbi

  pct_exceeding <- mean(bg_suit >= threshold, na.rm = TRUE) * 100
  mean_bg_suit <- mean(bg_suit, na.rm = TRUE)

  risk_level <- if (!is.finite(pCBI) || pCBI < 0.4) "LOW" else if (pCBI < 0.7) "MEDIUM" else "HIGH"

  validation_result <- NULL
  if (!is.null(validation_occ) && is.data.frame(validation_occ) && nrow(validation_occ) > 0) {
    valid <- !is.na(validation_occ$decimalLatitude) & !is.na(validation_occ$decimalLongitude)
    pts <- validation_occ[valid, c("decimalLongitude", "decimalLatitude"), drop = FALSE]
    if (nrow(pts) > 0) {
      extracted_val <- terra::extract(suit_raster, pts)
      incursion_suit <- if (ncol(extracted_val) > 1) extracted_val[[2]] else numeric(0)
      n_valid <- sum(valid)
      n_exceed <- sum(incursion_suit >= threshold, na.rm = TRUE)
      validation_result <- list(
        n_provided = nrow(validation_occ),
        n_valid = n_valid,
        n_exceeding_threshold = n_exceed,
        pct_exceeding = n_exceed / n_valid * 100,
        mean_suitability = mean(incursion_suit, na.rm = TRUE)
      )
    }
  }

  log_message(log_fun, "Projection CBI: ", sprintf("%.3f", pCBI), " (", risk_level, ")")

  list(
    projection_cbi = pCBI,
    risk_level = risk_level,
    pct_above_threshold = pct_exceeding,
    mean_projection_suitability = mean_bg_suit,
    n_bg_sampled = n_bg_samples,
    validation = validation_result
  )
}
