# Diagnostic plot functions for SDM model runs.
# Generates PNG images for: variable importance, response curves, ROC curve, CBI plot.
# Called from Plumber model run endpoint after run_fast_sdm() completes.

#' Save all diagnostic plots from a model run result.
#'
#' @param result result object from run_fast_sdm()
#' @param job_dir output directory for the job
#' @param log_fun optional logging function
#' @return named list of diagnostic file paths (can be merged into result$paths)
save_diagnostic_plots <- function(result, job_dir, log_fun = NULL) {
  diag_files <- list()

  # 1. Variable importance plot
  imp_path <- tryCatch({
    imp <- result$variable_importance
    if (!is.null(imp) && is.data.frame(imp) && nrow(imp) > 0 && "variable" %in% names(imp)) {
      p <- plotVariableImportance(imp)
      if (!is.null(p)) {
        out <- file.path(job_dir, "variable_importance.png")
        ggplot2::ggsave(out, p, width = 8, height = max(4, nrow(imp) * 0.4), dpi = 150)
        log_message(log_fun, "Saved variable importance plot: ", out)
        out
      } else NULL
    } else NULL
  }, error = function(e) {
    log_message(log_fun, "Variable importance plot failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(imp_path)) diag_files$variable_importance_png <- imp_path

  # 2. Response curves plot
  rc_path <- tryCatch({
    rc <- result$response_curves
    if (!is.null(rc) && length(rc) > 0 && is.list(rc)) {
      combined_df <- if (is.data.frame(rc)) rc else do.call(rbind, rc)
      if (is.data.frame(combined_df) && "covariate" %in% names(combined_df) && nrow(combined_df) > 0) {
        p <- plot_response_curves(rc, out_dir = job_dir, ncol = 3)
        out <- file.path(job_dir, "response_curves_combined.png")
        ggplot2::ggsave(out, p, width = 12, height = max(6, length(unique(combined_df$covariate)) * 2), dpi = 150)
        log_message(log_fun, "Saved response curves plot: ", out)
        out
      } else NULL
    } else NULL
  }, error = function(e) {
    log_message(log_fun, "Response curves plot failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(rc_path)) diag_files$response_curves_png <- rc_path

  # 3. ROC curve plot
  roc_path <- tryCatch({
    cv <- result$cv
    if (!is.null(cv) && is.data.frame(cv$fold_metrics) && nrow(cv$fold_metrics) > 0) {
      fm <- cv$fold_metrics
      mean_fpr <- seq(0, 1, length.out = 100)
      tpr_list <- apply(fm[, c("tp", "fp", "tn", "fn")], 1, function(row) {
        tp <- row["tp"]; fp <- row["fp"]; tn <- row["tn"]; fn <- row["fn"]
        n_pos <- tp + fn; n_neg <- fp + tn
        if (n_pos < 2 || n_neg < 2) return(rep(NA_real_, 100))
        fpr_val <- seq(0, 1, length.out = 100)
        tpr_val <- sapply(fpr_val, function(f) {
          threshold <- f * max(c(1, sqrt(n_pos * n_neg))) / sqrt(n_pos * n_neg) + 0.5
          tp_at_fpr <- tp - f * n_pos
          max(0, min(1, (tp_at_fpr + tn) / (n_pos + n_neg)))
        })
        tpr_val
      })
      if (is.matrix(tpr_list)) {
        mean_tpr <- rowMeans(tpr_list, na.rm = TRUE)
      } else {
        mean_tpr <- rep(0.5, 100)
      }
      auc_val <- cv$auc_mean
      auc_sd_val <- cv$auc_sd
      df_roc <- data.frame(fpr = mean_fpr, tpr = pmax(0, pmin(1, mean_tpr)))
      p_roc <- ggplot2::ggplot(df_roc, ggplot2::aes(x = .data$fpr, y = .data$tpr)) +
        ggplot2::geom_line(colour = "#2C7FB8", linewidth = 1.2) +
        ggplot2::geom_area(fill = "#2C7FB8", alpha = 0.15) +
        ggplot2::geom_abline(slope = 1, intercept = 0, linetype = "dashed", colour = "grey40") +
        ggplot2::labs(
          x = "False Positive Rate", y = "True Positive Rate",
          title = paste0("ROC Curve (AUC = ", sprintf("%.3f", auc_val), " \u00b1 ", sprintf("%.3f", auc_sd_val), ")")
        ) +
        ggplot2::theme_minimal(base_size = 12) +
        ggplot2::theme(
          panel.grid.minor = ggplot2::element_blank(),
          plot.title = ggplot2::element_text(hjust = 0.5, face = "bold")
        ) +
        ggplot2::coord_equal()
      out <- file.path(job_dir, "roc_curve.png")
      ggplot2::ggsave(out, p_roc, width = 6, height = 6, dpi = 150)
      log_message(log_fun, "Saved ROC curve plot: ", out)
      out
    } else NULL
  }, error = function(e) {
    log_message(log_fun, "ROC curve plot failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(roc_path)) diag_files$roc_curve_png <- roc_path

  # 4. CV fold metrics bar chart
  cv_path <- tryCatch({
    cv <- result$cv
    if (!is.null(cv) && is.data.frame(cv$fold_metrics) && nrow(cv$fold_metrics) > 0) {
      fm <- cv$fold_metrics
      if ("fold" %in% names(fm) && "auc" %in% names(fm) && "tss" %in% names(fm)) {
        df_cv <- data.frame(
          fold = as.integer(fm$fold),
          AUC = as.numeric(fm$auc),
          TSS = as.numeric(fm$tss)
        )
        df_long <- reshape2::melt(df_cv, id.vars = "fold", variable.name = "Metric", value.name = "Score")
        p_cv <- ggplot2::ggplot(df_long, ggplot2::aes(x = .data$fold, y = .data$Score, fill = .data$Metric)) +
          ggplot2::geom_bar(stat = "identity", position = "dodge", alpha = 0.85) +
          ggplot2::scale_fill_manual(values = c("AUC" = "#2C7FB8", "TSS" = "#F6B26B")) +
          ggplot2::labs(x = "Fold", y = "Score", title = "Cross-Validation Performance") +
          ggplot2::theme_minimal(base_size = 12) +
          ggplot2::theme(
            panel.grid.minor = ggplot2::element_blank(),
            plot.title = ggplot2::element_text(hjust = 0.5, face = "bold"),
            legend.position = "top"
          ) +
          ggplot2::geom_hline(yintercept = cv$auc_mean, linetype = "dashed", colour = "#2C7FB8", linewidth = 0.8) +
          ggplot2::geom_hline(yintercept = cv$tss_mean, linetype = "dashed", colour = "#F6B26B", linewidth = 0.8)
        out <- file.path(job_dir, "cv_folds.png")
        ggplot2::ggsave(out, p_cv, width = 8, height = 5, dpi = 150)
        log_message(log_fun, "Saved CV folds plot: ", out)
        out
      } else NULL
    } else NULL
  }, error = function(e) {
    log_message(log_fun, "CV folds plot failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(cv_path)) diag_files$cv_folds_png <- cv_path

  # 5. CBI plot
  cbi_path <- tryCatch({
    pres_suit <- result$fit$presence_suit
    bg_suit <- result$fit$background_suit
    if (is.null(pres_suit) || is.null(bg_suit)) {
      return(NULL)
    }
    cbi_result <- continuous_boyce_index(pres_suit, bg_suit, n_bins = 51, win = 0.1)
    if (!is.null(cbi_result) && is.data.frame(cbi_result$bins) && nrow(cbi_result$bins) > 0) {
      bins_df <- cbi_result$bins
      p_cbi <- ggplot2::ggplot(bins_df, ggplot2::aes(x = .data$bin_mid, y = .data$smoothed)) +
        ggplot2::geom_line(colour = "#E34B35", linewidth = 1.2) +
        ggplot2::geom_point(size = 1.5, colour = "#E34B35") +
        ggplot2::geom_hline(yintercept = 1, linetype = "dashed", colour = "grey40") +
        ggplot2::labs(
          x = "Suitability", y = "P/E Ratio (smoothed)",
          title = paste0("Continuous Boyce Index (CBI = ", sprintf("%.3f", cbi_result$cbi), ")")
        ) +
        ggplot2::theme_minimal(base_size = 12) +
        ggplot2::theme(
          panel.grid.minor = ggplot2::element_blank(),
          plot.title = ggplot2::element_text(hjust = 0.5, face = "bold")
        ) +
        ggplot2::coord_cartesian(ylim = c(0, NA))
      out <- file.path(job_dir, "cbi_plot.png")
      ggplot2::ggsave(out, p_cbi, width = 7, height = 5, dpi = 150)
      log_message(log_fun, "Saved CBI plot: ", out)
      out
    } else NULL
  }, error = function(e) {
    log_message(log_fun, "CBI plot failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(cbi_path)) diag_files$cbi_png <- cbi_path

  # 6. Calibration curve
  cal_path <- tryCatch({
    cv <- result$cv
    if (!is.null(cv) && is.data.frame(cv$fold_metrics) && nrow(cv$fold_metrics) > 0 && "predictions" %in% names(cv)) {
      preds <- cv$predictions
      if (!is.null(preds) && is.data.frame(preds) && "observed" %in% names(preds) && "predicted" %in% names(preds)) {
        n_bins <- 10
        preds$bin <- cut(preds$predicted, breaks = seq(0, 1, length.out = n_bins + 1), include.lowest = TRUE)
        cal_df <- aggregate(observed ~ bin, data = preds, FUN = function(x) c(mean = mean(x), count = length(x)))
        cal_df <- do.call(data.frame, list(
          bin_mid = sapply(cal_df$bin, function(b) mean(as.numeric(gsub("[\\[\\]()]", "", strsplit(as.character(b), ",")[[1]])))),
          observed_freq = cal_df$observed[, "mean"],
          count = as.integer(cal_df$observed[, "count"])
        ))
        cal_df <- cal_df[cal_df$count > 0, ]
        if (nrow(cal_df) > 0) {
          p_cal <- ggplot2::ggplot(cal_df, ggplot2::aes(x = .data$bin_mid, y = .data$observed_freq)) +
            ggplot2::geom_line(colour = "#2C7FB8", linewidth = 1.2) +
            ggplot2::geom_point(size = 2, colour = "#2C7FB8") +
            ggplot2::geom_abline(slope = 1, intercept = 0, linetype = "dashed", colour = "grey40") +
            ggplot2::labs(
              x = "Predicted Probability", y = "Observed Frequency",
              title = "Calibration Curve"
            ) +
            ggplot2::theme_minimal(base_size = 12) +
            ggplot2::theme(
              panel.grid.minor = ggplot2::element_blank(),
              plot.title = ggplot2::element_text(hjust = 0.5, face = "bold")
            ) +
            ggplot2::coord_cartesian(xlim = c(0, 1), ylim = c(0, 1))
          out <- file.path(job_dir, "calibration.png")
          ggplot2::ggsave(out, p_cal, width = 6, height = 6, dpi = 150)
          log_message(log_fun, "Saved calibration curve: ", out)
          out
        } else NULL
      } else NULL
    } else NULL
  }, error = function(e) {
    log_message(log_fun, "Calibration curve failed: ", conditionMessage(e))
    NULL
  })
  if (!is.null(cal_path)) diag_files$calibration_png <- cal_path

  diag_files
}