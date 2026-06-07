# SDM Dashboard — Multi-species joint SDM pipeline
# Used when model_id = "dnn_multispecies" (single model, multiple species).
# Sources on top of _targets.R's environment — does NOT re-source modules.
#
# Run: SDM_MULTISPECIES=true SDM_BATCH_CONFIG=batch.csv tar_make()
#
# Pre-requisites:
#   The batch CSV must have all species rows with model_id=dnn_multispecies.
#   cito + torch R packages required.

# ── Pipeline ───────────────────────────────────────────────────────────────
list(

  # Read all config rows (not split per species)
  tar_target(batch_config, {
    csv <- Sys.getenv("SDM_BATCH_CONFIG", "")
    if (!nzchar(csv)) stop("SDM_BATCH_CONFIG is required for multi-species mode", call. = FALSE)
    read.csv(csv, stringsAsFactors = FALSE, check.names = FALSE)
  }),

  # Build a single sdm_config from the first row (shared env settings)
  # The occurrence data will span ALL species
  tar_target(cfg, {
    rows <- split(batch_config, seq_len(nrow(batch_config)))
    build_config_from_row(rows[[1]], seed = as.integer(Sys.getenv("SDM_BATCH_SEED", "42")))
  }),

  # Combine all species occurrence files into one multi-species CSV
  tar_target(combined_occ_csv, {
    n <- nrow(batch_config)
    occ_list <- lapply(seq_len(n), function(i) {
      row <- batch_config[i, ]
      csv <- as.character(row$occurrences_csv %||% row$occurrence_file %||% "")
      if (!nzchar(csv)) stop("No occurrence file for row ", i, call. = FALSE)
      if (!file.exists(csv)) stop("Occurrence file not found: ", csv, call. = FALSE)
      occ <- utils::read.csv(csv, stringsAsFactors = FALSE)
      if ("species" %in% names(row) && nzchar(as.character(row$species %||% ""))) {
        occ$species <- as.character(row$species)
      }
      occ
    })
    all_occ <- do.call(rbind, occ_list)

    # Add species column if not present (fallback to row species name)
    if (!"species" %in% names(all_occ)) {
      all_occ$species <- rep(as.character(batch_config$species), times = sapply(occ_list, nrow))
    }

    out_csv <- tempfile(pattern = "multispecies_", fileext = ".csv")
    utils::write.csv(all_occ, out_csv, row.names = FALSE)
    out_csv
  }),

  # Clean all occurrences — no species_filter, so all species pass through
  tar_target(occ_clean, {
    cfg_nf <- cfg
    cfg_nf$occurrence_file <- combined_occ_csv
    cfg_nf$species_filter <- NULL
    sdm_stage_clean(cfg_nf)
  }),

  tar_target(env, sdm_stage_covariates(cfg)),

  # Single fit: dnn_multispecies trains on ALL species simultaneously
  tar_target(fit, sdm_stage_fit(cfg, occ_clean$occ, env)),

  # Single predict: produces multi-band SpatRaster + richness
  tar_terra_rast(suit, sdm_stage_predict(cfg, fit$fit, env)),

  # Limited post-process (EOO/AOO not meaningful for joint model)
  tar_target(post, sdm_stage_postprocess(cfg, fit$fit, suit, env),
    format = "rds"),
)
