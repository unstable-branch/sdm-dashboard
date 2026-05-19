fit_esm <- function(occ,
                    env_train_scaled,
                    biovars = NULL,
                    algorithm = "GLM",
                    min_auc = sdm_esm_default_min_auc,
                    weighting_metric = "AUC",
                    power = sdm_esm_default_power,
                    n_runs_eval = sdm_esm_default_n_runs,
                    data_split = sdm_esm_default_split,
                    seed = sdm_default_seed,
                    log_fun = NULL,
                    background_n = 1000,
                    ...) {
  if (!requireNamespace("ecospat", quietly = TRUE)) {
    stop(
      "Package 'ecospat' is required for ESM. ",
      "Install with: install.packages('ecospat')"
    )
  }
  if (!requireNamespace("biomod2", quietly = TRUE)) {
    stop(
      "Package 'biomod2' is required by ecospat for ESM. ",
      "Install with: install.packages('biomod2')"
    )
  }

  set.seed(seed)

  weighting_metric <- toupper(weighting_metric[1])
  if (!weighting_metric %in% c("AUC", "TSS")) {
    warning("ESM weighting_metric must be 'AUC' or 'TSS'; defaulting to 'AUC'")
    weighting_metric <- "AUC"
  }

  covariate_cols <- if (!is.null(biovars) && length(biovars) > 0) {
    paste0("bio", biovars)
  } else {
    setdiff(
      names(env_train_scaled),
      c("presence", "case_weight_sdm", ".x", ".y")
    )
  }

  n_vars <- length(covariate_cols)
  n_pairs <- n_vars * (n_vars - 1) / 2

  pres_xy <- occ[, c("longitude", "latitude"), drop = FALSE]
  names(pres_xy) <- c("x", "y")
  pres_vals <- extract_covariates(env_train_scaled, pres_xy)
  pres_keep <- stats::complete.cases(pres_vals)
  n_pres <- sum(pres_keep)
  if (sum(!pres_keep) > 0) log_message(log_fun, "ESM dropped ", sum(!pres_keep), " occurrence records with missing covariates")

  bg_xy <- sample_background_points(env_train_scaled, background_n, seed = seed)
  bg_vals <- extract_covariates(env_train_scaled, bg_xy)
  bg_keep <- stats::complete.cases(bg_vals)
  bg_vals <- bg_vals[bg_keep, , drop = FALSE]
  bg_xy <- bg_xy[bg_keep, , drop = FALSE]
  min_bg <- min(background_n, 100)
  if (nrow(bg_vals) < min_bg) stop("ESM: too few background points could be sampled (got ", nrow(bg_vals), ", need >= ", min_bg, ").", call. = FALSE)

  esm_data <- data.frame(
    RespVar = c(rep(1L, n_pres), rep(0L, nrow(bg_vals))),
    rbind(pres_vals[pres_keep, , drop = FALSE], bg_vals),
    check.names = FALSE
  )

  log_message(
    log_fun, "ESM: ", n_pres, " presences, ", n_vars, " variables -> ",
    n_pairs, " bivariate models (algorithm = ", algorithm, ")"
  )

  if (n_pres < 5) {
    stop("ESM requires at least 5 presence records. Got: ", n_pres)
  }
  if (n_vars < 2) {
    stop("ESM requires at least 2 predictor variables. Got: ", n_vars)
  }
  if (n_pairs > 100) {
    warning(
      "ESM: ", n_pairs, " bivariate models requested. This may take ",
      "several minutes. Consider reducing the number of covariates."
    )
  }
  if (n_vars > sdm_esm_max_vars_warn) {
    log_message(
      log_fun,
      "ESM warning: ", n_vars, " variables (>", sdm_esm_max_vars_warn,
      ") selected. Consider reducing to 6-8 variables for faster runtime."
    )
  }

  log_message(log_fun, "ESM: building BIOMOD data objects...")

  modeling_id <- paste0("esm_", format(Sys.time(), "%Y%m%d%H%M%S"))

  combined_xy <- data.frame(
    longitude = c(pres_xy$x[pres_keep], bg_xy$x),
    latitude  = c(pres_xy$y[pres_keep], bg_xy$y)
  )
  combined_resp <- c(rep(1L, n_pres), rep(0L, nrow(bg_vals)))
  names(combined_xy) <- c("longitude", "latitude")

  biomod_data <- biomod2::BIOMOD_FormatingData(
    resp.var   = combined_resp,
    expl.var   = env_train_scaled,
    resp.name  = "esm_species",
    resp.xy    = combined_xy,
    na.rm      = TRUE
  )

  log_message(log_fun, "ESM: calibrating ", n_pairs, " bivariate models...")

  if (isTRUE(getOption("sdm.cancelled"))) {
    stop("ESM modelling cancelled by user.")
  }

  esm_models <- tryCatch(
    ecospat::ecospat.ESM.Modeling(
      data             = biomod_data,
      NbRunEval        = as.integer(n_runs_eval),
      DataSplit        = as.integer(data_split),
      Prevalence       = NULL,
      weighting.score  = weighting_metric,
      models           = toupper(algorithm),
      tune             = FALSE,
      modeling.id      = modeling_id,
      cleanup          = TRUE
    ),
    error = function(e) {
      stop("ESM calibration failed: ", conditionMessage(e))
    }
  )

  if (isTRUE(getOption("sdm.cancelled"))) {
    stop("ESM modelling cancelled by user.")
  }

  log_message(log_fun, "ESM: building weighted ensemble (min_auc = ", min_auc, ")...")

  esm_ensemble <- ecospat::ecospat.ESM.EnsembleModeling(
    ESM.modeling.output = esm_models,
    weighting.score = weighting_metric,
    threshold = min_auc
  )

  eval_scores <- esm_ensemble$ESM.evaluations
  auc_mean <- mean(eval_scores$AUC, na.rm = TRUE)
  auc_sd <- sd(eval_scores$AUC, na.rm = TRUE)
  tss_mean <- mean(eval_scores$TSS, na.rm = TRUE)
  tss_sd <- sd(eval_scores$TSS, na.rm = TRUE)

  log_message(log_fun, sprintf(
    "ESM: AUC = %.3f +/- %.3f, TSS = %.3f +/- %.3f",
    auc_mean, auc_sd, tss_mean, tss_sd
  ))

  weights_raw <- esm_ensemble$weights
  n_models_kept <- sum(!is.na(weights_raw) & weights_raw > 0)
  n_models_dropped <- n_pairs - n_models_kept

  if (n_models_dropped > 0) {
    log_message(
      log_fun, "ESM: dropped ", n_models_dropped,
      " bivariate models (AUC < ", min_auc, ")"
    )
  }

  weights_used <- data.frame(
    pair = names(weights_raw),
    weight_raw = unname(weights_raw),
    stringsAsFactors = FALSE
  )

  importance_df <- extract_esm_importance(esm_ensemble, covariate_cols)

  first_comp <- esm_models[[1]]
  bg_xy <- if (!is.null(first_comp) && !is.null(first_comp$input$coord)) {
    first_comp$input$coord[first_comp$input$pa == 0, , drop = FALSE]
  } else {
    bg_xy
  }

  list(
    model = list(
      esm_models = esm_models,
      esm_ensemble = esm_ensemble
    ),
    formula = NULL,
    coefficients = weights_used,
    occurrence_used = occ,
    background_xy = bg_xy,
    cv = list(
      strategy  = "split-sample",
      k         = as.integer(n_runs_eval),
      auc_mean  = auc_mean,
      auc_sd    = auc_sd,
      tss_mean  = tss_mean,
      tss_sd    = tss_sd,
      threshold = min_auc
    ),
    covariates = covariate_cols,
    variable_importance = importance_df,
    esm_config = list(
      algorithm       = algorithm,
      n_vars          = n_vars,
      n_pairs_total   = n_pairs,
      n_pairs_used    = n_models_kept,
      n_pairs_dropped = n_models_dropped,
      min_auc         = min_auc,
      power           = power,
      n_runs          = as.integer(n_runs_eval),
      data_split      = as.integer(data_split)
    )
  )
}

predict_esm_suitability <- function(fit, env_project_scaled,
                                    output_tif, n_cores = 1,
                                    log_fun = NULL) {
  log_message(log_fun, "ESM: projecting suitability...")

  env_df <- as.data.frame(terra::values(env_project_scaled))
  env_df <- env_df[, fit$covariates, drop = FALSE]

  proj_out <- ecospat::ecospat.ESM.Projection(
    ESM.modeling.output = fit$model$esm_models,
    new.env             = env_df
  )

  ens_proj <- ecospat::ecospat.ESM.EnsembleProjection(
    ESM.prediction.output = proj_out,
    ESM.EnsembleModeling.output = fit$model$esm_ensemble
  )

  # Compute between-pair uncertainty (SD across bivariate predictions)
  pair_sd <- NULL
  tryCatch({
    pair_preds <- proj_out$proj[fit$model$esm_ensemble$models.kept, , drop = FALSE]
    if (!is.null(pair_preds) && nrow(pair_preds) > 1) {
      pair_sd_values <- matrixStats::colSds(as.matrix(pair_preds), na.rm = TRUE) / 1000
      pair_sd <- terra::setValues(template, pmin(1, pmax(0, pair_sd_values)))
      names(pair_sd) <- "esm_pair_sd"
    }
  }, error = function(e) {
    log_message(log_fun, "ESM: between-pair SD computation skipped: ", conditionMessage(e))
  })

  # Save pair SD as sidecar TIFF if computed
  pair_sd_tif <- NULL
  if (!is.null(pair_sd)) {
    pair_sd_tif <- sub("\\.tif$", "_pair_sd.tif", output_tif)
    terra::writeRaster(pair_sd, pair_sd_tif,
      overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
    )
    log_message(log_fun, "ESM between-pair uncertainty written to: ", pair_sd_tif)
  }

  template <- env_project_scaled[[1]]
  suit_values <- unname(ens_proj) / 1000
  suit_values <- pmin(1, pmax(0, suit_values))
  suit_raster <- terra::setValues(template, suit_values)
  names(suit_raster) <- "suitability"

  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)
  terra::writeRaster(suit_raster, output_tif,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
  )
  log_message(log_fun, "ESM suitability written to: ", output_tif)

  if (!is.null(pair_sd_tif)) {
    attr(suit_raster, "esm_pair_sd_tif") <- pair_sd_tif
  }
  suit_raster
}

extract_esm_importance <- function(esm_ensemble, var_names) {
  w <- esm_ensemble$weights
  if (is.null(w) || length(w) == 0) {
    return(data.frame(
      variable = var_names, importance = 0,
      stringsAsFactors = FALSE
    ))
  }

  importance <- vapply(var_names, function(v) {
    pairs_with_v <- grep(paste0("(^|_)", v, "(_|$)"), names(w), value = TRUE)
    if (length(pairs_with_v) == 0) {
      return(0)
    }
    mean(w[pairs_with_v], na.rm = TRUE)
  }, numeric(1))

  importance <- importance / max(importance, na.rm = TRUE)
  importance[is.na(importance)] <- 0

  data.frame(
    variable = var_names,
    importance = unname(importance),
    stringsAsFactors = FALSE
  )
}

plot_esm_pair_heatmap <- function(esm_fit) {
  w <- esm_fit$model$esm_ensemble$weights
  if (is.null(w) || length(w) == 0) {
    return(NULL)
  }
  pairs <- strsplit(names(w), "_")
  df <- data.frame(
    var1 = sapply(pairs, `[`, 1),
    var2 = sapply(pairs, `[`, 2),
    weight = unname(w),
    stringsAsFactors = FALSE
  )
  df_sym <- rbind(df, data.frame(var1 = df$var2, var2 = df$var1, weight = df$weight))

  if (!requireNamespace("ggplot2", quietly = TRUE)) {
    return(NULL)
  }

  ggplot2::ggplot(df_sym, ggplot2::aes(var1, var2, fill = weight)) +
    ggplot2::geom_tile(colour = "white") +
    ggplot2::scale_fill_gradient2(
      name = "AUC\nweight", low = "#f7f7f7",
      high = "#2166ac", mid = "#67a9cf",
      midpoint = mean(df$weight, na.rm = TRUE)
    ) +
    ggplot2::theme_minimal(base_size = 11) +
    ggplot2::labs(title = "ESM bivariate model weights", x = NULL, y = NULL) +
    ggplot2::theme(axis.text.x = ggplot2::element_text(angle = 45, hjust = 1))
}
