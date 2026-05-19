# Multi-model ensemble SDM backend.
# Allows combining any number of standalone models (GLM, GAM, MaxNet, Rangebagging)
# and biomod2 algorithms into a single weighted ensemble.

multi_ensemble_component_path <- function(output_tif, model_id) {
  model_id <- gsub("[^a-zA-Z0-9]", "_", model_id)
  if (grepl("[.]tif$", output_tif, ignore.case = TRUE)) {
    sub("[.]tif$", paste0("_", model_id, ".tif"), output_tif, ignore.case = TRUE)
  } else {
    paste0(output_tif, "_", model_id, ".tif")
  }
}

compute_multi_ensemble_weights <- function(cv_list, weighting = "auc", power = 2L) {
  weighting <- match.arg(weighting, c("equal", "auc", "tss"))
  n <- length(cv_list)
  if (n == 0) {
    return(numeric(0))
  }
  if (identical(weighting, "equal")) {
    w <- rep(1, n)
    return(w / sum(w))
  }
  metric <- if (identical(weighting, "auc")) "auc_mean" else "tss_mean"
  vals <- vapply(cv_list, function(x) {
    v <- suppressWarnings(as.numeric(x[[metric]][1]))
    if (is.finite(v)) v else 0.5
  }, numeric(1))
  vals[vals < 0.5] <- 0.5
  if (identical(weighting, "auc")) {
    vals <- vals - 0.5
  }
  vals[vals < 0] <- 0
  powered <- vals^power
  total <- sum(powered)
  if (total > 0) powered / total else rep(1 / n, n)
}

extract_biomod2_algorithm_files <- function(modeling_id, proj_name, algo_names) {
  tif_dir <- file.path(tempdir(), modeling_id, proj_name)
  if (!dir.exists(tif_dir)) {
    return(list())
  }
  tif_files <- list.files(tif_dir, pattern = "[.]tif$", full.names = TRUE)
  tif_files <- tif_files[!grepl("clamping", tif_files)]
  preds <- list()
  for (algo in algo_names) {
    pattern <- paste0("_", algo, "[^a-zA-Z]")
    matches <- grep(pattern, tif_files, value = TRUE, ignore.case = TRUE)
    if (length(matches) > 0) {
      preds[[paste0("biomod2.", algo)]] <- terra::rast(matches[length(matches)])
    }
  }
  preds
}

predict_multi_model_ensemble <- function(fit, env_project_scaled, output_tif,
                                         n_cores = 1, log_fun = NULL,
                                         export_components = TRUE,
                                         include_uncertainty = TRUE,
                                         ensemble_weighting = "auc",
                                         ensemble_power = 2) {
  if (!is.list(fit) || is.null(fit$model) || is.null(fit$model$components)) {
    stop("fit must be a multi_model_ensemble fit result.", call. = FALSE)
  }
  components <- fit$model$components
  weights <- fit$model$weights
  methods <- fit$model$methods
  cv_list <- fit$cv$component_cv %||% lapply(components, function(c) c(auc_mean = NA_real_, tss_mean = NA_real_))
  if (length(components) < 2) {
    stop("At least 2 component models are required for multi-model ensemble.", call. = FALSE)
  }
  dir.create(dirname(output_tif), recursive = TRUE, showWarnings = FALSE)

  preds <- list()
  component_paths <- list()
  failed_components <- character()
  for (m in names(components)) {
    comp_fit <- components[[m]]
    method <- methods[[m]]
    log_message(log_fun, "Predicting component: ", m)
    comp_tif <- multi_ensemble_component_path(output_tif, m)
    pred_result <- tryCatch(
      if (identical(method, "biomod2")) {
        pred_biomod2_component(comp_fit, env_project_scaled, comp_tif, n_cores, log_fun)
      } else {
        predict_single_component(method, comp_fit, env_project_scaled, comp_tif, n_cores, log_fun)
      },
      error = function(e) {
        log_message(log_fun, "Component '", m, "' prediction failed: ", conditionMessage(e))
        NULL
      }
    )
    if (is.null(pred_result)) {
      failed_components <- c(failed_components, m)
      next
    }
    preds[[m]] <- pred_result
    if (export_components) {
      component_paths[[paste0("multi_ens_comp_", m)]] <- comp_tif
    }
  }

  if (length(failed_components) > 0) {
    log_message(log_fun, "Warning: ", length(failed_components), " component(s) failed prediction: ", paste(failed_components, collapse = ", "))
  }

  if (length(preds) == 0) {
    stop("All ensemble components failed; cannot compute ensemble prediction.", call. = FALSE)
  }

  pred_stack <- terra::rast(preds)

  ensemble_mean <- terra::app(pred_stack, mean, na.rm = TRUE)
  names(ensemble_mean) <- "ensemble_mean"
  mean_tif <- sub(".tif$", "_ensemble_mean.tif", output_tif)
  terra::writeRaster(ensemble_mean, mean_tif,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
  )
  log_message(log_fun, "Ensemble mean raster written to: ", mean_tif)

  ensemble_median <- terra::app(pred_stack, median, na.rm = TRUE)
  names(ensemble_median) <- "ensemble_median"
  median_tif <- sub(".tif$", "_ensemble_median.tif", output_tif)
  terra::writeRaster(ensemble_median, median_tif,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
  )
  log_message(log_fun, "Ensemble median raster written to: ", median_tif)

  weighted_layers <- mapply(function(pred, wi) pred * wi, preds, weights[names(preds)], SIMPLIFY = FALSE)
  ensemble_weighted <- Reduce("+", weighted_layers)
  names(ensemble_weighted) <- "suitability"
  terra::writeRaster(ensemble_weighted, output_tif,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
  )
  log_message(log_fun, "Ensemble raster written to: ", output_tif)

  binary_preds <- lapply(names(preds), function(mid) {
    comp_cv <- cv_list[[mid]]
    thresh <- comp_cv$threshold %||% 0.5
    preds[[mid]] >= thresh
  })
  committee_stack <- terra::rast(binary_preds)
  ensemble_committee <- terra::app(committee_stack, mean, na.rm = TRUE)
  names(ensemble_committee) <- "ensemble_committee"
  committee_tif <- sub(".tif$", "_ensemble_committee.tif", output_tif)
  terra::writeRaster(ensemble_committee, committee_tif,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
  )
  log_message(log_fun, "Ensemble committee raster written to: ", committee_tif)

  if (include_uncertainty) {
    ensemble_sd <- terra::app(pred_stack, sd, na.rm = TRUE)
    names(ensemble_sd) <- "ensemble_sd"
    sd_tif <- sub(".tif$", "_ensemble_sd.tif", output_tif)
    terra::writeRaster(ensemble_sd, sd_tif,
      overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
    )
    log_message(log_fun, "Ensemble SD raster written to: ", sd_tif)
  }

  component_paths$multi_ens_disagreement_tif <- NULL

  attr(ensemble_weighted, "component_paths") <- component_paths
  attr(ensemble_weighted, "ensemble_mean_tif") <- mean_tif
  attr(ensemble_weighted, "ensemble_median_tif") <- median_tif
  attr(ensemble_weighted, "ensemble_committee_tif") <- committee_tif
  if (include_uncertainty) {
    attr(ensemble_weighted, "ensemble_sd_tif") <- sd_tif
  }
  ensemble_weighted
}

predict_single_component <- function(method, comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
  spec <- tryCatch(
    get_sdm_model(method),
    error = function(e) stop("Model '", method, "' is not registered in sdm_model_registry. Register it with register_sdm_model() first.", call. = FALSE)
  )
  if (!is.function(spec$predict_component_fun)) {
    stop("Model '", method, "' has no predict_component_fun registered.", call. = FALSE)
  }
  log_message(log_fun, "  Predicting component [", method, "] via registry dispatch")
  spec$predict_component_fun(comp_fit, env_project_scaled, output_tif, n_cores, log_fun)
}

pred_biomod2_component <- function(comp_fit, env_project_scaled, output_tif, n_cores, log_fun) {
  modeling_id <- comp_fit$modeling_id
  algo <- comp_fit$algorithm
  proj_name <- paste0("proj_", modeling_id)
  proj_dir <- file.path(tempdir(), modeling_id)
  proj <- biomod2::BIOMOD_Projection(
    bm.mod = comp_fit$model,
    new.env = env_project_scaled,
    proj.name = proj_name,
    output.dir = proj_dir,
    build.clamping.mask = TRUE
  )
  proj_files <- list.files(file.path(proj_dir, proj_name), pattern = "[.]tif$", full.names = TRUE)
  proj_files <- proj_files[!grepl("clamping", proj_files)]
  if (length(proj_files) == 0) {
    stop("No projection files generated by biomod2 for component prediction.", call. = FALSE)
  }
  algo_tif <- proj_files[length(proj_files)]
  r <- terra::rast(algo_tif)
  if (!is.null(output_tif)) {
    terra::writeRaster(r, output_tif,
      overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=LZW", "TILED=YES"))
    )
  }
  r
}

fit_multi_model_ensemble <- function(occ, env_train_scaled,
                                     selected_models = NULL,
                                     ensemble_weighting = "auc",
                                     ensemble_power = 2,
                                     min_auc = NA_real_,
                                     min_tss = NA_real_,
                                     background_n = sdm_default_background_n,
                                     include_quadratic = TRUE,
                                     cv_folds = sdm_default_cv_folds,
                                     seed = sdm_default_seed,
                                     n_cores = 1,
                                     log_fun = NULL,
                                     cv_strategy = sdm_default_cv_strategy,
                                     cv_block_size_km = sdm_default_cv_block_size_km,
                                     bias_method = c("uniform", "target_group", "thickened"),
                                     target_group_occ = NULL,
                                     thickening_distance_km = NULL,
                                     maxnet_features = sdm_default_maxnet_features,
                                     maxnet_regmult = sdm_default_maxnet_regmult,
                                     biomod2_models = NULL) {
  bias_method <- match.arg(bias_method)
  if (is.null(selected_models) || length(selected_models) == 0) {
    stop("At least one model must be selected for multi-model ensemble.", call. = FALSE)
  }
  selected_models <- unique(as.character(selected_models))
  if (length(selected_models) < 2) {
    stop("At least 2 models must be selected for multi-model ensemble. Got: ", paste(selected_models, collapse = ", "), call. = FALSE)
  }

  if (isTRUE(biomod2_models) || identical(biomod2_models, "auto")) {
    biomod2_models <- config$biomod2_default
  }
  has_biomod2 <- requireNamespace("biomod2", quietly = TRUE) && isTRUE(getOption("sdm.enable_biomod2", FALSE))

  if (!has_biomod2 && any(grepl("biomod2", selected_models, ignore.case = TRUE))) {
    selected_models <- setdiff(selected_models, "biomod2")
    log_message(log_fun, "biomod2 not available; removed from ensemble selection.")
  }

  standalone_ids <- c("glm", "gam", "maxnet", "rf", "xgboost", "rangebag", "esm_glm", "esm_maxnet")
  standalone_selected <- intersect(selected_models, standalone_ids)
  biomod2_selected <- if ("biomod2" %in% selected_models && has_biomod2) biomod2_models else character()

  components <- list()
  cv_list <- list()
  methods <- character()
  component_k <- integer()
  component_auc <- numeric()
  component_tss <- numeric()

  for (m in standalone_selected) {
    log_message(log_fun, "Fitting ensemble component: ", toupper(m))
    spec <- tryCatch(get_sdm_model(m), error = function(e) NULL)
    comp_fit <- if (!is.null(spec) && is.function(spec$fit_component_fun)) {
      spec$fit_component_fun(
        occ = occ, env_train_scaled = env_train_scaled,
        background_n = background_n, include_quadratic = include_quadratic,
        cv_folds = cv_folds, seed = seed, n_cores = n_cores,
        log_fun = log_fun, bias_method = bias_method,
        target_group_occ = target_group_occ,
        thickening_distance_km = thickening_distance_km,
        maxnet_features = maxnet_features, maxnet_regmult = maxnet_regmult,
        cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
      )
    } else {
      switch(m,
        "glm" = fit_fast_sdm(
          occ = occ, env_train_scaled = env_train_scaled,
          background_n = background_n, include_quadratic = include_quadratic,
          cv_folds = cv_folds, seed = seed, n_cores = n_cores,
          log_fun = log_fun, bias_method = bias_method,
          target_group_occ = target_group_occ,
          thickening_distance_km = thickening_distance_km,
          cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
        ),
        "gam" = fit_gam_sdm(
          occ = occ, env_train_scaled = env_train_scaled,
          background_n = background_n, cv_folds = cv_folds,
          seed = seed, n_cores = n_cores, log_fun = log_fun
        ),
        "maxnet" = fit_maxnet_sdm(
          occ = occ, env_train_scaled = env_train_scaled,
          background_n = background_n, include_quadratic = include_quadratic,
          cv_folds = cv_folds, seed = seed, n_cores = n_cores,
          log_fun = log_fun, maxnet_features = maxnet_features,
          maxnet_regmult = maxnet_regmult,
          cv_strategy = cv_strategy, cv_block_size_km = cv_block_size_km
        ),
        "rangebag" = fit_rangebag_sdm(
          occ = occ, env_train_scaled = env_train_scaled,
          background_n = background_n, include_quadratic = FALSE,
          cv_folds = cv_folds, seed = seed, n_cores = n_cores,
          log_fun = log_fun
        ),
        stop("Unknown standalone model: ", m, call. = FALSE)
      )
    }
    components[[m]] <- comp_fit
    methods[[m]] <- m
    cv_list[[m]] <- comp_fit$cv
    component_k <- c(component_k, comp_fit$cv$k %||% NA_integer_)
    component_auc <- c(component_auc, comp_fit$cv$auc_mean %||% NA_real_)
    component_tss <- c(component_tss, comp_fit$cv$tss_mean %||% NA_real_)
  }

  biomod2_fit <- NULL
  if (length(biomod2_selected) > 0) {
    log_message(log_fun, "Fitting ensemble component: biomod2 (", paste(biomod2_selected, collapse = ", "), ")")
    biomod2_fit <- run_biomod2(
      occ_df = occ, pred_stack = env_train_scaled,
      models = biomod2_selected, background_n = background_n,
      cv_folds = cv_folds, seed = seed, output_dir = tempdir(),
      log_fun = log_fun
    )
    eval_df <- biomod2_fit$cv$per_algorithm
    if (is.data.frame(eval_df) && nrow(eval_df) > 0) {
      for (i in seq_len(nrow(eval_df))) {
        algo <- eval_df$algorithm[i]
        m <- paste0("biomod2.", algo)
        components[[m]] <- list(
          modeling_id = biomod2_fit$modeling_id,
          algorithm = algo,
          cv = list(auc_mean = eval_df$auc[i], tss_mean = eval_df$tss[i], k = cv_folds)
        )
        methods[[m]] <- "biomod2"
        cv_list[[m]] <- list(auc_mean = eval_df$auc[i], tss_mean = eval_df$tss[i], k = cv_folds)
        component_k <- c(component_k, as.integer(cv_folds))
        component_auc <- c(component_auc, eval_df$auc[i])
        component_tss <- c(component_tss, eval_df$tss[i])
      }
    }
  }

  component_cv_df <- data.frame(
    model_id = names(cv_list),
    auc_mean = as.numeric(component_auc),
    tss_mean = as.numeric(component_tss),
    stringsAsFactors = FALSE
  )

  keep <- rep(TRUE, nrow(component_cv_df))
  if (!is.na(min_auc)) {
    keep <- keep & (is.na(component_cv_df$auc_mean) | component_cv_df$auc_mean >= min_auc)
  }
  if (!is.na(min_tss)) {
    keep <- keep & (is.na(component_cv_df$tss_mean) | component_cv_df$tss_mean >= min_tss)
  }

  dropped_models <- component_cv_df$model_id[!keep]
  if (length(dropped_models) > 0) {
    msg <- paste0("Ensemble: excluded ", length(dropped_models), " model(s) below threshold: ", paste(dropped_models, collapse = ", "))
    log_message(log_fun, msg)
  }

  if (sum(keep) == 0) {
    warning("All models below performance threshold; using all models for ensemble.")
    keep[] <- TRUE
    dropped_models <- character()
  }

  if (sum(keep) < 2) {
    stop("Ensemble requires at least 2 valid components after filtering. Increase min AUC/TSS thresholds or add more models.", call. = FALSE)
  }

  cv_list_filtered <- cv_list[keep]
  weights <- compute_multi_ensemble_weights(cv_list_filtered, ensemble_weighting, power = ensemble_power)
  names(weights) <- names(cv_list_filtered)

  auc_weighted <- ensemble_weighted_metric(component_auc[keep], weights)
  tss_weighted <- ensemble_weighted_metric(component_tss[keep], weights)

  component_metrics_df <- data.frame(
    model_id = names(cv_list_filtered),
    method = unname(methods[keep]),
    auc_mean = as.numeric(component_auc[keep]),
    tss_mean = as.numeric(component_tss[keep]),
    weight = as.numeric(weights),
    stringsAsFactors = FALSE
  )

  log_message(log_fun, "Ensemble weights (", ensemble_weighting, ", power=", ensemble_power, "): ", paste(names(weights), sprintf("%.3f", weights), sep = "=", collapse = ", "))

  ensemble_config <- list(
    weighting = ensemble_weighting,
    power = ensemble_power,
    min_auc = min_auc,
    min_tss = min_tss,
    models_included = component_metrics_df$model_id,
    models_excluded = dropped_models,
    include_uncertainty = TRUE
  )

  first_component <- components[[1]]
  list(
    model = list(
      components = components,
      weights = weights,
      methods = methods,
      weighting = ensemble_weighting,
      power = ensemble_power
    ),
    formula = NULL,
    coefficients = component_metrics_df,
    occurrence_used = first_component$occurrence_used %||% occ,
    background_xy = first_component$background_xy %||% NULL,
    cv = list(
      k = if (length(component_k) > 0) max(component_k, na.rm = TRUE) else NA_integer_,
      auc_mean = auc_weighted,
      auc_sd = NA_real_,
      tss_mean = tss_weighted,
      tss_sd = NA_real_,
      component_metrics = component_metrics_df,
      component_cv = cv_list,
      component_k = component_k
    ),
    ensemble_config = ensemble_config,
    covariates = first_component$covariates %||% names(env_train_scaled),
    variable_importance = NULL,
    biomod2_fit = biomod2_fit
  )
}
