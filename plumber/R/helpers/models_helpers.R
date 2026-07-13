sdm_process_registry <- new.env(parent = emptyenv())

sdm_force_cpu_runtime_config <- function(body) {
  body$gpu_enabled <- "off"
  model_id <- as.character(body$model_id %||% body$modelId %||% "")[1]
  if (model_id %in% c("dnn", "dnn_multispecies")) {
    body$dnn_device <- "cpu"
  }
  if (identical(model_id, "python_torch_dnn")) {
    body$python_device <- "cpu"
    body$device <- "cpu"
  }
  body
}

handle_model_run <- function(req, app_dir) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody),
    error = function(e) {
      cat("JSON parse error:", conditionMessage(e), "\n")
      NULL
    }
  )
  if (is.null(body)) return(sdm_error_code(req, "INVALID_INPUT", "Request body is empty or not valid JSON"))

  required <- c("species", "model_id", "occurrence_file")
  missing <- setdiff(required, names(body))
  if (length(missing) > 0) {
    return(sdm_error_code(req, "INVALID_INPUT", paste("Missing required fields:", paste(missing, collapse = ", "))))
  }

  biovars <- as.integer(unlist(strsplit(as.character(body$biovars %||% "1,4,6,12,15,18"), ",")))
  projection_extent <- as.numeric(unlist(strsplit(as.character(body$projection_extent %||% "112,154,-44,-10"), ",")))
  if (length(projection_extent) != 4 || any(!is.finite(projection_extent))) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent must have 4 numeric values: xmin,xmax,ymin,ymax"))
  }
  if (projection_extent[1] >= projection_extent[2] || projection_extent[3] >= projection_extent[4]) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent has invalid ordering: xmin must be < xmax, ymin must be < ymax"))
  }
  if (projection_extent[1] < -180 || projection_extent[2] > 180 || projection_extent[3] < -90 || projection_extent[4] > 90) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent is outside valid coordinate bounds (\u00b1180, \u00b190)"))
  }

  # Validate ENMeval algorithm when tuning_method is enmeval
  tuning_method <- sdm_payload_coalesce(body$tuning_method, body$tuningMethod) %||% "none"
  if (identical(tuning_method, "enmeval")) {
    enmeval_algo <- sdm_payload_coalesce(body$enmeval_algorithm, body$enmevalAlgorithm) %||% "maxnet"
    if (!has_enmdetails(enmeval_algo)) {
      return(sdm_error_code(req, "INVALID_INPUT", paste0("ENMeval algorithm '", enmeval_algo, "' is not available. Supported: ", paste(ls(envir = sdm_enmdetails_registry), collapse = ", "))))
    }
  }

  tryCatch({
    mem_info <- sdm_mem_info()
    if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
      if (mem_info$memavail < 1.0) {
        return(sdm_error_code(req, "INTERNAL_ERROR", paste0(
          "Server memory critically low (", sprintf("%.1f", mem_info$memavail),
          " GB available). Wait for other runs to complete or restart the container."
        )))
      }
    }
  }, error = function(e) {
    sdm_log_error("Memory check failed: %s", conditionMessage(e))
  })

  active <- sdm_count_active_runs()
  if (active >= SDM_MAX_CONCURRENT_RUNS) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste0(
      "Server busy: ", active, " model run(s) in progress (max ", SDM_MAX_CONCURRENT_RUNS,
      "). Please wait and retry."
    )))
  }

  job_id <- paste0("run-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)
  tmp_dir <- file.path(job_dir, ".tmp")
  dir.create(tmp_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  script_path <- file.path(app_dir, "plumber", "R", "run_model_background.R")
  if (!file.exists(script_path)) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste("Model run script not found at:", script_path)))
  }

  python_device <- body$python_device %||% body$pythonDevice %||% body$device %||% "auto"
  gpu_backend <- sdm_model_gpu_backend(
    body$model_id, body$dnn_device %||% "auto", body$gpu_enabled %||% "auto",
    python_device = python_device
  )
  is_gpu_model <- sdm_backend_is_gpu(gpu_backend)
  if (is_gpu_model) {
    active_gpu <- sdm_count_active_gpu_runs()
    if (active_gpu >= SDM_MAX_GPU_CONCURRENT_RUNS) {
      return(sdm_error_code(req, "GPU_BUSY", paste0(
        "GPU busy: ", active_gpu, " GPU model run(s) in progress (max ", SDM_MAX_GPU_CONCURRENT_RUNS,
        "). Queue this run or wait."
      )))
    }
    # Layered VRAM check is relevant to discrete CUDA/ROCm GPUs. MPS has no
    # portable free-VRAM telemetry and should not be rejected for its absence.
    gpu_vram_ok <- !sdm_backend_is_discrete_gpu(gpu_backend) ||
      tryCatch(sdm_gpu_vram_is_usable(), error = function(e) FALSE)
    if (!gpu_vram_ok) {
      free_mib <- tryCatch(sdm_gpu_available_vram(), error = function(e) NA_real_)
      if (!is.finite(free_mib) || is.na(free_mib)) {
        warning("[GPU] sdm_gpu_available_vram() returned NA — GPU telemetry unavailable. Ensure the selected accelerator is visible to the worker.")
      }
      free_gb <- if (is.finite(free_mib) && !is.na(free_mib)) sprintf("%.1f GiB", free_mib / 1024) else "unknown"
      msg <- paste0("GPU requested but VRAM insufficient (", free_gb, " free, min ~1.5 GiB). Auto-fallback to CPU for this run.")
      is_gpu_model <- FALSE
      body <- sdm_force_cpu_runtime_config(body)
      # Write GPU-fallback progress entry so frontend UI displays it
      progress_json_path <- file.path(job_dir, "progress.json")
      fb_entry <- list(
        timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
        percent = 0,
        detail = msg,
        stage = "gpu_fallback"
      )
      cat(jsonlite::toJSON(fb_entry, auto_unbox = TRUE), "\n",
          file = progress_json_path, append = TRUE)
      # Also record in meta.json so status endpoint surfaces it immediately
      meta_path <- file.path(job_dir, "meta.json")
      if (file.exists(meta_path)) {
        m <- tryCatch(jsonlite::fromJSON(meta_path, simplifyVector = FALSE), error = function(e) list())
        m$gpu_fallback <- msg
        sdm_write_json(m, meta_path)
      }
    }
  }

  env <- c(
    Sys.getenv(),
    HOME = "/app",
    TMPDIR = tmp_dir,
    OMP_THREAD_LIMIT = as.character(getOption("sdm.omp_thread_limit", "1")),
    R_MAX_VSIZE = sdm_detect_vsize(),
    PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True,max_split_size_mb:512",
    CUBLAS_WORKSPACE_CONFIG = ":4096:8"
  )

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  cmdargs = c("--no-save", "--no-restore"),
  env = env)
  device_tag <- if (is_gpu_model) gpu_backend else "cpu"
  sdm_process_registry[[job_id]] <- list(proc = proc, device = device_tag)

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "pending",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config = as.list(body),
    output_dir = job_dir,
    process_pid = proc$get_pid()
  )
  job_meta_file <- file.path(job_dir, "meta.json")
  sdm_write_json(job_meta, job_meta_file)

  progress_log <- file.path(job_dir, "progress.log")

  list(
    job_id = job_id,
    status = "running",
    message = "Model run started in background"
  )
}

sdm_camel_to_snake <- list(
  modelId = "model_id", backgroundN = "background_n", cvFolds = "cv_folds",
  cvStrategy = "cv_strategy", cvBlockSizeKm = "cv_block_size_km",
  includeQuadratic = "include_quadratic", nCores = "n_cores",
  paReplicates = "pa_replicates", maskType = "mask_type",
  maskFile = "mask_file", maskBufferDeg = "mask_buffer_deg",
  maskBoundaryType = "mask_boundary_type", maskResolution = "mask_resolution",
  maskCountry = "mask_country", restrictBackground = "restrict_background",
  biasMethod = "bias_method", thickeningDistanceKm = "thickening_distance_km",
  targetGroupFile = "target_group_file", minSourceRecords = "min_source_records",
  mergeSmallSources = "merge_small_sources", thinByCell = "thin_by_cell",
  vifReduction = "vif_reduction", vifThreshold = "vif_threshold",
  climateMatching = "climate_matching",
  climateMatchingMethod = "climate_matching_method",
  futureProjection = "future_projection",
  futureProjection2 = "future_projection2",
  futureWorldclimDir = "future_worldclim_dir", futureLabel = "future_label",
  futureWorldclimDir2 = "future_worldclim_dir2", futureLabel2 = "future_label2",
  worldclimDir = "worldclim_dir", worldclimRes = "worldclim_res",
  useElevation = "use_elevation", elevationDemtype = "elevation_demtype",
  opentopoApiKey = "opentopo_api_key", useSoil = "use_soil",
  soilVars = "soil_vars", soilDepths = "soil_depths",
  useUv = "use_uv", uvVars = "uv_vars", uvMonths = "uv_months",
  useVegetation = "use_vegetation", vegYear = "veg_year",
  vegProducts = "veg_products", useLulc = "use_lulc", lulcYear = "lulc_year",
  useHfp = "use_hfp", hfpYear = "hfp_year",
  useBioclimSeason = "use_bioclim_season", useDrought = "use_drought",
  droughtPeriods = "drought_periods", maxnetFeatures = "maxnet_features",
  maxnetRegmult = "maxnet_regmult", aggregationFactor = "aggregation_factor",
  occurrenceFile = "occurrence_file", cleanedFilePath = "cleaned_file_path",
  pipelineRunId = "pipeline_run_id", extrapolationMask = "extrapolation_mask",
  messThreshold = "mess_threshold", dnnArchitecture = "dnn_model_type",
  dnnNSeeds = "dnn_n_seeds", dnnDevice = "dnn_device",
  hiddenLayers = "hidden_layers", batchSize = "batch_size",
  predictBatchSize = "predict_batch_size", learningRate = "learning_rate",
  pythonDevice = "python_device", earlyStoppingPatience = "early_stopping_patience",
  validationFraction = "validation_fraction", nEstimators = "n_estimators",
  maxDepth = "max_depth", maxIterations = "max_iterations",
  brtNTrees = "brt_n_trees", brtInteractionDepth = "brt_interaction_depth",
  brtShrinkage = "brt_shrinkage", brtBagFraction = "brt_bag_fraction",
  ctaCp = "cta_cp", ctaMaxdepth = "cta_maxdepth",
  ctaMinsplit = "cta_minsplit", marsDegree = "mars_degree",
  marsPenalty = "mars_penalty", marsNk = "mars_nk",
  fdaDegree = "fda_degree", fdaNprune = "fda_nprune",
  annSize = "ann_size", annDecay = "ann_decay", annMaxit = "ann_maxit",
  annRang = "ann_rang", rfNumTrees = "rf_num_trees", rfMtry = "rf_mtry",
  rfMinNodeSize = "rf_min_node_size", xgbMaxDepth = "xgb_max_depth",
  xgbEta = "xgb_eta", xgbNrounds = "xgb_nrounds",
  xgbNRounds = "xgb_nrounds", bartNtree = "bart_ntree",
  bartNdpost = "bart_ndpost", bartNskip = "bart_nskip",
  brmsChains = "brms_chains", brmsIter = "brms_iter",
  brmsWarmup = "brms_warmup", inlaMeshMaxEdge = "inla_mesh_max_edge",
  inlaMeshCutoff = "inla_mesh_cutoff", inlaPriorRange = "inla_prior_range",
  inlaPriorSigma = "inla_prior_sigma", rangebagNBags = "rangebag_n_bags",
  rangebagBagFraction = "rangebag_bag_fraction",
  rangebagVarsPerBag = "rangebag_vars_per_bag",
  detectionFormula = "detection_formula",
  detectionModelType = "detection_model_type",
  dnnMultispeciesArchitecture = "dnn_multispecies_architecture",
  dnnMultispeciesNSeeds = "dnn_multispecies_n_seeds",
  gllvmFamily = "gllvm_family",
  gllvmNumLv = "gllvm_num_lv",
  gllvmNumRows = "gllvm_num_rows",
  gllvmLvCorr = "gllvm_lv_corr",
  multiEnsembleModels = "multi_ensemble_models",
  multiEnsembleBiomod2 = "biomod2_models",
  multiEnsembleWeighting = "multi_ensemble_weighting",
  multiEnsemblePower = "multi_ensemble_power",
  multiEnsembleMinAuc = "multi_ensemble_min_auc",
  multiEnsembleMinTss = "multi_ensemble_min_tss",
  biomod2Models = "biomod2_models", esmNRuns = "esm_n_runs",
  esmSplit = "esm_split", esmMinAuc = "esm_min_auc",
  esmWeightingMetric = "esm_weighting_metric", esmPower = "esm_power",
  esmBiovars = "esm_biovars", maxnetAutoTune = "maxnet_auto_tune",
  gamK = "gam_k",   dnnDropout = "dnn_dropout", dnnL2Lambda = "dnn_lambda",
  dnnMixedPrecision = "dnn_mixed_precision", dnnCudaGraphs = "dnn_cuda_graphs",
  dnnFusedAdam = "dnn_fused_adam",
  dnnMcSamples = "dnn_mc_samples",
  dnnUncertaintyMethod = "dnn_uncertainty_method",
  multiEnsembleExport = "multi_ensemble_export",
  multiEnsembleUncertainty = "multi_ensemble_uncertainty",
  chelsaExtras = "chelsa_extras", analysisCrs = "analysis_crs",
  generateTiles = "generate_tiles", generateCog = "generate_cog",
  speciesFilter = "species_filter", trainingExtent = "training_extent",
  dnnModelType = "dnn_model_type",
  cleanedFileId = "cleaned_file_id",
  tuningMethod = "tuning_method",
  enmevalAlgorithm = "enmeval_algorithm",
  enmevalPartitions = "enmeval_partitions",
  enmevalSelectionMetric = "enmeval_selection_metric",
  enmevalTuneArgs = "enmeval_tune_args",
  enmevalCategoricals = "enmeval_categoricals",
  enmevalNullIterations = "enmeval_null_iterations"
)

sdm_targets_config_field_types <- list(
  logical = c("include_quadratic", "use_elevation", "use_soil", "use_uv",
    "use_vegetation", "use_lulc", "use_hfp", "use_bioclim_season",
    "use_drought", "vif_reduction", "thin_by_cell", "merge_small_sources",
    "extrapolation_mask", "future_projection", "climate_matching",
    "restrict_background", "multi_ensemble_export", "multi_ensemble_uncertainty",
    "maxnet_auto_tune", "generate_tiles", "generate_cog"),
  integer = c("background_n", "cv_folds", "aggregation_factor", "seed",
    "n_cores", "pa_replicates", "min_source_records", "thickening_distance_km",
    "worldclim_res", "dnn_n_seeds", "dnn_multispecies_n_seeds", "dnn_mc_samples",
    "n_estimators", "max_depth", "max_iterations", "epochs", "batch_size",
    "predict_batch_size", "early_stopping_patience",
    "brt_n_trees", "brt_interaction_depth", "cta_maxdepth", "cta_minsplit",
    "mars_degree", "mars_nk", "fda_degree", "fda_nprune", "ann_size",
    "ann_maxit", "ann_rang", "rf_num_trees", "rf_mtry", "rf_min_node_size",
    "xgb_max_depth", "bart_ntree", "bart_ndpost", "bart_nskip",
    "brms_chains", "brms_iter", "brms_warmup", "gam_k",
    "multi_ensemble_power", "rangebag_n_bags", "rangebag_vars_per_bag",
    "esm_n_runs", "esm_split", "esm_power", "vif_threshold"),
  numeric = c("threshold", "cv_block_size_km", "brt_shrinkage",
    "brt_bag_fraction", "mars_penalty", "ann_decay", "xgb_eta",
    "maxnet_regmult", "rangebag_bag_fraction", "dnn_dropout",
    "dnn_lambda", "mess_threshold", "multi_ensemble_min_auc",
    "multi_ensemble_min_tss", "esm_min_auc", "inla_mesh_max_edge",
    "inla_mesh_cutoff", "inla_prior_range", "inla_prior_sigma",
    "opentopo_api_key", "learning_rate", "dropout", "validation_fraction"),
  comma_doubles = c("projection_extent", "training_extent",
    "future_projection_extent"),
  comma_ints = c("biovars", "esm_biovars", "hidden_layers"),
  comma_strings = c("soil_vars", "soil_depths", "uv_vars", "uv_months",
    "veg_products", "drought_periods", "chelsa_extras",
    "multi_ensemble_models", "biomod2_models"),
  target_group_files = c("target_group_file"),
  enmeval_json = c("enmeval_tune_args", "enmeval_other_settings")
)

normalize_targets_config <- function(cfg) {
  cfg <- as.list(cfg)
  result <- list()

  # 1. Normalize camelCase keys to snake_case
  for (name in names(cfg)) {
    snake <- sdm_camel_to_snake[[name]]
    if (!is.null(snake)) {
      names(cfg)[names(cfg) == name] <- snake
    }
  }

  # 2. Handle occurrence file coalescing
  occ_file <- sdm_payload_coalesce(
    cfg[["cleaned_file_id"]],
    cfg[["cleaned_file_path"]],
    cfg[["cleanedFilePath"]],
    cfg[["occurrence_file"]],
    cfg[["occurrenceFile"]]
  )
  if (is.null(occ_file) || !nzchar(occ_file %||% "")) {
    stop("No occurrence file found in config. Provide occurrenceFile or cleanedFilePath.", call. = FALSE)
  }
  result$occurrences_csv <- occ_file

  # 3. Handle species_filter — only set if explicitly provided
  result$species <- as.character(cfg[["species"]] %||% "")
  sp_filter <- sdm_payload_coalesce(cfg[["species_filter"]], cfg[["speciesFilter"]])
  if (!is.null(sp_filter) && nzchar(sp_filter %||% "")) {
    result$species_filter <- as.character(sp_filter)
  }

  # 4. Handle model_id
  result$model_id <- as.character(cfg[["model_id"]] %||% cfg[["modelId"]] %||% "glm")

  # 5. Format fields by type
  for (field in names(cfg)) {
    val <- cfg[[field]]
    if (is.null(val)) next
    # Skip already-handled fields and reserved names
    if (field %in% names(result)) next
    if (field %in% c("species", "species_filter", "model_id", "cleaned_file_id",
                     "cleaned_file_path", "occurrence_file", "runId", "pipeline_run_id",
                     "id", "projectId", "userId", "createdAt", "updatedAt")) next

    snake <- sdm_camel_to_snake[[field]]
    field_name <- snake %||% field

    if (field_name %in% sdm_targets_config_field_types$comma_doubles) {
      result[[field_name]] <- paste(as.numeric(val), collapse = ",")
    } else if (field_name %in% sdm_targets_config_field_types$comma_ints) {
      result[[field_name]] <- paste(as.integer(val), collapse = ",")
    } else if (field_name %in% sdm_targets_config_field_types$comma_strings) {
      result[[field_name]] <- paste(as.character(val), collapse = ",")
    } else if (field_name %in% sdm_targets_config_field_types$logical) {
      result[[field_name]] <- if (isTRUE(as.logical(val[1]))) "TRUE" else "FALSE"
    } else if (field_name %in% sdm_targets_config_field_types$integer) {
      result[[field_name]] <- as.character(as.integer(val[1]))
    } else if (field_name %in% sdm_targets_config_field_types$numeric) {
      result[[field_name]] <- as.character(as.numeric(val[1]))
    } else {
      result[[field_name]] <- as.character(val)
    }
  }

  result
}

handle_targets_run <- function(req, app_dir) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody),
    error = function(e) {
      sdm_log_error("Targets run JSON parse failed: %s", conditionMessage(e))
      NULL
    }
  )
  if (is.null(body) || is.null(body$configs) || length(body$configs) == 0) {
    return(sdm_error_code(req, "INVALID_INPUT", "Request body must contain a non-empty 'configs' array"))
  }

  # Validate ENMeval algorithms in all configs
  for (i in seq_along(body$configs)) {
    c <- body$configs[[i]]
    tuning <- sdm_payload_coalesce(c$tuning_method, c$tuningMethod) %||% "none"
    if (identical(tuning, "enmeval")) {
      algo <- sdm_payload_coalesce(c$enmeval_algorithm, c$enmevalAlgorithm) %||% "maxnet"
      if (!has_enmdetails(algo)) {
        return(sdm_error_code(req, "INVALID_INPUT", paste0("Config ", i, ": ENMeval algorithm '", algo, "' not available.")))
      }
    }
  }

  job_id <- paste0("targets-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  configs <- body$configs
  csv_rows <- lapply(seq_along(configs), function(i) {
    as.data.frame(normalize_targets_config(configs[[i]]), stringsAsFactors = FALSE)
  })
  all_cols <- unique(unlist(lapply(csv_rows, names)))
  config_df <- data.table::rbindlist(lapply(csv_rows, function(r) {
    missing <- setdiff(all_cols, names(r))
    r[missing] <- NA_character_
    r[all_cols]
  }))
  # Ensure essential columns exist
  if (!"species" %in% names(config_df)) config_df$species <- ""
  if (!"occurrences_csv" %in% names(config_df)) config_df$occurrences_csv <- ""
  config_csv <- file.path(job_dir, "config.csv")
  write.csv(config_df, config_csv, row.names = FALSE)

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "queued",
    type = "targets",
    n_species = length(configs),
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config_csv = config_csv
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"))

  script_path <- file.path(app_dir, "plumber", "R", "targets_dispatcher.R")
  if (!file.exists(script_path)) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste("Targets dispatcher not found at:", script_path)))
  }

  # Detect multi-species mode (any model flagged as multispecies, e.g. dnn_multispecies, gllvm)
  model_ids <- unique(vapply(configs, function(c) {
    sdm_payload_coalesce(c[["model_id"]], c[["modelId"]], "glm") %||% "glm"
  }, character(1)))
  is_multispecies <- sdm_any_multispecies_model(model_ids)

  env_vars <- c(
    Sys.getenv(),
    HOME = "/app",
    OMP_THREAD_LIMIT = as.character(getOption("sdm.omp_thread_limit", "1")),
    R_MAX_VSIZE = sdm_detect_vsize(),
    PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True,max_split_size_mb:512",
    CUBLAS_WORKSPACE_CONFIG = ":4096:8")
  if (is_multispecies) {
    env_vars["SDM_MULTISPECIES"] <- "true"
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  cmdargs = c("--no-save", "--no-restore"),
  env = env_vars)
  target_backends <- vapply(configs, function(c) {
    mid <- c$model_id %||% c[["modelId"]] %||% "glm"
    dev <- c$dnn_device %||% c[["dnnDevice"]] %||% "auto"
    gpu <- c$gpu_enabled %||% c[["gpuEnabled"]] %||% "auto"
    py_dev <- c$python_device %||% c[["pythonDevice"]] %||% c$device %||% "auto"
    sdm_model_gpu_backend(mid, dev, gpu, python_device = py_dev)
  }, character(1))
  gpu_backends <- target_backends[vapply(target_backends, sdm_backend_is_gpu, logical(1))]
  device_tag <- if (length(gpu_backends) > 0) gpu_backends[[1]] else "cpu"
  sdm_process_registry[[job_id]] <- list(proc = proc, device = device_tag)

  job_meta$process_pid <- proc$get_pid()
  job_meta$status <- "running"
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"))

  list(
    job_id = job_id,
    status = "running",
    n_species = length(configs),
    message = paste0("Targets pipeline started with ", length(configs), " species")
  )
}

handle_targets_status <- function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      res$status <- 500L
      return(list(error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)

  if (identical(meta$status, "running")) {
    entry <- sdm_process_registry[[job_id]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({ process_alive <- tools::pskill(pid, signal = 0) }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed"
      meta$error_code <- "PROCESS_CRASH"
      meta$error_hint <- "The process was terminated by the OS, likely due to insufficient memory. Reduce covariates, use coarser resolution, or increase available memory."
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
    }
  }

  store_path <- file.path(job_dir, "_targets")
  targets_progress <- NULL
  if (dir.exists(store_path)) {
    tryCatch({
      tm <- targets::tar_meta(store = store_path)
      if (is.data.frame(tm) && nrow(tm) > 0) {
        targets_progress <- list(
          total_targets = nrow(tm),
          completed = sum(tm$status == "completed", na.rm = TRUE),
          errored = sum(tm$status == "errored", na.rm = TRUE),
          running = sum(tm$status == "running", na.rm = TRUE)
        )
        targets_progress$targets <- lapply(seq_len(nrow(tm)), function(i) {
          list(
            name = tm$name[i],
            type = tm$type[i] %||% "stem",
            status = tm$status[i] %||% "unknown",
            seconds = if (!is.null(tm$seconds[i]) && is.finite(tm$seconds[i])) tm$seconds[i] else NULL,
            error = if (!is.null(tm$error[i]) && nzchar(tm$error[i] %||% "")) tm$error[i] else NULL
          )
        })
      }
    }, error = function(e) NULL)
  }

  progress_log <- character(0)
  progress_file <- file.path(job_dir, "progress.log")
  if (file.exists(progress_file)) {
    progress_log <- readLines(progress_file, warn = FALSE)
  }

  list(
    id = meta$id,
    status = meta$status,
    n_species = meta$n_species %||% 0,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    targets_progress = targets_progress,
    progress_log = progress_log
  )
}

handle_targets_results <- function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  store_path <- file.path(job_dir, "_targets")

  config_csv <- file.path(job_dir, "config.csv")
  species_list <- character(0)
  if (file.exists(config_csv)) {
    tryCatch({
      df <- read.csv(config_csv, stringsAsFactors = FALSE)
      species_list <- df$species
    }, error = function(e) NULL)
  }

  results <- list()
  if (dir.exists(store_path)) {
    tryCatch({
      tm <- targets::tar_meta(store = store_path)
      if (is.data.frame(tm) && nrow(tm) > 0) {
        # Match post-process branch targets to species list by index
        post_names <- grep("^post_", tm$name, value = TRUE)
        post_names <- post_names[order(as.integer(gsub("^post_", "", post_names)))]
        for (i in seq_along(post_names)) {
          pr <- tm[tm$name == post_names[i], , drop = FALSE]
          species_name <- if (i <= length(species_list)) species_list[i] else paste0("species_", i)
          species_result <- NULL
          if (!is.null(pr$format) && identical(pr$format, "rds") &&
              !is.null(pr$data[[1]]$path) && nzchar(pr$data[[1]]$path %||% "")) {
            result_path <- file.path(job_dir, pr$data[[1]]$path)
            if (file.exists(result_path)) {
              safe_rds <- sdm_safe_path(result_path, job_dir)
              if (!is.null(safe_rds)) {
                species_result <- tryCatch(readRDS(safe_rds), error = function(e) NULL)
              }
            }
          }
          results[[species_name]] <- list(
            name = species_name,
            status = pr$status %||% "unknown",
            error = if (!is.null(pr$error) && nzchar(pr$error[1] %||% "")) pr$error[1] else NULL,
            metrics = tryCatch({
              if (!is.null(species_result)) {
                list(
                  auc_mean = species_result$cv$auc_mean %||% NA_real_,
                  auc_sd = species_result$cv$auc_sd %||% NA_real_,
                  tss_mean = species_result$cv$tss_mean %||% NA_real_,
                  tss_sd = species_result$cv$tss_sd %||% NA_real_,
                  cbi = species_result$metrics$cbi %||% NA_real_,
                  presence_records = species_result$metrics$presence_records %||% NA_integer_,
                  elapsed_seconds = species_result$metrics$elapsed_seconds %||% NA_real_
                )
              } else NULL
            }, error = function(e) NULL)
          )
        }

        # Also handle bare `post` target (multi-species joint pipeline mode)
        if ("post" %in% tm$name) {
          pr <- tm[tm$name == "post", , drop = FALSE]
          species_result <- NULL
          if (!is.null(pr$format) && identical(pr$format, "rds") &&
              !is.null(pr$data[[1]]$path) && nzchar(pr$data[[1]]$path %||% "")) {
            result_path <- file.path(job_dir, pr$data[[1]]$path)
            if (file.exists(result_path)) {
              safe_rds <- sdm_safe_path(result_path, job_dir)
              if (!is.null(safe_rds)) {
                species_result <- tryCatch(readRDS(safe_rds), error = function(e) NULL)
              }
            }
          }
          composite_name <- paste(species_list, collapse = " + ")
          results[["multi_species"]] <- list(
            name = composite_name,
            status = pr$status %||% "unknown",
            error = if (!is.null(pr$error) && nzchar(pr$error[1] %||% "")) pr$error[1] else NULL,
            metrics = tryCatch({
              if (!is.null(species_result)) {
                list(
                  auc_mean = species_result$cv$auc_mean %||% NA_real_,
                  auc_sd = species_result$cv$auc_sd %||% NA_real_,
                  tss_mean = species_result$cv$tss_mean %||% NA_real_,
                  tss_sd = species_result$cv$tss_sd %||% NA_real_,
                  cbi = species_result$metrics$cbi %||% NA_real_,
                  presence_records = species_result$metrics$presence_records %||% NA_integer_,
                  elapsed_seconds = species_result$metrics$elapsed_seconds %||% NA_real_
                )
              } else NULL
            }, error = function(e) NULL)
          )
        }
      }
    }, error = function(e) NULL)
  }

  list(
    id = meta$id,
    status = meta$status,
    n_species = meta$n_species %||% length(species_list),
    species = species_list,
    results = results
  )
}

handle_model_logs <- function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }

  read_safe <- function(path, max_lines = 500) {
    if (!file.exists(path)) return("")
    tryCatch({
      lines <- readLines(path, warn = FALSE)
      if (length(lines) > max_lines) {
        lines <- tail(lines, max_lines)
      }
      paste(lines, collapse = "\n")
    }, error = function(e) "")
  }

  list(
    id = job_id,
    stderr = read_safe(file.path(job_dir, "stderr.log")),
    stdout = read_safe(file.path(job_dir, "stdout.log")),
    progress_log = read_safe(file.path(job_dir, "progress.log"))
  )
}

handle_model_status <- function(res, job_id) {
  job_dir <- tryCatch(sdm_safe_job_dir(job_id), error = function(e) { NULL })
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")
  progress_json_file <- file.path(job_dir, "progress.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      res$status <- 500L
      return(list(error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)

  if (identical(meta$status, "running")) {
    entry <- sdm_process_registry[[job_id]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({
        process_alive <- proc$is_alive()
      }, error = function(e) {
        process_alive <<- FALSE
      })
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) {
          process_alive <<- FALSE
        })
      }
    }
    if (process_alive || is.null(proc)) {
      heartbeat_file <- file.path(job_dir, "heartbeat.log")
      if (file.exists(heartbeat_file)) {
        last_line <- tryCatch(tail(readLines(heartbeat_file, warn = FALSE), 1), error = function(e) NULL)
        if (!is.null(last_line) && length(last_line) > 0 && nchar(last_line) > 0) {
          hb_ts <- tryCatch(as.POSIXct(sub("\\|.*", "", last_line), format = "%Y-%m-%dT%H:%M:%S"), error = function(e) NULL)
          if (!is.null(hb_ts) && !is.na(hb_ts)) {
            # Accelerator runs have a shorter heartbeat timeout.
            dnn_device <- as.character(meta$config$dnn_device %||% meta$config$python_device %||% "")
            is_gpu <- sdm_backend_is_gpu(sdm_resolve_backend(dnn_device)$backend)
            hb_timeout <- if (is_gpu) 300 else 1800
            if (difftime(Sys.time(), hb_ts, units = "secs") > hb_timeout) {
              process_alive <- FALSE
            }
          }
        }
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed (OOM, segfault, or external signal)"
      meta$error_code <- "PROCESS_CRASH"
      meta$error_hint <- "The R process was terminated by the OS. Check system memory, reduce raster resolution, or run with fewer covariates."
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
      # Keep the job directory so subsequent status polls can read diagnostics.
    }
  }

  if (identical(meta$status, "loading")) {
    entry <- sdm_process_registry[[job_id]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) NULL)
      }
    }
    if (is.null(proc) || !process_alive) {
      heartbeat_file <- file.path(job_dir, "heartbeat.log")
      if (file.exists(heartbeat_file)) {
        last_line <- tryCatch(tail(readLines(heartbeat_file, warn = FALSE), 1), error = function(e) NULL)
        if (!is.null(last_line) && length(last_line) > 0 && nchar(last_line) > 0) {
          hb_ts <- tryCatch(as.POSIXct(sub("\\|.*", "", last_line), format = "%Y-%m-%dT%H:%M:%S"), error = function(e) NULL)
          if (!is.null(hb_ts) && !is.na(hb_ts)) {
            if (difftime(Sys.time(), hb_ts, units = "secs") > 90) {
              process_alive <- FALSE
            }
          }
        }
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died while loading modules: ", stderr_content)
      } else {
        meta$error <- "R process died while loading modules \u2014 no stderr output available"
      }
      meta$error_code <- "RUNNER_LOAD_FAILED"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
      # Keep the job directory so subsequent status polls can read diagnostics.
    }
  }

  if (identical(meta$status, "pending")) {
    entry <- sdm_process_registry[[job_id]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died: ", stderr_content)
      } else {
        meta$error <- "R process died before loading modules \u2014 no stderr output available"
      }
      meta$error_code <- "RUNNER_START_FAILED"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
      # Keep the job directory so subsequent status polls can read diagnostics.
    }
  }

  if (identical(meta$status, "running") && sdm_redis_cancel_check(job_id)) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    # Re-read: background process may have written "completed" in the race window
    Sys.sleep(1)
    meta2 <- tryCatch(jsonlite::fromJSON(meta_file, simplifyVector = FALSE), error = function(e) list())
    if (identical(meta2$status, "completed")) {
      meta <- meta2
      # Preserve the process's authoritative status — don't clear Redis keys
    } else {
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  if (identical(meta$status, "completed") || identical(meta$status, "failed") || identical(meta$status, "cancelled")) {
    sdm_process_registry[[job_id]] <- NULL
    sdm_redis_progress_clear(job_id)
    sdm_redis_cancel_clear(job_id)
  }

  progress_lines <- character(0)
  last_stage <- NULL
  if (file.exists(progress_file)) {
    progress_lines <- tail(readLines(progress_file, warn = FALSE), 200)
    for (line in rev(progress_lines)) {
      stage <- gsub("^\\d{2}:\\d{2}:\\d{2}\\s*(\\[\\d+%\\]\\s*)?", "", line)
      stage <- trimws(stage)
      if (nchar(stage) >= 3) {
        last_stage <- stage
        break
      }
    }
  }

  progress_json <- NULL
  if (file.exists(progress_json_file)) {
    progress_json <- tryCatch({
      lines <- readLines(progress_json_file, warn = FALSE)
      entries <- lapply(lines[nzchar(lines)], function(l) jsonlite::fromJSON(l, simplifyVector = FALSE))
      if (length(entries) > 0) entries else NULL
    }, error = function(e) NULL)
  }

  result <- list(
    id = meta$id,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    metrics = meta$metrics %||% NULL,
    output_files = meta$output_files %||% NULL,
    progress_log = progress_lines,
    last_stage = last_stage,
    progress_json = progress_json
  )
  if (identical(Sys.getenv("PLUMBER_AUTH_DISABLED"), "true") && !is.null(meta$error_traceback)) {
    result$error_traceback <- meta$error_traceback
  }
  result
}

handle_model_cancel <- function(req, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    return(list(ok = FALSE, message = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this run"))
      }
    }
  }

  entry <- sdm_process_registry[[job_id]]
  proc <- sdm_registry_proc(entry)
  killed <- FALSE

  if (!is.null(proc) && inherits(proc, "Process")) {
    if (proc$is_alive()) {
      proc$kill()
      killed <- TRUE
      # Wait briefly for process to die, then escalate to SIGKILL if still alive
      Sys.sleep(3)
      if (proc$is_alive()) {
        pid <- proc$get_pid()
        tryCatch(tools::pskill(pid, signal = 9), error = function(e) NULL)
        Sys.sleep(2)
      }
    }
    device_tag <- if (is.list(entry)) entry$device else "cpu"
    # Give any discrete GPU backend time to release VRAM after termination.
    if (killed && sdm_backend_is_discrete_gpu(device_tag)) {
      Sys.sleep(2)
    }
    rm(list = job_id, envir = sdm_process_registry)
  }

  progress_log <- file.path(job_dir, "progress.log")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

    if (!killed && !is.null(meta$process_pid)) {
      tryCatch({
        tools::pskill(meta$process_pid, signal = 9)
        killed <- TRUE
      }, error = function(e) NULL)
    }

    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
    sdm_redis_cancel_set(job_id)
  }

  if (killed) {
    log_line <- paste0(format(Sys.time(), "%H:%M:%S"), " [CANCELLED] Process killed for job ", job_id)
    cat(log_line, "\n")
    if (file.exists(progress_log)) {
      cat(log_line, "\n", file = progress_log, append = TRUE)
    }
  }

  list(ok = TRUE, message = if (killed) "Run cancelled and process terminated" else "Run cancelled (process not found)")
}

handle_model_delete <- function(req, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    return(list(ok = TRUE, message = "Invalid job ID", deleted = FALSE))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to delete this run"))
      }
    }
  }

  if (!dir.exists(job_dir)) {
    return(list(ok = TRUE, message = "Run directory not found (already deleted)", deleted = FALSE))
  }

  tryCatch({
    unlink(job_dir, recursive = TRUE, force = TRUE)
    list(ok = TRUE, message = "Run output files deleted", deleted = TRUE)
  }, error = function(e) {
    list(ok = FALSE, message = paste("Failed to delete:", conditionMessage(e)), deleted = FALSE)
  })
}

handle_models_runs <- function(req, app_dir) {
  jobs_dir <- file.path(app_dir, "outputs", "jobs")
  if (!dir.exists(jobs_dir)) return(list())

  job_dirs <- list.dirs(jobs_dir, recursive = FALSE, full.names = FALSE)
  runs <- lapply(job_dirs, function(jd) {
    meta_file <- file.path(jobs_dir, jd, "meta.json")
    if (file.exists(meta_file)) {
      meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

      if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) {
        if (is.null(meta$user_id) || as.character(meta$user_id) != as.character(req$user_id)) {
          return(NULL)
        }
      }

      list(
        id = meta$id,
        species = meta$config$species,
        model_id = meta$config$model_id,
        status = meta$status,
        started_at = meta$started_at,
        completed_at = meta$completed_at %||% NULL,
        metrics = meta$metrics %||% NULL,
        r_cpu_time_ms = meta$r_cpu_time_ms %||% NULL,
        r_peak_memory_mb = meta$r_peak_memory_mb %||% NULL
      )
    } else NULL
  })
  Filter(Negate(is.null), runs)
}

sdm_submit_async_job <- function(req, app_dir, job_type, params, user_id = "anonymous") {
  tryCatch({
    job_id <- paste0("data-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
    job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
    dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

    meta <- list(
      id = job_id,
      user_id = user_id,
      type = job_type,
      status = "running",
      started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      params = params
    )
    sdm_write_json(meta, file.path(job_dir, "meta.json"))

    input <- params
    input$type <- job_type
    input <- input[!sapply(input, is.null)]
    writeLines(jsonlite::toJSON(input, auto_unbox = TRUE, pretty = TRUE), file.path(job_dir, "input.json"))

    dispatcher_path <- file.path(app_dir, "plumber", "R", "async_dispatcher.R")
    proc <- processx::process$new(
      "Rscript",
      c("--no-save", "--no-restore", "--no-init-file", dispatcher_path, app_dir, job_dir),
      stdout = file.path(job_dir, "stdout.log"),
      stderr = file.path(job_dir, "stderr.log"),
      env = c(
        HOME = "/app",
        PATH = Sys.getenv("PATH"),
        LD_LIBRARY_PATH = Sys.getenv("LD_LIBRARY_PATH"),
        R_HOME = Sys.getenv("R_HOME"),
        R_LIBS_USER = Sys.getenv("R_LIBS_USER"),
        OMP_THREAD_LIMIT = as.character(getOption("sdm.omp_thread_limit", "1")),
        R_MAX_VSIZE = sdm_detect_vsize(),
        PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True,max_split_size_mb:512",
        CUBLAS_WORKSPACE_CONFIG = ":4096:8"
      )
    )

    sdm_process_registry[[job_id]] <- list(proc = proc, device = "cpu")
    meta$process_pid <- proc$get_pid()
    sdm_write_json(meta, file.path(job_dir, "meta.json"))

    job_id
  }, error = function(e) {
    cat(sprintf("[sdm_submit_async_job] ERROR: %s\n", conditionMessage(e)), stderr())
    NULL
  })
}

handle_async_status <- function(res, job_id, app_dir) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  result_file <- file.path(job_dir, "result.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    if (!is.null(res)) tryCatch(res$status <- 404L, error = function(e) NULL)
    return(list(available = FALSE, error = "Job not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      if (!is.null(res)) tryCatch(res$status <- 503L, error = function(ee) NULL)
      return(list(available = FALSE, error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$available) && identical(meta$available, FALSE)) {
    return(meta)
  }
  result <- NULL
  result_read_error <- NULL
  if (file.exists(result_file)) {
    result <- tryCatch(
      jsonlite::fromJSON(result_file, simplifyVector = FALSE),
      error = function(e) {
        result_read_error <<- conditionMessage(e)
        NULL
      }
    )
  }

  if (identical(meta$status, "cancelled")) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "cancelled", error = meta$error %||% "Cancelled by user",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }
  if (identical(meta$status, "completed") && is.null(result)) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "completed",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }
  if (identical(meta$status, "failed") && is.null(result)) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "failed", error = meta$error %||% "Unknown error",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }

  if (identical(meta$status, "running") && is.null(result)) {
    entry <- sdm_process_registry[[basename(job_id)]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          ps_info <- tools::ps()
          process_alive <- pid %in% ps_info$PID
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- if (!is.null(result_read_error)) {
        paste0("Process exited with an unreadable result: ", result_read_error)
      } else {
        "Process crashed or was killed (OOM, segfault, or external signal)"
      }
      meta$error_code <- "PROCESS_CRASH"
      meta$error_hint <- "The R process was terminated by the OS. Check system memory, reduce raster resolution, or run with fewer covariates."
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = meta$error,
                  error_code = meta$error_code, error_hint = meta$error_hint))
    }
  }

  if (identical(meta$status, "loading")) {
    entry <- sdm_process_registry[[basename(job_id)]]
    proc <- sdm_registry_proc(entry)
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          ps_info <- tools::ps()
          process_alive <- pid %in% ps_info$PID
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died while loading modules: ", stderr_content)
      } else {
        meta$error <- "R process died while loading modules \u2014 no stderr output available"
      }
      meta$error_code <- "RUNNER_LOAD_FAILED"
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = meta$error,
                  error_code = "RUNNER_LOAD_FAILED", error_hint = "The R process was killed while loading SDM modules. Check container memory limits, reduce covariates, or increase memory allocation."))
    }
  }

  if (identical(meta$status, "running") && is.null(result) && sdm_redis_cancel_check(basename(job_id))) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "cancelled", error = "Cancelled by user",
                error_code = NULL, error_hint = NULL))
  }

  error_code <- meta$error_code %||% NULL
  error_hint <- meta$error_hint %||% NULL

  if (!is.null(result)) {
    if (identical(result$status, "completed")) {
      sdm_process_registry[[basename(job_id)]] <- NULL
      meta$status <- "completed"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      meta$result <- result$result
      sdm_write_json(meta, meta_file)
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "completed", result = result$result, error_code = error_code, error_hint = error_hint))
    } else if (identical(result$status, "failed")) {
      sdm_process_registry[[basename(job_id)]] <- NULL
      meta$status <- "failed"
      meta$error <- result$error
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = result$error, error_code = error_code, error_hint = error_hint))
    }
  }

  if (identical(meta$status, "loading")) {
    return(list(available = TRUE, status = "loading", progress_log = character(0),
                error_code = NULL, error_hint = NULL))
  }

  redis_progress <- sdm_redis_progress_get(basename(job_id), 20)
  if (!is.null(redis_progress) && length(redis_progress) > 0) {
    progress_lines <- redis_progress
  } else {
    progress_lines <- character(0)
    if (file.exists(progress_file)) {
      progress_lines <- tail(readLines(progress_file, warn = FALSE), 20)
    }
  }

  list(available = TRUE, status = "running", progress_log = progress_lines, error_code = error_code, error_hint = error_hint)
}
