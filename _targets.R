# SDM Dashboard — targets pipeline
# Run: tar_make()
# Inspect: tar_visnetwork()
# Read outputs: tar_read(target_name)
#
# Pre-requisites: install targets, tarchetypes, geotargets
#   install.packages(c("targets", "tarchetypes", "geotargets"))

library(targets)
library(tarchetypes)
library(geotargets)

# Cache mode — controls how much data targets stores between runs.
#   minimal:    ~0.5 GB per 10 species — re-computes env on crash
#   standard:   ~2 GB per 10 species — full caching (default)
#   persistent: ~3 GB per 10 species — full caching + history
cache_mode <- Sys.getenv("SDM_TARGETS_CACHE", "standard")

tar_option_set(
  store = file.path("outputs", "_targets"),
  memory = if (cache_mode == "minimal") "transient" else "persistent",
  garbage_collection = cache_mode != "persistent",
  storage = if (cache_mode == "minimal") "worker" else "main",
  retrieval = if (cache_mode == "minimal") "worker" else "main",
  packages = c("terra", "sf")
)

# Load the SDM computation engine (same as scripts/batch_run.R)
# Sources all modules in dependency order — no Shiny UI code loaded
source(file.path("R", "core", "bootstrap.R"))
sdm_set_project_root(getwd())
source(file.path("R", "engine_load.R"))

# ── Configuration ──────────────────────────────────────────────────────────
# Edit these for your run or load from an external config file
species_name <- "Test species"
occurrence_csv <- "data/examples/synthetic_presence_data.csv"
selected_biovars <- c(1, 4, 6, 12, 15, 18)
projection_extent <- c(112, 154, -44, -10)
cv_folds <- 5L
background_n <- 500L
seed <- 42L

# ── Pipeline ───────────────────────────────────────────────────────────────

list(
  tar_target(occ_file, occurrence_csv, format = "file"),

  tar_target(cfg, sdm_config(
    species = species_name,
    occurrence_file = occ_file,
    selected_biovars = selected_biovars,
    projection_extent = projection_extent,
    cv_folds = cv_folds,
    background_n = background_n,
    cv_strategy = "random",
    seed = seed
  )),

  tar_target(occ_clean, sdm_stage_clean(cfg)),

  tar_target(env, sdm_stage_covariates(cfg, occ_clean$occ)),

  tar_target(fit, sdm_stage_fit(cfg, occ_clean$occ, env)),

  tar_target(suit_tif, {
    tif <- file.path("outputs", paste0("suit_", gsub("[- ]", "_", Sys.Date()), ".tif"))
    dir.create(dirname(tif), recursive = TRUE, showWarnings = FALSE)
    result <- sdm_stage_predict(cfg, fit$fit, env, tif)
    tif
  }, format = "file"),

  tar_target(post, sdm_stage_postprocess(
    cfg, fit$fit, terra::rast(suit_tif), env
  ))
)

# ── Usage ──────────────────────────────────────────────────────────────────
# tar_visnetwork()        # view dependency graph
# tar_make()              # run pipeline
# tar_read(post)          # read post-processing results
# tar_outdated()          # check which targets need re-running
