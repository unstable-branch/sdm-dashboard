# Parallel batch SDM runner using future/future.apply.
#
# Design:
#   - Wraps run_fast_sdm() directly — all 40+ parameters overridable per-species.
#   - Parses a list of species configs (each a named list) into run_fast_sdm() calls.
#   - Uses future::plan(multisession) for cross-platform-safe parallelism.
#   - Each species run is independent — no shared state, minimal serialization overhead.
#   - Per-species results saved to disk as {slug}_{timestamp}.rds.
#   - Errors in one species are logged and return NULL; they do not stop the batch.
#
# CSV format (species_configs as data.frame rows):
#   species,occurrences_csv,model_id,biovars,use_elevation,elevation_demtype,
#   use_soil,soil_vars,soil_depths,use_uv,uv_vars,use_vegetation,veg_year,
#   veg_products,use_lulc,lulc_year,use_hfp,hfp_year,use_bioclim_season,
#   use_drought,drought_periods,worldclim_dir,projection_extent,background_n,
#   include_quadratic,threshold,cv_folds,aggregation_factor,vif_reduction,
#   bias_method,future_projection,future_worldclim_dir,seed
#
# Comma-separated list columns (biovars, soil_vars, etc.) are parsed automatically.

# Atomic write helper (available if bootstrap.R was sourced; otherwise define inline)
if (!exists("sdm_atomic_saveRDS", mode = "function")) {
  sdm_safe_rename <- function(from, to) {
    if (file.exists(to)) unlink(to, force = TRUE)
    if (!file.rename(from, to)) {
      file.copy(from, to, overwrite = TRUE)
      unlink(from, force = TRUE)
    }
    invisible(TRUE)
  }
  sdm_atomic_saveRDS <- function(object, path) {
    tmp <- paste0(path, ".tmp.", Sys.getpid(), ".", as.integer(Sys.time()))
    saveRDS(object, tmp)
    sdm_safe_rename(tmp, path)
    invisible(NULL)
  }
}

#' Parse a comma-separated string of integers.
#' @param x character vector, possibly with whitespace around values.
#' @return integer vector, or integer(0) if empty/NA.
parse_comma_ints <- function(x) {
  if (is.null(x) || is.na(x) || !nzchar(trimws(x))) {
    return(integer(0))
  }
  as.integer(unlist(strsplit(trimws(x), "\\s*,\\s*")))
}

#' Parse a comma-separated string of non-integer values (soil vars, veg products, etc.).
#' @param x character vector.
#' @return character vector, or character(0) if empty/NA.
parse_comma_strings <- function(x) {
  if (is.null(x) || is.na(x) || !nzchar(trimws(x))) {
    return(character(0))
  }
  trimws(unlist(strsplit(trimws(x), ",\\s*")))
}

#' Parse a comma-separated string of doubles.
#' @param x character vector, possibly with whitespace around values.
#' @return numeric vector, or numeric(0) if empty/NA.
parse_comma_doubles <- function(x) {
  if (is.null(x) || is.na(x) || !nzchar(trimws(x))) {
    return(numeric(0))
  }
  suppressWarnings(as.numeric(unlist(strsplit(trimws(x), "\\s*,\\s*"))))
}

#' Parse a logical value from a string ("TRUE", "FALSE", "true", "false", "1", "0").
#' @param x character or logical.
#' @return logical.
parse_logical <- function(x) {
  if (is.null(x) || is.na(x)) {
    return(FALSE)
  }
  if (is.logical(x)) {
    return(x)
  }
  x <- trimws(as.character(x))
  if (x == "") {
    return(FALSE)
  }
  tolower(x) %in% c("true", "1", "yes", "on")
}

#' Build a run_fast_sdm argument list from a config row (named list or data.frame row).
#' Only fields present in the config row are included in the returned list;
#' run_fast_sdm applies its own defaults for any missing parameters.
#' @param row named list with config fields (CSV column names as keys).
#' @return named list ready for do.call(run_fast_sdm, ...).
build_run_args <- function(row) {
  args <- list()

  # Pass through all snake_case params that match sdm_config parameter names
  row_names <- names(row)
  list_param_map <- c(
    biovars = "selected_biovars",
    soil_vars = "selected_soil_vars",
    soil_depths = "selected_soil_depths",
    uv_vars = "selected_uv_vars",
    drought_periods = "selected_drought_periods",
    multi_ensemble_models = "multi_ensemble_models",
    biomod2_models = "biomod2_models",
    veg_products = "veg_products",
    hidden_layers = "hidden_layers"
  )
  integer_params <- c("background_n", "cv_folds", "aggregation_factor", "seed",
    "worldclim_res", "veg_year", "lulc_year", "hfp_year",
    "n_cores", "pa_replicates", "min_source_records", "thickening_distance_km",
    "dnn_n_seeds", "dnn_multispecies_n_seeds", "dnn_mc_samples",
    "brt_n_trees", "brt_interaction_depth", "cta_maxdepth", "cta_minsplit",
    "mars_degree", "mars_nk", "fda_degree", "fda_nprune",
    "ann_size", "ann_maxit", "ann_rang",
    "rf_num_trees", "rf_mtry", "rf_min_node_size",
    "xgb_max_depth", "n_estimators", "max_depth", "max_iterations",
    "epochs", "batch_size", "predict_batch_size", "early_stopping_patience",
    "bart_ntree", "bart_ndpost", "bart_nskip",
    "brms_chains", "brms_iter", "brms_warmup", "gam_k",
    "multi_ensemble_power",
    "rangebag_n_bags", "rangebag_vars_per_bag",
    "esm_n_runs", "esm_split", "esm_power", "vif_threshold")
  scalar_param_map <- c(
    occurrences_csv = "occurrence_file"
  )

  for (p in row_names) {
    val <- row[[p]]
    if (is.null(val) || length(val) == 0 || (!is.character(val) && !is.numeric(val))) next
    if (is.character(val) && !nzchar(val)) next

    if (p %in% names(scalar_param_map)) {
      args[[scalar_param_map[[p]]]] <- val
      next
    }

    if (p == "species_filter") {
      args$species_filter <- val
      next
    }

    # Special handling for known comma-separated list columns
    if (p %in% names(list_param_map)) {
      arg_name <- list_param_map[[p]]
      args[[arg_name]] <- parse_comma_strings(val)
      if (p %in% c("biovars", "hidden_layers")) args[[arg_name]] <- parse_comma_ints(val)
      next
    }

    # Special handling for comma-separated numeric lists
    if (p %in% c("projection_extent", "training_extent")) {
      args[[p]] <- parse_comma_doubles(val)
      next
    }

    # Special handling for logical columns
    if (p %in% c("include_quadratic", "use_elevation", "use_soil", "use_uv",
                  "use_vegetation", "use_lulc", "use_hfp", "use_bioclim_season",
                  "use_drought", "vif_reduction", "future_projection",
                  "merge_small_sources", "thin_by_cell", "extrapolation_mask",
                  "generate_tiles", "generate_cog",
                  "climate_matching", "restrict_background",
                  "multi_ensemble_export", "multi_ensemble_uncertainty",
                  "maxnet_auto_tune")) {
      args[[p]] <- parse_logical(as.character(val))
      next
    }

    # String enum parameters (tuning method, algorithm selection)
    if (p %in% c("tuning_method", "enmeval_algorithm", "enmeval_partitions",
                 "enmeval_selection_metric", "enmeval_null_iterations")) {
      args[[p]] <- as.character(val)
      next
    }

    if (p %in% integer_params) {
      args[[p]] <- as.integer(val)
      next
    }

    # Default: pass value through as-is (sdm_config handles type coercion)
    val_num <- suppressWarnings(as.numeric(val))
    args[[p]] <- if (is.na(val_num)) val else val_num
  }

  # Let sdm_config() set defaults for any missing params (use_cc, log_fun, etc.)
  args
}

#' Convert a CSV config row to an sdm_config object.
#' Reuses parse_* helpers and the same column names as build_run_args().
#' @param row named list with config fields (CSV column names as keys).
#' @param seed integer random seed.
#' @return sdm_config object.
build_config_from_row <- function(row, seed = 42L) {
  args <- build_run_args(row)
  args$seed <- seed %||% 42L
  do.call(sdm_config, args)
}

#' Run a multi-species batch using the targets pipeline.
#' Reads the CSV, triggers _targets.R branching via env vars.
#' @param config_csv path to batch config CSV.
#' @param output_dir output directory.
#' @param workers number of parallel workers (NULL = auto).
#' @param seed random seed.
batch_run_targets <- function(config_csv, output_dir = "batch_results/",
                               workers = NULL, seed = 42L) {
  if (!requireNamespace("targets", quietly = TRUE)) {
    stop("targets package required. Install with: install.packages('targets')", call. = FALSE)
  }

  config_csv <- normalizePath(config_csv, mustWork = TRUE)
  out_dir <- normalizePath(output_dir, mustWork = FALSE)
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

  targets_store <- file.path(out_dir, "_targets")
  Sys.setenv(SDM_BATCH_CONFIG = config_csv)
  Sys.setenv(SDM_BATCH_OUTPUT = out_dir)
  Sys.setenv(SDM_TARGETS_STORE = targets_store)
  if (!is.null(workers)) Sys.setenv(SDM_CLUSTER_WORKERS = as.character(workers))
  if (!is.na(seed)) Sys.setenv(SDM_BATCH_SEED = as.character(seed))

  message("[targets] Running batch pipeline from: ", config_csv)
  message("[targets] Output directory: ", out_dir)

  targets::tar_make(
    store = targets_store
  )
}

#' Build a crew controller for distributed computing.
#' @param backend character: "local", "slurm", "sge", "pbs", "aws".
#' @param workers integer: number of workers.
#' @param ... additional arguments passed to the crew controller constructor.
#' @return a crew controller object, or NULL if crew is unavailable.
build_crew_controller <- function(backend = "local", workers = NULL, ...) {
  if (!requireNamespace("crew", quietly = TRUE)) {
    return(NULL)
  }
  n <- workers %||% max(1, parallel::detectCores() - 1, na.rm = TRUE)
  switch(backend,
    local = crew::crew_controller_local(workers = n, ...),
    slurm = {
      if (!requireNamespace("crew.cluster", quietly = TRUE)) {
        warning("crew.cluster not installed; falling back to local")
        return(crew::crew_controller_local(workers = n, ...))
      }
      crew.cluster::crew_controller_slurm(workers = n, ...)
    },
    sge = {
      if (!requireNamespace("crew.cluster", quietly = TRUE)) return(NULL)
      crew.cluster::crew_controller_sge(workers = n, ...)
    },
    pbs = {
      if (!requireNamespace("crew.cluster", quietly = TRUE)) return(NULL)
      crew.cluster::crew_controller_pbs(workers = n, ...)
    },
    aws = {
      if (!requireNamespace("crew.aws.batch", quietly = TRUE)) return(NULL)
      crew.aws.batch::crew_controller_aws_batch(workers = n, ...)
    },
    {
      warning("Unknown cluster backend: ", backend, "; using local")
      crew::crew_controller_local(workers = n, ...)
    }
  )
}

if (!exists("normalize_core_count", envir = globalenv())) {
  normalize_core_count <- function(n_cores = NULL, reserve_one = FALSE) {
    if (is.null(n_cores)) {
      n <- parallel::detectCores()
      if (is.na(n)) n <- 2L
      if (reserve_one) n <- max(1, n - 1)
      return(as.integer(n))
    }
    n <- as.integer(n_cores[1])
    if (is.na(n) || n < 1) n <- 1
    n
  }
}

write_batch_summary_csv <- function(results, output_dir) {
  summary_rows <- lapply(results, function(r) {
    if (is.null(r)) {
      data.frame(
        species = NA_character_,
        status = "error",
        model_id = NA_character_,
        auc_mean = NA_real_,
        tss_mean = NA_real_,
        cbi = NA_real_,
        high_suit_area_km2 = NA_real_,
        eoo_km2 = NA_real_,
        aoo_km2 = NA_real_,
        threshold = NA_real_,
        cv_strategy = NA_character_,
        elapsed_seconds = NA_real_,
        stringsAsFactors = FALSE
      )
    } else {
      sp <- r$config$species %||% NA_character_
      mid <- r$config$model_id %||% r$model_info$id %||% NA_character_
      auc <- tryCatch(r$cv$auc_mean %||% NA_real_, error = function(e) NA_real_)
      tss <- tryCatch(r$cv$tss_mean %||% NA_real_, error = function(e) NA_real_)
      cbi_val <- tryCatch(r$metrics$cbi %||% NA_real_, error = function(e) NA_real_)
      area <- tryCatch(r$summary$high_risk_area_km2 %||% NA_real_, error = function(e) NA_real_)
      eoo <- tryCatch(r$eoo_aoo$eoo_km2 %||% NA_real_, error = function(e) NA_real_)
      aoo <- tryCatch(r$eoo_aoo$aoo_km2 %||% NA_real_, error = function(e) NA_real_)
      thresh <- r$config$threshold %||% NA_real_
      cv_strat <- r$cv$strategy %||% NA_character_
      elapsed <- tryCatch(r$metrics$elapsed_seconds %||% NA_real_, error = function(e) NA_real_)
      data.frame(
        species = sp,
        status = "success",
        model_id = mid,
        auc_mean = auc,
        tss_mean = tss,
        cbi = cbi_val,
        high_suit_area_km2 = area,
        eoo_km2 = eoo,
        aoo_km2 = aoo,
        threshold = thresh,
        cv_strategy = cv_strat,
        elapsed_seconds = elapsed,
        stringsAsFactors = FALSE
      )
    }
  })
  df <- data.table::rbindlist(summary_rows)
  out_path <- file.path(output_dir, "batch_summary.csv")
  write.csv(df, out_path, row.names = FALSE)
  message("[batch] Wrote summary: ", out_path)
}

#' Run multiple species SDM models in parallel.
#'
#' @param species_configs list of named lists, each containing per-species configuration.
#'        Required fields per entry: \code{species} and \code{occurrences_csv}.
#'        All other run_fast_sdm parameters can be set per-entry; defaults used if missing.
#' @param n_cores integer; number of parallel workers. \code{NULL} auto-detects via
#'        \code{normalize_core_count()} (defaults to detectCores() - 1).
#' @param output_dir character; directory for per-species .rds output files.
#'        Created if it does not exist. Default: "batch_results/".
#' @param progress_fun function(amount, detail); called for each progress step.
#'        Default NULL suppresses sub-progress in parallel workers.
#' @param seed integer for reproducibility (passed to \code{future.seed} on
#'        \code{future_lapply}). Default 42L.
#'
#' @return invisibly a list of result objects (one per species). Each element is
#'         the return value of \code{run_fast_sdm()}, or \code{NULL} if that species
#'         errored. Results are also saved individually to \file{{species_slug}.rds}
#'         in \code{output_dir}.
#'
#' @examples
#' configs <- list(
#'   list(
#'     species = "Acacia mearnsii",
#'     occurrences_csv = "data/acacia.csv",
#'     model_id = "glm",
#'     biovars = "1,4,6,12,15,18"
#'   ),
#'   list(
#'     species = "Opuntia stricta",
#'     occurrences_csv = "data/opuntia.csv",
#'     model_id = "glm",
#'     biovars = "1,4,6,12,15,18"
#'   )
#' )
#' batch_run_parallel(configs, n_cores = 2, output_dir = "results/")
batch_run_parallel <- function(species_configs,
                               n_cores = NULL,
                               output_dir = "batch_results/",
                               progress_fun = NULL,
                               seed = 42L) {
  .Deprecated("batch_run_targets",
    msg = "batch_run_parallel() is legacy Shiny-only. Use batch_run_targets() (targets pipeline) for production multi-species runs — it provides caching, incremental rebuild, HPC/cluster support, and auto-resume on crash.")
  if (!is.list(species_configs) || length(species_configs) == 0) {
    stop("species_configs must be a non-empty list", call. = FALSE)
  }

  n_cores <- normalize_core_count(n_cores, reserve_one = is.null(n_cores))
  if (n_cores < 1) {
    warning("n_cores < 1; forcing to 1 (serial execution)")
    n_cores <- 1
  }

  # Memory-aware worker cap: prevent OOM when many cores but limited RAM
  if (requireNamespace("terra", quietly = TRUE)) {
    tryCatch({
      mem_info <- terra::mem_info()
      if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
        per_worker_gb <- 2.0
        max_by_mem <- max(1L, floor(mem_info$memavail / per_worker_gb))
        if (n_cores > max_by_mem) {
          message(sprintf("[batch] Memory-aware worker cap: reducing from %d to %d (%.1f GB available, ~%.1f GB per worker)",
            n_cores, max_by_mem, mem_info$memavail, per_worker_gb))
          n_cores <- max_by_mem
        }
      }
    }, error = function(e) NULL)
  }

  dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

  if (n_cores == 1) {
    future::plan(future::sequential)
    message("[batch] Using sequential execution (n_cores = 1)")
  } else {
    future::plan(future::multisession, workers = n_cores)
    message("[batch] Using parallel execution with ", n_cores, " workers")
  }

  p <- function(...) {
    msg <- paste(..., collapse = "")
    message(msg)
    if (is.function(progress_fun)) progress_fun(msg)
  }

  p("[batch] Starting batch run: ", length(species_configs), " species")

  results <- future.apply::future_lapply(
    seq_along(species_configs),
    FUN = function(i) {
      cfg <- species_configs[[i]]
      sp_name <- cfg$species %||% "unknown_species"
      slug <- safe_slug(sp_name)

      tryCatch(
        {
          call_args <- build_run_args(cfg)
          call_args$output_dir <- output_dir

          message("[", i, "/", length(species_configs), "] Starting: ", sp_name)
          result <- do.call(run_fast_sdm, call_args)

          output_path <- file.path(output_dir, paste0(slug, "_result.rds"))
          sdm_atomic_saveRDS(result, output_path)
          message(
            "[", i, "/", length(species_configs), "] Done: ", sp_name,
            " -> ", basename(output_path)
          )

          result
        },
        error = function(e) {
          err_path <- file.path(output_dir, paste0(slug, "_ERROR.log"))
          writeLines(c(
            format(Sys.time()),
            paste0("Species: ", sp_name),
            paste0("Error: ", conditionMessage(e)),
            paste0("Call: ", conditionCall(e), collapse = "\n")
          ), con = err_path)
          message(
            "[", i, "/", length(species_configs), "] ERROR: ", sp_name,
            " — see ", err_path
          )
          NULL
        }
      )
    },
    future.seed = seed
  )

  future::plan(future::sequential, .skip = TRUE)

  n_success <- sum(!sapply(results, is.null))
  n_error <- length(results) - n_success
  p("\n=== BATCH COMPLETE ===")
  p("Successful: ", n_success, " / ", length(results))
  if (n_error > 0) {
    p("Errors (see *_ERROR.log): ", n_error)
  }

  write_batch_summary_csv(results, output_dir)

  invisible(results)
}

#' Parse a batch config CSV into a list of species configs.
#'
#' @param config_csv path to CSV file with one row per species.
#' @return list of named lists, one per row, suitable for \code{batch_run_parallel()}.
#'
#' @examples
#' configs <- parse_batch_config("species_batch.csv")
#' batch_run_parallel(configs, n_cores = 4)
parse_batch_config <- function(config_csv) {
  if (!file.exists(config_csv)) {
    stop("Batch config CSV not found: ", config_csv, call. = FALSE)
  }
  df <- tryCatch({
    read.csv(config_csv,
      stringsAsFactors = FALSE, header = TRUE,
      check.names = FALSE
    )
  }, error = function(e) {
    stop("Failed to read batch config CSV: ", conditionMessage(e), call. = FALSE)
  })
  if (nrow(df) == 0) {
    stop("Batch config CSV is empty: ", config_csv, call. = FALSE)
  }

  lapply(seq_len(nrow(df)), function(i) {
    as.list(df[i, ])
  })
}
