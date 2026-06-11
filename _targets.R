# SDM Dashboard — targets pipeline
# Run: tar_make()
# Inspect: tar_visnetwork()
# Read outputs: tar_read(target_name)
#
# For multi-species batch runs, set SDM_BATCH_CONFIG env var:
#   SDM_BATCH_CONFIG=batch_config.csv tar_make()
# Or use: Rscript scripts/batch_run.R --config batch_config.csv --targets
#
# Pre-requisites:
#   install.packages(c("targets", "tarchetypes", "geotargets"))

library(targets)
library(tarchetypes)
library(geotargets)

# ── Cache mode ──────────────────────────────────────────────────────────────
#   minimal:    ~0.5 GB per 10 species — re-computes env on crash
#   standard:   ~2 GB per 10 species — full caching (default)
#   persistent: ~3 GB per 10 species — full caching + history
cache_mode <- Sys.getenv("SDM_TARGETS_CACHE", "standard")

# ── Cluster backend (crew) ──────────────────────────────────────────────────
# Set SDM_CLUSTER_BACKEND=slurm (or sge, pbs, aws) for distributed workers.
# For GPU models (dnn, dnn_multispecies), crew_workers is forced to 1 to prevent OOM.
cluster_backend <- Sys.getenv("SDM_CLUSTER_BACKEND", "local")
cluster_workers <- as.integer(Sys.getenv("SDM_CLUSTER_WORKERS",
  max(1, parallel::detectCores() / 2)))

# Detect GPU models in batch config to force single-worker mode
batch_config_path <- Sys.getenv("SDM_BATCH_CONFIG", "")
has_gpu_targets <- FALSE
if (nzchar(batch_config_path) && file.exists(batch_config_path)) {
  gpu_models <- c("dnn", "dnn_multispecies")
  tryCatch({
    csv_rows <- read.csv(batch_config_path, stringsAsFactors = FALSE)
    if ("model_id" %in% names(csv_rows)) {
      has_gpu_targets <- any(csv_rows$model_id %in% gpu_models, na.rm = TRUE)
    }
  }, error = function(e) NULL)
}

if (requireNamespace("crew", quietly = TRUE)) {
  if (cluster_backend != "local") {
    controller <- build_crew_controller(cluster_backend, workers = cluster_workers)
    if (!is.null(controller)) {
      tar_option_set(controller = controller)
      message("[targets] Using ", cluster_backend, " cluster with ", cluster_workers, " workers")
    }
  } else {
    auto_workers <- max(1L, floor(parallel::detectCores() / 2), na.rm = TRUE)
    user_workers <- as.integer(Sys.getenv("SDM_CREW_WORKERS",
      Sys.getenv("SDM_CLUSTER_WORKERS", as.character(min(auto_workers, 8L)))))
    # Force single worker for GPU models or if explicitly set
    if (has_gpu_targets && user_workers > 1) {
      message("[targets] GPU model(s) detected — forcing crew_workers=1 to prevent OOM")
      crew_workers <- 1L
    } else {
      crew_workers <- user_workers
    }
    controller <- crew::crew_controller_local(workers = crew_workers)
    tar_option_set(controller = controller)
    message("[targets] Using local crew controller with ", crew_workers, " worker(s)")
  }
}

store_path <- Sys.getenv("SDM_TARGETS_STORE", file.path("outputs", "_targets"))

tar_option_set(
  store = store_path,
  memory = if (cache_mode == "minimal") "transient" else "persistent",
  garbage_collection = cache_mode != "persistent",
  storage = if (cache_mode == "minimal") "worker" else "main",
  retrieval = if (cache_mode == "minimal") "worker" else "main",
  packages = c("terra", "sf"),
  error = "continue",
  workspace_on_error = "all"
)

# ── Load SDM engine ─────────────────────────────────────────────────────────
source(file.path("R", "core", "bootstrap.R"))
if (is.null(sdm_project_root())) sdm_set_project_root(getwd())
source(file.path("R", "engine_load.R"))

# ── Load pipeline helper functions ──────────────────────────────────────────
tar_source("R/pipeline/")

# ── Multi-species mode switch ───────────────────────────────────────────────
# When SDM_MULTISPECIES=true and model_id = "dnn_multispecies" (or gllvm),
# delegate to a joint pipeline that fits all species in a single model.
multispecies_mode <- identical(Sys.getenv("SDM_MULTISPECIES"), "true")
if (multispecies_mode) {
  source("_targets_multispecies.R", local = TRUE)
} else {

# ── Batch configuration ─────────────────────────────────────────────────────
batch_output_dir <- Sys.getenv("SDM_BATCH_OUTPUT", "outputs")
batch_seed <- as.integer(Sys.getenv("SDM_BATCH_SEED", "42"))

# Fallback single-species config (used when SDM_BATCH_CONFIG is empty)
fallback_species <- "Test species"
fallback_csv <- "data/examples/synthetic_presence_data.csv"
fallback_biovars <- c(1, 4, 6, 12, 15, 18)
fallback_extent <- c(112, 154, -44, -10)
fallback_cv_folds <- 5L
fallback_background_n <- 500L
fallback_species_filter <- Sys.getenv("SDM_SPECIES_FILTER", "")

# ── Pipeline ───────────────────────────────────────────────────────────────

list(
  tar_target(batch_enabled, nzchar(batch_config_path)),

  # Config source: either a CSV file or a single hardcoded row
  tar_target(config_rows, {
    if (batch_enabled) {
      df <- tryCatch(
        read.csv(batch_config_path, stringsAsFactors = FALSE,
          check.names = FALSE),
        error = function(e) {
          stop("Failed to read batch config file '", batch_config_path, "': ",
            conditionMessage(e), call. = FALSE)
        })
      split(df, seq_len(nrow(df)))
    } else {
      list(list(
        species = fallback_species,
        species_filter = fallback_species_filter,
        occurrences_csv = fallback_csv,
        model_id = "glm",
        biovars = paste(fallback_biovars, collapse = ","),
        projection_extent = paste(fallback_extent, collapse = ","),
        cv_folds = as.character(fallback_cv_folds),
        background_n = as.character(fallback_background_n)
      ))
    }
  }),

  # Consolidated per-species run: clean + covariates + fit + postprocess
  # Returns list(cfg, occ, env, fit, post, species, model_id)
  tar_target(species_model, run_species(config_rows, seed = batch_seed),
    pattern = map(config_rows),
    priority = 0.8),

  # Predict suitability (kept separate for efficient tar_terra_rast storage)
  tar_terra_rast(suit, {
    sm <- species_model
    sdm_stage_predict(sm$cfg, sm$fit$fit, sm$env)
  }, pattern = map(species_model)),

  # Future projection (conditional)
  tar_target(future_result, {
    sm <- species_model
    if (isTRUE(sm$cfg$future_projection)) {
      safe_name <- gsub("[^a-zA-Z0-9._-]", "_", sm$species)
      sp_output_dir <- file.path(batch_output_dir, safe_name)
      dir.create(sp_output_dir, recursive = TRUE, showWarnings = FALSE)
      sdm_stage_future(sm$cfg, sm$fit$fit, suit, sm$env, sp_output_dir, safe_name)
    } else {
      NULL
    }
  }, pattern = map(species_model, suit)),

  # ── Multi-species aggregation targets (batch mode only) ─────────────────

  # Aggregate per-species suitability rasters into a richness map
  tar_combine(
    richness_map,
    suit,
    command = {
      rasts <- list(!!!.x)
      rasts <- rasts[!sapply(rasts, is.null)]
      if (length(rasts) == 0) return(NULL)
      stack <- do.call(c, rasts)
      threshold <- 0.5
      richness <- sum(stack > threshold, na.rm = TRUE)
      names(richness) <- "species_richness"
      out_tif <- file.path(batch_output_dir, "species_richness.tif")
      dir.create(dirname(out_tif), recursive = TRUE, showWarnings = FALSE)
      terra::writeRaster(richness, out_tif, overwrite = TRUE)
      richness
    },
    packages = "terra"
  ),

  # Aggregate per-species metrics into a batch summary CSV
  tar_combine(
    batch_report,
    species_model,
    command = {
      results <- list(!!!.x)
      rows <- lapply(seq_along(results), function(i) {
        r <- results[[i]]
        if (is.null(r)) {
          data.frame(species = paste0("species_", i), status = "error",
            stringsAsFactors = FALSE)
        } else {
          post <- r$post %||% list()
          cv <- r$fit$fit$cv %||% list()
          data.frame(
            species = r$species %||% paste0("species_", i),
            status = "success",
            model_id = r$model_id %||% NA_character_,
            auc_mean = cv$auc_mean %||% NA_real_,
            tss_mean = cv$tss_mean %||% NA_real_,
            eoo_km2 = post$eoo_aoo$eoo_km2 %||% NA_real_,
            aoo_km2 = post$eoo_aoo$aoo_km2 %||% NA_real_,
            enmeval_tuned = isTRUE(r$enmeval_tuned),
            enmeval_null_p_value = r$enmeval_null_p_value %||% NA_real_,
            stringsAsFactors = FALSE
          )
        }
      })
      df <- data.table::rbindlist(rows)
      out_csv <- file.path(batch_output_dir, "batch_metrics.csv")
      dir.create(dirname(out_csv), recursive = TRUE, showWarnings = FALSE)
      write.csv(df, out_csv, row.names = FALSE)
      df
    }
  ),
)

} # end else (single-species pipeline mode)

# ── Usage ──────────────────────────────────────────────────────────────────
# tar_visnetwork()                     # view dependency graph
# tar_make()                           # run (with crew parallelism)
# SDM_BATCH_CONFIG=batch.csv tar_make()  # run multi-species batch
# tar_read(species_model)              # read per-species results (branched)
# tar_outdated()                       # check stale targets
