#!/usr/bin/env Rscript
# scripts/generate_snapshots.R
#
# Generates reference rasters and metrics for snapshot tests.
# Run this once after any model backend changes to update reference data.
#
# Usage:
#   Rscript scripts/generate_snapshots.R
#
# Output: tests/testthat/_snaps/rasters/*.rds

set.seed(42)

# Bootstrap
source("R/core/bootstrap.R")
source("R/load.R")
source("tests/testthat/helper-fixtures.R")
source("tests/testthat/helper-load.R")

SNAP_DIR <- file.path("tests", "testthat", "_snaps", "rasters")
dir.create(SNAP_DIR, recursive = TRUE, showWarnings = FALSE)

make_env_and_occ <- function() {
  tmp_occ <- tempfile(fileext = ".csv")
  make_synthetic_occurrence(tmp_occ, n_pres = 40, seed = 42L)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)
  tmp_env <- tempfile()
  dir.create(tmp_env, showWarnings = FALSE)
  terra::writeRaster(env[[1]], file.path(tmp_env, "bio_1.tif"), overwrite = TRUE)
  terra::writeRaster(env[[2]], file.path(tmp_env, "bio_12.tif"), overwrite = TRUE)

  list(occ = tmp_occ, env_dir = tmp_env, env = env)
}

run_and_save <- function(model_id, snap_name, ...) {
  cat(sprintf("Generating snapshot for %s...\n", model_id))
  data <- make_env_and_occ()
  tmp_out <- tempfile()
  dir.create(tmp_out, showWarnings = FALSE)

  result <- tryCatch(
    run_fast_sdm(
      species = "Synthetic species", occurrence_file = data$occ,
      worldclim_dir = data$env_dir, selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22), background_n = 120,
      thin_by_cell = FALSE, model_id = model_id, include_quadratic = FALSE,
      threshold = 0.5, aggregation_factor = 1, cv_folds = 2,
      cv_strategy = "random", n_cores = 1, allow_download = FALSE,
      output_dir = tmp_out, seed = 42,
      ...
    ),
    error = function(e) {
      cat(sprintf("  SKIPPED: %s\n", conditionMessage(e)))
      NULL
    }
  )

  if (!is.null(result)) {
    suit_values <- terra::values(result$suitability, na.rm = TRUE)
    ref <- list(
      nrow = terra::nrow(result$suitability),
      ncol = terra::ncol(result$suitability),
      nlyr = terra::nlyr(result$suitability),
      values = suit_values,
      auc_mean = result$cv$auc_mean,
      tss_mean = result$cv$tss_mean,
      n_presence = result$metrics$presence_records,
      n_background = result$metrics$background_points
    )

    path <- file.path(SNAP_DIR, paste0(snap_name, ".rds"))
    saveRDS(ref, path)
    cat(sprintf("  Saved %s (AUC=%.4f, TSS=%.4f, %d pixels)\n",
                basename(path), ref$auc_mean, ref$tss_mean, length(suit_values)))

    # Save importance snapshot for GLM
    if (model_id == "glm") {
      imp_ref <- list(
        n_vars = nrow(result$variable_importance),
        variables = sort(result$variable_importance$variable)
      )
      saveRDS(imp_ref, file.path(SNAP_DIR, "glm_importance.rds"))
      cat(sprintf("  Saved glm_importance.rds (%d variables)\n", imp_ref$n_vars))

      thresh_ref <- list(
        max_tss = result$thresholds$max_tss,
        max_sens_spec = result$thresholds$max_sens_spec
      )
      saveRDS(thresh_ref, file.path(SNAP_DIR, "glm_thresholds.rds"))
      cat(sprintf("  Saved glm_thresholds.rds (max_tss=%.4f, max_sens_spec=%.4f)\n",
                  thresh_ref$max_tss, thresh_ref$max_sens_spec))
    }
  }

  unlink(tmp_out, recursive = TRUE)
  unlink(data$env_dir, recursive = TRUE)
  unlink(data$occ)
}

cat("=== Generating reference snapshots ===\n\n")

run_and_save("glm", "glm_suitability")
run_and_save("gam", "gam_suitability")
run_and_save("rangebag", "rangebag_suitability")

cat("\n=== Done ===\n")
cat(sprintf("Reference snapshots saved to %s/\n", SNAP_DIR))
cat("Commit these files to version control.\n")
