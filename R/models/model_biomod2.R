## Biomod2 modelling wrapper ---------------------------------------------------
## Centralizes all calls to the biomod2 package. Registers via model_registry
## only when options(sdm.enable_biomod2 = TRUE) and biomod2 is installed.
## See docs/BIOMOD2_ADAPTER_NOTES.md for gating strategy details.

## biomod2 is mapped to random k-fold only. The app's "random" strategy and the
## internal "kfold" name are equivalent; spatial blocks are rejected rather than
## silently replaced. CV Off (cv_folds = 0) has no fold design to mismatch.
biomod2_check_cv_strategy <- function(cv_strategy, cv_folds) {
  strategy <- tolower(as.character(cv_strategy %||% "kfold")[1])
  folds <- suppressWarnings(as.integer(cv_folds)[1])
  if (is.na(folds) || folds == 0L) return(invisible("none"))
  if (!strategy %in% c("kfold", "random")) {
    stop("biomod2 supports random k-fold CV only; spatial/block CV ('", strategy,
      "') is unsupported. Choose random CV or CV Off for biomod2.", call. = FALSE)
  }
  invisible("kfold")
}

fit_biomod2_sdm <- function(occ, env_train_scaled, background_n = 1000,
                            include_quadratic = FALSE, cv_folds = 3L,
                            seed = 42L, n_cores = 1L, log_fun = NULL,
                            progress_fun = NULL, threshold = 0.5,
                            cv_strategy = "kfold", cv_block_size_km = NULL,
                            bias_method = "uniform", target_group_occ = NULL,
                            thickening_distance_km = NULL, models = NULL,
                            cancel_fun = NULL, ...) {
  # Every real caller passes named controls only; anything else reaching `...`
  # is a control this adapter does not map and must not silently ignore.
  n_extra <- ...length()
  if (n_extra > 0L) {
    extra <- names(list(...)) %||% rep("", n_extra)
    stop("biomod2 adapter does not support control(s): ",
      paste(ifelse(nzchar(extra), extra, "<unnamed>"), collapse = ", "), call. = FALSE)
  }
  biomod2_check_cv_strategy(cv_strategy, cv_folds)
  # thickening_distance_km is only meaningful for bias_method = "thickened";
  # the app always supplies a default value, so it is not itself a request.
  if (!identical(bias_method, "uniform") || !is.null(target_group_occ)) {
    stop("biomod2 adapter supports only uniform background sampling", call. = FALSE)
  }
  if (isTRUE(include_quadratic)) {
    stop("biomod2 adapter does not map include_quadratic; set it to FALSE", call. = FALSE)
  }
  # biomod2 fits sequentially here; a larger core allowance changes speed only.
  if (length(n_cores) != 1L || is.na(n_cores) || n_cores < 1L) {
    stop("biomod2 adapter requires a positive n_cores", call. = FALSE)
  }
  if (n_cores > 1L) log_message(log_fun, "biomod2 adapter fits sequentially (n_cores = 1)")
  # A block size is only a request when spatial blocks are requested, which is
  # rejected above; the app supplies NA for random CV.
  if (!is.null(cv_block_size_km) && !all(is.na(cv_block_size_km))) {
    stop("biomod2 adapter does not support cv_block_size_km", call. = FALSE)
  }
  if (length(threshold) != 1L || is.na(threshold) || !is.finite(threshold) || threshold != 0.5) {
    stop("biomod2 adapter does not support custom threshold controls", call. = FALSE)
  }
  run_biomod2(
    occ_df = occ, pred_stack = env_train_scaled, models = models,
    background_n = background_n, cv_folds = cv_folds, seed = seed,
    output_dir = tempfile("biomod2-run-"), log_fun = log_fun, progress_fun = progress_fun,
    cancel_fun = cancel_fun
  )
}

run_biomod2 <- function(occ_df, pred_stack, models = NULL,
                        background_n = 1000, cv_folds = 3,
                        species_name = NULL, seed = 42,
                        output_dir = tempfile("biomod2-run-"), log_fun = NULL, progress_fun = NULL,
                        cancel_fun = NULL) {
  if (!is.numeric(cv_folds) || length(cv_folds) != 1L || is.na(cv_folds) ||
      !is.finite(cv_folds) || cv_folds < 0 || cv_folds != floor(cv_folds) ||
      (cv_folds > 0 && cv_folds < 2)) {
    stop("cv_folds must be exactly 0 (CV Off) or an integer of at least 2", call. = FALSE)
  }
  # biomod2 4.3's bm_ModelingOptions resolves its built-in ModelsTable
  # dataset unqualified inside a foreach worker. Namespace loading alone does
  # not expose that dataset; the package's supported attach path does.
  if (!("package:biomod2" %in% search())) {
    if (!base::require("biomod2", character.only = TRUE, quietly = TRUE)) {
      stop("biomod2 is required for this adapter", call. = FALSE)
    }
  }
  if (is.null(models)) {
    models <- config$biomod2_default
  }

  sp_name <- if (!is.null(species_name)) {
    species_name
  } else if (!is.null(occ_df$species)) {
    occ_df$species[1]
  } else {
    "species"
  }

  log_message(log_fun, "Running biomod2 with models: ", paste(models, collapse = ", "))

  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  previous_wd <- getwd()
  on.exit(setwd(previous_wd), add = TRUE)
  setwd(output_dir)
  set.seed(seed)
  pa_points <- terra::spatSample(pred_stack,
    size = background_n,
    method = "random", na.rm = TRUE,
    as.points = TRUE, xy = TRUE
  )

  if (is.null(pa_points) || terra::nrow(pa_points) == 0) {
    stop("Failed to generate pseudo-absence points for biomod2", call. = FALSE)
  }

  pa_df <- as.data.frame(pa_points)
  pa_xy <- data.frame(longitude = pa_df$x, latitude = pa_df$y)
  pres_xy <- data.frame(longitude = occ_df$longitude, latitude = occ_df$latitude)

  all_xy <- rbind(pres_xy, pa_xy)
  all_response <- c(rep(1, nrow(occ_df)), rep(0, nrow(pa_xy)))

  biomod_data <- tryCatch({
    biomod2::BIOMOD_FormatingData(
      resp.var = all_response,
      expl.var = pred_stack,
      resp.name = sp_name,
      resp.xy = all_xy,
      na.rm = TRUE
    )
  }, error = function(e) {
    stop("biomod2 data formatting failed: ", conditionMessage(e), call. = FALSE)
  })

  modeling_id <- paste0("sdm_", safe_slug(sp_name), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))

  # Installed biomod2 defaults are used explicitly; no adapter-specific model-option
  # object is injected because it can omit the installed algorithm table.
  bm_opts <- NULL

  # biomod2 4.3 uses CV.k for k-folds and writes under its default workspace;
  # output.dir is not a BIOMOD_Modeling argument and must not be silently filtered.
  if (cv_folds == 0L) {
    cv_user_table <- matrix(TRUE, nrow = length(biomod_data@data.species), ncol = 1L,
      dimnames = list(NULL, "_allData_RUN1"))
    cv_args <- list(CV.strategy = "user.defined", CV.user.table = cv_user_table,
      CV.do.full.models = FALSE)
  } else {
    cv_args <- list(CV.strategy = "kfold", CV.nb.rep = 1L, CV.k = as.integer(cv_folds),
      CV.do.full.models = TRUE)
  }
  user_args <- c(list(
    bm.format = biomod_data,
    models = models,
    modeling.id = modeling_id,
    OPT.strategy = "default",
    nb.cpu = 1,
    seed.val = seed,
    metric.eval = c("AUCroc", "TSS"),
    var.import = 0,
    do.progress = FALSE
  ), cv_args)
  unsupported <- setdiff(names(user_args), names(formals(biomod2::BIOMOD_Modeling)))
  if (length(unsupported)) {
    stop("Installed biomod2 BIOMOD_Modeling does not support required arguments: ",
      paste(unsupported, collapse = ", "), call. = FALSE)
  }
  if (is.function(cancel_fun) && isTRUE(cancel_fun(log_fun))) {
    return(invisible(NULL))
  }
  biomod_mod <- tryCatch({
    do.call(biomod2::BIOMOD_Modeling, user_args)
  }, error = function(e) {
    stop("biomod2 modeling failed: ", conditionMessage(e), call. = FALSE)
  })

  if (is.function(cancel_fun) && isTRUE(cancel_fun(log_fun))) {
    return(invisible(NULL))
  }

  evaluations <- tryCatch({
    biomod2::get_evaluations(biomod_mod)
  }, error = function(e) {
    log_message(log_fun, "biomod2 get_evaluations failed: ", conditionMessage(e))
    NULL
  })
  var_importance <- tryCatch({
    biomod2::get_variables_importance(biomod_mod)
  }, error = function(e) {
    log_message(log_fun, "biomod2 get_variables_importance failed: ", conditionMessage(e))
    NULL
  })

  if (is.null(evaluations)) evaluations <- data.frame()
  if (!is.data.frame(evaluations)) {
    stop("Installed biomod2 returned unsupported evaluation structure: expected data.frame", call. = FALSE)
  }
  eval_df <- data.frame(algorithm = character(), auc = numeric(), tss = numeric(),
    stringsAsFactors = FALSE)
  if (nrow(evaluations) > 0) {
    algo_col <- intersect(c("algo", "algorithm", "model"), names(evaluations))[1]
    metric_col <- intersect(c("metric.eval", "metric", "metric_eval"), names(evaluations))[1]
    data_col <- intersect(c("validation", "evaluation", "Testing"), names(evaluations))[1]
    if (anyNA(c(algo_col, metric_col, data_col))) {
      stop("Installed biomod2 evaluation data.frame has unsupported columns: ",
        paste(names(evaluations), collapse = ", "), call. = FALSE)
    }
    # biomod2's `validation` column contains held-out validation metrics for
    # the CV runs. Full-data models are training fits and must never be used as
    # validation evidence.
    eval_rows <- evaluations
    if ("run" %in% names(eval_rows)) {
      eval_rows <- eval_rows[!grepl("allRun", as.character(eval_rows$run), ignore.case = TRUE), , drop = FALSE]
    }
    if (cv_folds == 0L) {
      eval_rows <- eval_rows[0, , drop = FALSE]
    }
    algos <- unique(as.character(eval_rows[[algo_col]]))
    for (algo in algos) {
      rows <- eval_rows[as.character(eval_rows[[algo_col]]) == algo, , drop = FALSE]
      auc <- suppressWarnings(as.numeric(rows[[data_col]][as.character(rows[[metric_col]]) == "AUCroc"]))
      tss <- suppressWarnings(as.numeric(rows[[data_col]][as.character(rows[[metric_col]]) == "TSS"]))
      eval_df <- rbind(eval_df, data.frame(algorithm = algo,
        auc = if (length(auc) && any(is.finite(auc))) mean(auc[is.finite(auc)]) else NA_real_,
        tss = if (length(tss) && any(is.finite(tss))) mean(tss[is.finite(tss)]) else NA_real_))
    }
  }

  if (cv_folds == 0L) {
    eval_df <- data.frame(algorithm = as.character(models), auc = NA_real_, tss = NA_real_,
      stringsAsFactors = FALSE)
  }
  auc_vals <- eval_df$auc
  tss_vals <- eval_df$tss
  cv_auc_mean <- if (cv_folds == 0L || !any(is.finite(auc_vals))) NA_real_ else mean(auc_vals[is.finite(auc_vals)])
  cv_auc_sd <- if (cv_folds == 0L || sum(is.finite(auc_vals)) < 2L) NA_real_ else sd(auc_vals[is.finite(auc_vals)])
  cv_tss_mean <- if (cv_folds == 0L || !any(is.finite(tss_vals))) NA_real_ else mean(tss_vals[is.finite(tss_vals)])
  cv_tss_sd <- if (cv_folds == 0L || sum(is.finite(tss_vals)) < 2L) NA_real_ else sd(tss_vals[is.finite(tss_vals)])

  varimp_df <- data.frame(variable = character(), importance = numeric(), stringsAsFactors = FALSE)
  if (!is.null(var_importance) && length(var_importance) > 0L) {
    var_importance <- as.array(var_importance)
    if (length(dim(var_importance)) >= 2L) {
      varimp_df <- data.frame(
        variable = dimnames(var_importance)[[2]] %||% character(),
        importance = as.numeric(var_importance[1, , drop = TRUE]),
        stringsAsFactors = FALSE
      )
      rownames(varimp_df) <- NULL
    }
  }

  list(
    model = biomod_mod,
    formula = NULL,
    coefficients = eval_df,
    occurrence_used = occ_df,
    background_xy = pa_xy,
    cv = list(
      k = cv_folds,
      enabled = cv_folds > 0L,
      strategy = if (cv_folds == 0L) "none" else "kfold",
      auc_mean = cv_auc_mean,
      auc_sd = cv_auc_sd,
      tss_mean = cv_tss_mean,
      tss_sd = cv_tss_sd,
      per_algorithm = eval_df
    ),
    covariates = names(pred_stack),
    variable_importance = varimp_df,
    binary_metrics = NULL,
    model_id = "biomod2",
    algorithms = as.character(models),
    modeling_id = modeling_id
  )
}

## Exact full-data model names for every requested algorithm. CV Off fits one
## all-data run (RUN1); enabled k-fold adds the full model as allRun. Fold
## models are never substituted for a full model.
biomod2_full_model_names <- function(fit) {
  algorithms <- as.character(fit$algorithms %||% character())
  if (!length(algorithms)) {
    stop("biomod2 fit does not record its requested algorithms", call. = FALSE)
  }
  run_tag <- if (isTRUE(fit$cv$enabled)) "_allData_allRun_" else "_allData_RUN1_"
  stats::setNames(paste0(fit$model@sp.name, run_tag, algorithms), algorithms)
}

predict_biomod2_suitability <- function(fit, env_project_scaled, output_tif,
                                        n_cores = 1, log_fun = NULL) {
  full_names <- biomod2_full_model_names(fit)
  built <- biomod2::get_built_models(fit$model)
  missing <- names(full_names)[!full_names %in% built]
  if (length(missing)) {
    stop("biomod2 full-data model missing for requested algorithm(s): ",
      paste(missing, collapse = ", "), call. = FALSE)
  }

  # BIOMOD_Projection writes relative to the working directory; run it from the
  # fit's own modelling directory and always restore the caller's directory.
  previous_wd <- getwd()
  on.exit(setwd(previous_wd), add = TRUE)
  setwd(fit$model@dir.name)
  proj_name <- paste0("proj_", basename(tempfile("")))
  proj <- biomod2::BIOMOD_Projection(
    bm.mod = fit$model,
    new.env = env_project_scaled,
    proj.name = proj_name,
    models.chosen = unname(full_names),
    build.clamping.mask = FALSE,
    nb.cpu = 1
  )
  preds <- biomod2::get_predictions(proj)
  if (!inherits(preds, "SpatRaster") || !all(full_names %in% names(preds))) {
    stop("biomod2 projection did not return every requested full-data model", call. = FALSE)
  }
  # biomod2 stores probabilities as round(p * 1000). Equal weights, no
  # calibration weighting, over exactly the requested full-data layers.
  layers <- preds[[unname(full_names)]] / 1000
  suitability <- if (terra::nlyr(layers) == 1L) layers else terra::app(layers, mean)
  names(suitability) <- "suitability"

  if (!is.null(output_tif)) {
    terra::writeRaster(suitability, output_tif,
      overwrite = TRUE,
      wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES", "NODATA=-9999"))
    )
    return(terra::rast(output_tif))
  }
  terra::toMemory(suitability)
}
