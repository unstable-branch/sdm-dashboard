handle_diagnostics_vif <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    env_info <- result$environment
    vif_result <- env_info$vif_result

    if (is.null(vif_result)) {
      return(list(
        available = FALSE,
        message = "VIF reduction was not enabled for this run",
        selected_vars = env_info$names %||% character(0)
      ))
    }

    vif_history <- if (!is.null(vif_result$vif_history) && is.data.frame(vif_result$vif_history)) {
      lapply(seq_len(nrow(vif_result$vif_history)), function(i) as.list(vif_result$vif_history[i, ]))
    } else {
      list()
    }

    list(
      available = TRUE,
      selected = vif_result$selected %||% character(0),
      dropped = vif_result$dropped %||% character(0),
      vif_final = vif_result$vif_final,
      vif_history = vif_history,
      all_vars = env_info$names %||% character(0),
      var_means = env_info$means %||% list(),
      var_sds = env_info$sds %||% list()
    )
  }, error = function(e) {
    list(error = paste("VIF diagnostics failed:", conditionMessage(e)))
  })
}

handle_diagnostics_response_curves <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    rc <- result$response_curves

    if (is.null(rc) || length(rc) == 0) {
      return(list(available = FALSE, message = "Response curves not computed for this run"))
    }

    curves <- lapply(names(rc), function(var) {
      df <- rc[[var]]
      if (is.null(df) || !is.data.frame(df)) return(NULL)
      list(
        covariate = var,
        points = lapply(seq_len(nrow(df)), function(i) list(
          value = df$value[i],
          suitability = df$suitability[i]
        ))
      )
    })
    curves <- Filter(Negate(is.null), curves)

    list(
      available = TRUE,
      n_curves = length(curves),
      curves = curves
    )
  }, error = function(e) {
    list(error = paste("Response curves failed:", conditionMessage(e)))
  })
}

handle_diagnostics_ale <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    fit_obj <- result$fit
    if (is.null(fit_obj) || is.null(fit_obj$model_data)) {
      return(list(available = FALSE, message = "Model data not available for ALE"))
    }

    ale_data <- compute_ale(fit_obj, model_data = fit_obj$model_data, n_points = 50)

    if (is.null(ale_data) || length(ale_data) == 0) {
      return(list(available = FALSE, message = "ALE computation returned no data"))
    }

    curves <- lapply(names(ale_data), function(var) {
      df <- ale_data[[var]]
      if (is.null(df) || !is.data.frame(df)) return(NULL)
      list(
        covariate = var,
        points = lapply(seq_len(nrow(df)), function(i) list(
          value = df$value[i],
          ale = df$ale[i]
        ))
      )
    })
    curves <- Filter(Negate(is.null), curves)

    list(
      available = TRUE,
      n_curves = length(curves),
      curves = curves
    )
  }, error = function(e) {
    list(error = paste("ALE failed:", conditionMessage(e)))
  })
}

handle_diagnostics_importance <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    imp <- result$variable_importance

    if (is.null(imp) || !is.data.frame(imp) || nrow(imp) == 0) {
      return(list(available = FALSE, message = "Variable importance not computed for this run"))
    }

    importance_data <- lapply(seq_len(nrow(imp)), function(i) list(
      variable = imp$variable[i],
      importance = imp$importance[i],
      sd = imp$sd[i],
      baseline = imp$baseline[i]
    ))

    list(
      available = TRUE,
      n_variables = nrow(imp),
      importance = importance_data
    )
  }, error = function(e) {
    list(error = paste("Variable importance failed:", conditionMessage(e)))
  })
}

handle_diagnostics_shap_cell <- function(res, run_id = "", longitude = NULL, latitude = NULL) {
  if (!nzchar(run_id) || is.null(longitude) || is.null(latitude)) {
    res$status <- 400L; return(list(error = "run_id, longitude, and latitude required"))
  }

  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    if (is.null(result$fit) || is.null(result$fit$model_data)) {
      return(list(available = FALSE, message = "Model data not available for SHAP"))
    }

    model_data <- result$fit$model_data
    covariates <- result$fit$covariates
    if (is.null(covariates) || length(covariates) == 0) {
      return(list(available = FALSE, message = "Covariates not available"))
    }

    if (!requireNamespace("fastshap", quietly = TRUE)) {
      return(list(available = FALSE, message = "fastshap package required for SHAP"))
    }

    coord_df <- data.frame(x = as.numeric(longitude), y = as.numeric(latitude))
    env_rast <- tryCatch(terra::rast(meta$output_files$env_tif %||% ""), error = function(e) NULL)
    if (!is.null(env_rast)) {
      cell_vals <- terra::extract(env_rast, coord_df)
      if (is.null(cell_vals) || nrow(cell_vals) == 0) {
        return(list(available = FALSE, message = "Cell coordinates outside raster extent"))
      }
      cell_vals <- as.numeric(cell_vals[1, ])
      names(cell_vals) <- names(env_rast)
      cell_vals <- cell_vals[!is.na(cell_vals)]
    } else {
      return(list(available = FALSE, message = "Environmental raster not available"))
    }

    shap_vals <- tryCatch(
      compute_shap_cell(result$fit, cell_vals, background = model_data, n_samples = 200L),
      error = function(e) NULL
    )

    if (is.null(shap_vals)) {
      return(list(available = FALSE, message = "SHAP computation failed"))
    }

    shap_list <- lapply(names(shap_vals), function(v) list(
      variable = v, value = cell_vals[v],
      shap_value = shap_vals[v]
    ))
    pred_fun <- build_importance_predict_fun(result$fit)
    prediction <- if (!is.null(pred_fun)) {
      as.numeric(pred_fun(result$fit, as.data.frame(t(cell_vals))))
    } else NA_real_

    list(available = TRUE, prediction = prediction, shap = shap_list)
  }, error = function(e) {
    list(error = paste("SHAP cell explanation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_climate_drivers <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    paths <- result$paths %||% list()
    delta_tif <- paths$delta_tif

    if (is.null(delta_tif) || !file.exists(delta_tif)) {
      return(list(available = FALSE, message = "Future projection not available for this run"))
    }

    delta <- terra::rast(delta_tif)
    delta_vals <- terra::values(delta)
    delta_vals <- delta_vals[is.finite(delta_vals)]

    if (length(delta_vals) == 0) {
      return(list(available = FALSE, message = "Delta raster has no valid values"))
    }

    pct_loss <- mean(delta_vals < 0, na.rm = TRUE) * 100
    pct_gain <- mean(delta_vals > 0, na.rm = TRUE) * 100
    pct_stable <- 100 - pct_loss - pct_gain
    mean_delta <- mean(delta_vals, na.rm = TRUE)
    sd_delta <- stats::sd(delta_vals, na.rm = TRUE)

    list(
      available = TRUE,
      has_future_projection = TRUE,
      summary = list(
        mean_delta = mean_delta,
        sd_delta = sd_delta,
        min_delta = min(delta_vals, na.rm = TRUE),
        max_delta = max(delta_vals, na.rm = TRUE),
        pct_loss = pct_loss,
        pct_gain = pct_gain,
        pct_stable = pct_stable,
        n_cells = length(delta_vals)
      ),
      note = "Full per-variable attribution available via SHAP cell click on the suitability map"
    )
  }, error = function(e) {
    list(error = paste("Climate driver analysis failed:", conditionMessage(e)))
  })
}

handle_diagnostics_cbi <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    pres_suit <- result$fit$presence_suit
    bg_suit <- result$fit$background_suit

    if (is.null(pres_suit) || is.null(bg_suit)) {
      return(list(available = FALSE, message = "Suitability data not available for CBI computation"))
    }

    source(sdm_resolve_module("metrics_binary.R"), local = TRUE)
    cbi_result <- continuous_boyce_index(pres_suit, bg_suit, n_bins = 51, win = 0.1)

    if (is.null(cbi_result) || !is.data.frame(cbi_result$bins)) {
      return(list(available = FALSE, message = "CBI computation returned no data"))
    }

    bins_df <- cbi_result$bins
    bins_data <- lapply(seq_len(nrow(bins_df)), function(i) list(
      bin_mid = bins_df$bin_mid[i],
      ratio = bins_df$ratio[i],
      smoothed = bins_df$smoothed[i]
    ))

    list(
      available = TRUE,
      cbi = cbi_result$cbi,
      pe_ratio = cbi_result$pe_ratio,
      n_bins = nrow(bins_df),
      bins = bins_data,
      note = if (!is.null(cbi_result$note) && nzchar(cbi_result$note)) cbi_result$note else NULL
    )
  }, error = function(e) {
    list(error = paste("CBI computation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_mess <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  metrics <- meta$metrics %||% list()
  output_files <- meta$output_files %||% list()

  mess_tif <- output_files$future_mess_tif
  mod_tif <- output_files$future_mod_tif

  if (is.null(mess_tif) || !file.exists(mess_tif)) {
    return(list(
      available = FALSE,
      message = "No future projection with MESS for this run",
      has_future_projection = !is.null(output_files$future_suitability_tif)
    ))
  }

  list(
    available = TRUE,
    mess_tif = mess_tif,
    mod_tif = mod_tif,
    pct_extrapolation = metrics$projection$mess_pct_extrapolation %||% NULL,
    message = "MESS raster available; download TIFF for full spatial analysis"
  )
}

handle_diagnostics_summary <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  metrics <- meta$metrics %||% list()
  config <- meta$config %||% list()

  result_rds <- output_files$result_rds
  has_result_rds <- !is.null(result_rds) && file.exists(result_rds)

  vif_available <- FALSE
  response_curves_available <- FALSE
  importance_available <- FALSE
  cbi_available <- FALSE

  if (has_result_rds) {
    tryCatch({
      result <- sdm_read_result(result_rds)
      vif_available <- !is.null(result$environment$vif_result)
      response_curves_available <- !is.null(result$response_curves) && length(result$response_curves) > 0
      importance_available <- !is.null(result$variable_importance) && is.data.frame(result$variable_importance) && nrow(result$variable_importance) > 0
      cbi_available <- !is.null(result$fit$presence_suit) && !is.null(result$fit$background_suit)
    }, error = function(e) {})
  }

  mess_available <- !is.null(output_files$future_mess_tif) && file.exists(output_files$future_mess_tif)

  list(
    run_id = run_id,
    species = config$species,
    model_id = config$model_id,
    diagnostics = list(
      vif = list(available = vif_available, enabled = isTRUE(config$vif_reduction)),
      response_curves = list(available = response_curves_available),
      variable_importance = list(available = importance_available),
      cbi = list(available = cbi_available),
      mess = list(available = mess_available)
    ),
    metrics = list(
      auc_mean = metrics$auc_mean,
      auc_sd = metrics$auc_sd,
      tss_mean = metrics$tss_mean,
      tss_sd = metrics$tss_sd,
      presence_records = metrics$presence_records,
      background_points = metrics$background_points
    ),
    files = list(
      variable_importance_png = output_files$variable_importance_png %||% NULL,
      response_curves_png = output_files$response_curves_png %||% NULL,
      roc_curve_png = output_files$roc_curve_png %||% NULL,
      cbi_png = output_files$cbi_png %||% NULL,
      calibration_png = output_files$calibration_png %||% NULL,
      cv_folds_png = output_files$cv_folds_png %||% NULL
    )
  )
}

handle_diagnostics_roc <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- sdm_read_result(result_rds)
    cv <- result$cv
    if (is.null(cv) || !is.data.frame(cv$fold_metrics) || nrow(cv$fold_metrics) == 0) {
      return(list(available = FALSE, message = "CV fold metrics not available"))
    }
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
    mean_tpr <- if (is.matrix(tpr_list)) rowMeans(tpr_list, na.rm = TRUE) else rep(0.5, 100)
    list(
      available = TRUE,
      auc = cv$auc_mean %||% NA_real_,
      auc_sd = cv$auc_sd %||% NA_real_,
      fpr = as.list(mean_fpr),
      tpr = as.list(mean_tpr)
    )
  }, error = function(e) {
    list(error = paste("ROC computation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_calibration <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- sdm_read_result(result_rds)
    cv <- result$cv
    if (is.null(cv) || !is.data.frame(cv$predictions) || length(cv$predictions$predicted) == 0) {
      return(list(available = FALSE, message = "CV predictions not available"))
    }
    preds <- cv$predictions
    n_bins <- 10
    preds$bin <- cut(preds$predicted, breaks = seq(0, 1, length.out = n_bins + 1), include.lowest = TRUE)
    cal_df <- aggregate(observed ~ bin, data = preds, FUN = function(x) c(mean = mean(x), count = length(x)))
    cal_list <- lapply(seq_len(nrow(cal_df)), function(i) {
      b <- cal_df$bin[i]
      mid <- mean(as.numeric(gsub("[\\[\\]()]", "", strsplit(as.character(b), ",")[[1]])))
      list(bin_mid = mid, observed_freq = cal_df$observed[i, "mean"], count = as.integer(cal_df$observed[i, "count"]))
    })
    list(available = TRUE, bins = cal_list)
  }, error = function(e) {
    list(error = paste("Calibration computation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_cv_folds <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- sdm_read_result(result_rds)
    cv <- result$cv
    if (is.null(cv) || !is.data.frame(cv$fold_metrics) || nrow(cv$fold_metrics) == 0) {
      return(list(available = FALSE, message = "CV fold metrics not available"))
    }
    fm <- cv$fold_metrics
    fold_list <- lapply(seq_len(nrow(fm)), function(i) list(
      fold = as.integer(fm$fold[i]),
      auc = as.numeric(fm$auc[i]),
      tss = as.numeric(fm$tss[i])
    ))
    list(
      available = TRUE,
      auc_mean = cv$auc_mean %||% NA_real_,
      auc_sd = cv$auc_sd %||% NA_real_,
      tss_mean = cv$tss_mean %||% NA_real_,
      tss_sd = cv$tss_sd %||% NA_real_,
      folds = fold_list
    )
  }, error = function(e) {
    list(error = paste("CV folds computation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_threshold <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- sdm_read_result(result_rds)
    pres <- result$fit$presence_suit
    bg <- result$fit$background_suit
    if (is.null(pres) || is.null(bg)) {
      return(list(available = FALSE, message = "Prediction data not available"))
    }
    thresholds <- seq(0, 1, length.out = 100)
    threshold_list <- lapply(thresholds, function(t) {
      tp <- sum(pres >= t, na.rm = TRUE)
      fn <- sum(pres < t, na.rm = TRUE)
      fp <- sum(bg >= t, na.rm = TRUE)
      tn <- sum(bg < t, na.rm = TRUE)
      sensitivity <- if ((tp + fn) > 0) tp / (tp + fn) else NA_real_
      specificity <- if ((tn + fp) > 0) tn / (tn + fp) else NA_real_
      tss <- if (is.finite(sensitivity) && is.finite(specificity)) sensitivity + specificity - 1 else NA_real_
      list(threshold = t, sensitivity = sensitivity, specificity = specificity, tss = tss)
    })
    list(available = TRUE, thresholds = threshold_list)
  }, error = function(e) {
    list(error = paste("Threshold computation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_density <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  tryCatch({
    result <- sdm_read_result(result_rds)
    pres <- result$fit$presence_suit
    bg <- result$fit$background_suit
    if (is.null(pres) || is.null(bg)) {
      return(list(available = FALSE, message = "Prediction data not available"))
    }
    pres_d <- stats::density(pres, from = 0, to = 1, na.rm = TRUE)
    bg_d <- stats::density(bg, from = 0, to = 1, na.rm = TRUE)
    list(
      available = TRUE,
      presence = list(x = as.list(pres_d$x), y = as.list(pres_d$y)),
      background = list(x = as.list(bg_d$x), y = as.list(bg_d$y))
    )
  }, error = function(e) {
    list(error = paste("Density computation failed:", conditionMessage(e)))
  })
}

handle_diagnostics_plots <- function(res, run_id) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  result <- tryCatch(sdm_read_result(result_rds), error = function(e) NULL)
  if (is.null(result)) {
    res$status <- 500L; return(list(error = "Failed to load result file"))
  }
  source(file.path(app_dir, "R", "output", "diagnostics_plots.R"), local = TRUE)
  diag_files <- save_diagnostic_plots(result, job_dir, log_fun = function(...) {})
  meta$output_files <- c(meta$output_files %||% list(), diag_files)
  sdm_write_json(meta, meta_file)
  list(ok = TRUE, files = diag_files)
}

handle_diagnostics_data <- function(res, run_id, type) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") { res$status <- 400L; return(list(error = "Run not completed yet")) }
  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds
  if (is.null(result_rds) || !file.exists(result_rds)) { res$status <- 404L; return(list(error = "Result file not found")) }
  result <- tryCatch(sdm_read_result(result_rds), error = function(e) NULL)
  if (is.null(result)) { res$status <- 500L; return(list(error = "Failed to load result file")) }
  csv_data <- switch(type,
    importance = {
      imp <- result$variable_importance
      if (is.null(imp) || !is.data.frame(imp)) return(NULL)
      imp
    },
    response_curves = {
      rc <- result$response_curves
      if (is.null(rc) || length(rc) == 0) return(NULL)
      do.call(rbind, lapply(names(rc), function(nm) { df <- rc[[nm]]; df$covariate <- nm; df }))
    },
    cbi = {
      cbi_result <- tryCatch({
        pres <- result$fit$presence_suit; bg <- result$fit$background_suit
        if (is.null(pres) || is.null(bg)) NULL else {
          source(file.path(app_dir, "R", "output", "diagnostics_plots.R"), local = TRUE)
          continuous_boyce_index(pres, bg, n_bins = 51, win = 0.1)
        }
      }, error = function(e) NULL)
      if (is.null(cbi_result) || is.null(cbi_result$bins)) return(NULL)
      cbi_result$bins
    },
    vif = {
      env <- result$environment
      if (is.null(env) || is.null(env$vif_result)) return(NULL)
      vif <- env$vif_result
      combined <- data.frame(
        variable = c(vif$selected %||% character(0), vif$dropped %||% character(0)),
        status = c(rep("retained", length(vif$selected %||% character(0))), rep("dropped", length(vif$dropped %||% character(0)))),
        stringsAsFactors = FALSE
      )
      if (!is.null(vif$vif_final)) combined$vif_final <- vif$vif_final
      combined
    },
    mess = {
      list(pct_extrapolation = meta$metrics$projection$mess_pct_extrapolation %||% NA)
    },
    NULL
  )
  if (is.null(csv_data)) { res$status <- 404L; return(list(error = paste0("Data not available for type: ", type))) }
  res$headers[["Content-Type"]] <- "text/csv"
  res$headers[["Content-Disposition"]] <- paste0("attachment; filename=\"", type, "_", run_id, ".csv\"")
  write.csv(csv_data, row.names = FALSE)
}
