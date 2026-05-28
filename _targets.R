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
cluster_backend <- Sys.getenv("SDM_CLUSTER_BACKEND", "local")
cluster_workers <- as.integer(Sys.getenv("SDM_CLUSTER_WORKERS",
  parallel::detectCores()))

if (cluster_backend != "local" && requireNamespace("crew", quietly = TRUE)) {
  controller <- build_crew_controller(cluster_backend, workers = cluster_workers)
  if (!is.null(controller)) {
    tar_option_set(controller = controller)
    message("[targets] Using ", cluster_backend, " cluster with ", cluster_workers, " workers")
  }
}

tar_option_set(
  store = file.path("outputs", "_targets"),
  memory = if (cache_mode == "minimal") "transient" else "persistent",
  garbage_collection = cache_mode != "persistent",
  storage = if (cache_mode == "minimal") "worker" else "main",
  retrieval = if (cache_mode == "minimal") "worker" else "main",
  packages = c("terra", "sf")
)

# ── Load SDM engine ─────────────────────────────────────────────────────────
source(file.path("R", "core", "bootstrap.R"))
sdm_set_project_root(getwd())
source(file.path("R", "engine_load.R"))

# ── Batch configuration ─────────────────────────────────────────────────────
# When SDM_BATCH_CONFIG is set, the pipeline branches over all rows in the CSV.
# Otherwise, falls back to the single-species config defined below.
batch_config_path <- Sys.getenv("SDM_BATCH_CONFIG", "")
batch_output_dir <- Sys.getenv("SDM_BATCH_OUTPUT", "outputs")
batch_seed <- as.integer(Sys.getenv("SDM_BATCH_SEED", "42"))

# Fallback single-species config (used when SDM_BATCH_CONFIG is empty)
fallback_species <- "Test species"
fallback_csv <- "data/examples/synthetic_presence_data.csv"
fallback_biovars <- c(1, 4, 6, 12, 15, 18)
fallback_extent <- c(112, 154, -44, -10)
fallback_cv_folds <- 5L
fallback_background_n <- 500L

# ── Pipeline ───────────────────────────────────────────────────────────────

list(
  tar_target(batch_enabled, nzchar(batch_config_path)),

  # Config source: either a CSV file or a single hardcoded row
  tar_target(config_rows, {
    if (batch_enabled) {
      df <- read.csv(batch_config_path, stringsAsFactors = FALSE,
        check.names = FALSE)
      split(df, seq_len(nrow(df)))
    } else {
      list(list(
        species = fallback_species,
        occurrences_csv = fallback_csv,
        model_id = "glm",
        biovars = paste(fallback_biovars, collapse = ","),
        projection_extent = paste(fallback_extent, collapse = ","),
        cv_folds = as.character(fallback_cv_folds),
        background_n = as.character(fallback_background_n)
      ))
    }
  }),

  # Build sdm_config per row → creates a branch per row
  tar_target(cfg, build_config_from_row(config_rows, seed = batch_seed),
    pattern = map(config_rows)),

  tar_target(occ_clean, sdm_stage_clean(cfg), pattern = map(cfg)),
  tar_target(env, sdm_stage_covariates(cfg, occ_clean$occ), pattern = map(cfg)),
  tar_target(fit, sdm_stage_fit(cfg, occ_clean$occ, env), pattern = map(cfg)),

  tar_target(suit_tif, {
    safe_name <- gsub("[^a-zA-Z0-9._-]", "_", cfg$species)
    tif <- file.path(batch_output_dir, paste0(safe_name, "_", cfg$model_id, "_suit.tif"))
    dir.create(dirname(tif), recursive = TRUE, showWarnings = FALSE)
    sdm_stage_predict(cfg, fit$fit, env, tif)
    tif
  }, pattern = map(fit), format = "file"),

  tar_target(future_result, sdm_stage_future(cfg, fit$fit, terra::rast(suit_tif), env,
    batch_output_dir, cfg$species), pattern = map(suit_tif)),

  tar_target(post, sdm_stage_postprocess(
    cfg, fit$fit, terra::rast(suit_tif), env),
    pattern = map(suit_tif)),
)

# ── Usage ──────────────────────────────────────────────────────────────────
# tar_visnetwork()                     # view dependency graph
# tar_make()                           # run single-species fallback
# SDM_BATCH_CONFIG=batch.csv tar_make()  # run multi-species batch
# tar_read(post)                       # read post-processing results
# tar_outdated()                       # check stale targets
