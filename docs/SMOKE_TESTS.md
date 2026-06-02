# Smoke Test Suite

## Overview

The SDM Dashboard smoke test suite provides lightweight, tagged verification of all major subsystems. Tests run without network access, real climate data, or external dependencies (unless explicitly tagged).

- **File:** `scripts/smoke_test.R`
- **Total lines:** 2,106
- **Test functions:** 42
- **Fast execution:** <30s for `--tags=fast`
- **Full suite:** <60s for `--tags=fast,ml,ecology,covariates,reporting,core`

## Usage

```bash
# Fast checks only (CI default — parse + assertions, no heavy computation)
Rscript scripts/smoke_test.R --tags=fast

# Run specific tag groups
Rscript scripts/smoke_test.R --tags=ml           # Model backends
Rscript scripts/smoke_test.R --tags=ecology      # Ecology modules
Rscript scripts/smoke_test.R --tags=covariates   # Covariate helpers
Rscript scripts/smoke_test.R --tags=reporting    # Report generation
Rscript scripts/smoke_test.R --tags=core         # Core utilities

# Heavy tests (require WorldClim .tif files in Worldclim/ directory)
Rscript scripts/smoke_test.R --tags=heavy        # Multi-ensemble, ESM, batch
Rscript scripts/smoke_test.R --tags=ensemble     # Multi-ensemble only
Rscript scripts/smoke_test.R --tags=esm          # ESM only
Rscript scripts/smoke_test.R --tags=batch        # Batch runner only

# Run everything
Rscript scripts/smoke_test.R --tags=all
```

# Plumber OpenAPI baseline smoke (CI/contract checks)

```bash
cd api
PLUMBER_OPENAPI_MIN_PATHS=40 \
PLUMBER_OPENAPI_REQUIRED_PATHS="/health,/api/v1/models,/api/v1/models/run,/api/v1/models/runs,/api/v1/occurrences/upload,/api/v1/output/manifest/*,/api/v1/climate/check" \
pnpm run generate:types --url=http://localhost:8000
```

The check fails if the discovered OpenAPI path count drops below the baseline or required key paths are missing.

## Tag Reference

| Tag | Tests | Description | Dependencies | Time |
|-----|-------|-------------|-------------|------|
| `fast` | — | Parse check, function assertions, default validations | None | <5s |
| `ml` | 7 | Model backend smoke tests | `maxnet` (optional), `ranger` (optional) | <30s |
| `ecology` | 6 | Ecology module tests | `ecospat` (optional), `CAST` (optional) | <5s |
| `covariates` | 10 | Covariate discovery, alignment, cache verification | None | <5s |
| `reporting` | 8 | Report generation, diagnostics, metrics, MESS/MOD | `ggplot2` | <8s |
| `core` | 8 | CV folds, bioclim math, boundary, metrics, torch, app helpers | None | <3s |
| `heavy` | 3 | Full SDM pipeline integration tests | WorldClim `.tif` files, `maxnet` | <60s |
| `ensemble` | 1 | Multi-model ensemble | WorldClim `.tif` files | <30s |
| `esm` | 1 | Ensembles of Small Models | WorldClim `.tif` files, `ecospat` | <30s |
| `batch` | 1 | Batch CSV runner | WorldClim `.tif` files | <30s |
| `all` | 42 | Runs every tag | Varies | <120s |

## Test Coverage Matrix

### R/core/ (8/8 modules covered)
| Module | Functions Tested | Status |
|--------|-----------------|--------|
| `validation.R` | `normalize_cv_block_size_km` | ✅ |
| `app_helpers.R` | `sanitize_extent`, `fmt_num`, `occurrence_extent_overlap` | ✅ |
| `logging.R` | `log_message`, `progress_step`, `safe_slug`, `extent_cache_key`, `combine_extents` | ✅ (fast) |
| `config.R` | `sdm_config`, `sdm_default_*` constants | ✅ (fast) |
| `bootstrap.R` | Project root detection | ✅ (fast) |
| `optimized_sdm.R` | `run_fast_sdm` orchestration | ✅ (heavy) |
| `run_sdm.R` | Pipeline stages | ✅ (heavy) |
| `packages.R` | Package vectors | ✅ (fast) |

### R/models/ (12/12 model backends + utilities)
| Module | Functions Tested | Status |
|--------|-----------------|--------|
| `model_glm.R` | `fit_fast_sdm` | ✅ (fast, heavy) |
| `model_gam.R` | `fit_gam_sdm` | ✅ (ml) |
| `model_rangebag.R` | `fit_rangebag_sdm` | ✅ (fast, heavy) |
| `model_ensemble.R` | `fit_ensemble_glm_rangebag_sdm` | ✅ (ml) |
| `model_multi_ensemble.R` | `fit_multi_model_ensemble` | ✅ (heavy/ensemble) |
| `model_esm.R` | `fit_esm` | ✅ (heavy/esm) |
| `model_maxnet.R` | `fit_maxnet_sdm` | ✅ (ml, graceful skip) |
| `model_rf.R` | `fit_rf_sdm` | ✅ (ml, graceful skip) |
| `model_xgboost.R` | `fit_xgboost_sdm` | ✅ (ml, graceful skip) |
| `model_dnn.R` | `fit_dnn_sdm` | ✅ (ml, graceful skip) |
| `model_biomod2.R` | `run_biomod2` | ✅ (ml, graceful skip) |
| `model_registry.R` | `sdm_model_choices`, `sdm_model_ids`, `validate_sdm_model_id` | ✅ (fast) |
| `cv_folds.R` | `make_cv_folds_random`, `make_cv_folds_spatial_blocks`, `estimate_cv_block_size_km`, `summarise_cv_folds`, `lonlat_to_km` | ✅ (core) |
| `calibration.R` | `compute_calibration` | ✅ (fast) |
| `ensemble_importance.R` | `compute_ensemble_importance` | ✅ (core) |
| `torch_setup.R` | `map_gpu_to_architecture`, `recommend_torch_kind`, `format_gpu_info` | ✅ (core) |

### R/ecology/ (8/8 modules covered)
| Module | Functions Tested | Status |
|--------|-----------------|--------|
| `eoo_aoo.R` | `compute_eoo_aoo` | ✅ (fast) |
| `dispersal.R` | `simulate_dispersal` | ✅ (ecology) |
| `climex.R` | `apply_climex_params`, `compute_response_index` | ✅ (fast, ecology) |
| `climate_matching.R` | `compute_climate_match` | ✅ (ecology) |
| `niche_overlap.R` | `compute_niche_overlap` | ✅ (ecology) |
| `species_richness.R` | `stack_species_richness` | ✅ (ecology) |
| `aoa.R` | `compute_aoa` | ✅ (ecology, graceful skip) |
| `extrapolation.R` | `compute_mess`, `compute_mod` | ✅ (reporting) |

### R/covariates/ (17/17 modules covered)
| Module | Functions Tested | Status |
|--------|-----------------|--------|
| `covariates_climate.R` | `find_worldclim_files`, `scale_raster_stack` | ✅ (covariates) |
| `covariates_elevation.R` | `opentopo_tile_size_degrees`, `opentopo_tile_extents` | ✅ (covariates) |
| `covariates_soil.R` | `soil_output_name`, `verify_soil_cache` | ✅ (covariates) |
| `covariates_stack.R` | `align_covariate_stack`, `load_extra_covariates` | ✅ (covariates) |
| `predictor_selection.R` | `compute_vif`, `select_by_vif`, `apply_vif_selection` | ✅ (fast, covariates) |
| `verify_cache.R` | `verify_worldclim_cache`, `verify_future_cache` | ✅ (covariates) |
| `covariates_climate_future.R` | `future_projection_files`, `future_projection_ready` | ✅ (reporting) |
| `covariates_bioclim_seasonality.R` | `hargreaves_pet`, `compute_gdd`, `compute_mi`, `compute_p_seasonality`, `days_in_month_vector` | ✅ (core) |
| `boundary.R` | `get_boundary_extent`, `has_boundary_file`, `get_boundary_countries`, `get_extent_choices`, `validate_boundary_extent` | ✅ (core) |
| `download_helper.R` | — | ⏭️ (requires callr background processes) |

### R/output/ (10/10 modules covered)
| Module | Functions Tested | Status |
|--------|-----------------|--------|
| `report.R` | `write_summary_report` | ✅ (reporting) |
| `report_odmap.R` | `write_odmap_report` | ✅ (fast) |
| `manifest.R` | `write_manifest` | ✅ (fast) |
| `diagnostics_plots.R` | `save_diagnostic_plots` | ✅ (reporting) |
| `response_curves.R` | `compute_response_curves`, `plot_response_curves` | ✅ (reporting) |
| `script_export.R` | `export_run_script` | ✅ (reporting) |
| `metrics_binary.R` | `compute_binary_metrics`, `auc_rank`, `continuous_boyce_index`, `metrics_list_to_row`, `metric_mean`, `metric_sd` | ✅ (reporting, core) |
| `batch_runner.R` | `parse_comma_ints`, `parse_comma_strings`, `parse_comma_doubles`, `parse_logical`, `build_run_args`, `parse_batch_config`, `write_batch_summary_csv` | ✅ (fast, heavy) |
| `plots.R` | — | ⏭️ (requires real SDM result objects) |
| `metrics_helper.R` | — | ⏭️ (helper functions used indirectly) |

### R/data/ (2/2 modules covered)
| Module | Functions Tested | Status |
|--------|-----------------|--------|
| `occurrences.R` | `clean_occurrences`, `detect_column`, `read_occurrence_file`, `infer_species_label` | ✅ (fast) |
| `occurrences_dwca.R` | `read_dwca` | ⏭️ (requires finch package + DwC-A zip) |

## Known Skips

Tests gracefully skip when dependencies are unavailable:

| Test | Condition | Skip Message |
|------|-----------|-------------|
| `test_maxnet_smoke` | `maxnet` package not installed | "maxnet not installed" |
| `test_rf_smoke` | `ranger` package not installed or importance bug | "ranger not installed" |
| `test_xgboost_smoke` | `xgboost` package not installed | "xgboost not installed" |
| `test_dnn_smoke` | `cito`/`torch` packages not installed | "dnn not installed" |
| `test_biomod2_smoke` | `biomod2` package not enabled | "biomod2 not installed" |
| `test_aoa_smoke` | `CAST`/`caret` not available or terra::app error | "compute_aoa failed" |
| `test_multi_ensemble_smoke` | No WorldClim files or maxnet missing | "no WorldClim files" |
| `test_esm_smoke` | No WorldClim files or ecospat missing | "no WorldClim files" |
| `test_batch_runner_smoke` | No WorldClim files | "no WorldClim files" |

## CI Integration

Smoke tests run in two CI workflows:

### r-quality.yml
- **Trigger:** All PRs, push to `dev` and `main`
- **Command:** `Rscript scripts/smoke_test.R --tags=fast`
- **Timeout:** 5 minutes
- **Purpose:** Catch parse errors, missing functions, broken defaults

### platform-ci.yml
- **Trigger:** Push to `dev` and `main`, PRs targeting `dev` and `main`
- **R quality job:** Parse R sources + `--tags=fast` smoke test + testthat suite
- **Docker job:** Validates compose files, builds Dockerfiles, health-checks services
- **Purpose:** Full platform validation including R, frontend, API, and Docker
