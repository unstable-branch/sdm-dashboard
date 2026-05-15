# AGENTS.md — SDM Dashboard Workbench

## Run commands

```bash
# Smoke test (always run before PR)
Rscript scripts/smoke_test.R

# Full testthat suite
Rscript tests/testthat.R

# Install dependencies
Rscript install_packages.R

# Test a specific file
Rscript -e "source('R/load.R'); source('tests/testthat/test-climate-source.R')"
```

## Architecture

- **Entry point:** `app.R` (Shiny UI). Orchestration engine: `R/run_sdm.R` → `run_fast_sdm()`.
- **Module loader:** `R/load.R` sources modules in fixed dependency order (bootstrap → config → ... → run_sdm).
- **Extra modules:** Any `R/*.R` file not in the canonical list is auto-sourced with a warning. Current extras: `biomod2_compat.R`, `model_biomod2.R`, `model_dnn.R`, `torch_setup.R`, `ui_header.R`, `ui_main_tabs.R`, `ui_sidebar_controls.R`, `covariates_climate_future.R`.
- **Config:** `R/config.R` sets project-wide defaults; secrets must not be added here.

## Key conventions

- **Climate source toggle:** `source = c("worldclim","chelsa")` — CHELSA v2.1 files use `bio1_1979-2013` naming (two-digit for bio1-9, single-digit for bio10-19); WorldClim uses `bio1.tif`. Set via `sdm_default_climate_source` in config or UI toggle.
- **biomod2 is gated:** Requires `options(sdm.enable_biomod2 = TRUE)` AND `requireNamespace("biomod2", quietly = TRUE)`. Never add to base packages.
- **Spatial-block CV fallback:** When `cv_strategy = "spatial_block"` but fewer than 5 occurrence points exist, `cv_folds.R` emits a warning and falls back to random k-fold.
- **Synthetic example:** `data/examples/synthetic_presence_data.csv` — safe to commit; real occurrence data must never be committed.
- **Lock file:** `renv.lock` pins R package versions. Use `renv::restore()` to recreate the environment on a new machine.

## Boot-up process

```
app.R
  → source R/bootstrap.R, R/ui_header.R, R/ui_sidebar_controls.R, R/ui_main_tabs.R
  → sdm_set_project_root()
  → source R/optimized_sdm.R
      → source R/load.R → sources 34 canonical modules + extras
  → ensure_sdm_packages(c("shiny","bslib","terra","leaflet","sf","DT"))
  → library(shiny) library(bslib) library(leaflet) library(sf)
  → if (!interactive()) shiny::runApp(host="0.0.0.0", port=3838)
```

Windows launcher: `run_app_windows.bat` → `scripts/windows_setup.R` → `launch_app.R` → `app.R`

## Data handling

- WorldClim cached in `Worldclim/`; CHELSA in `chelsa/`; future layers in `Worldclim_future/`. Do not commit downloaded rasters.
- Occurrence CSV must have `longitude`/`latitude` columns (or aliases: `lon`, `decimalLongitude`).
- Outputs go to `outputs/` by default. This directory is gitignored.

## WSL access

WSL has no GUI browser. When the app is running in WSL, access it from a **Windows browser** at `http://<WSL-IP>:3838`. Get the IP with:
```bash
hostname -I | awk '{print $1}'
```

## Package install quirks

- `R/packages.R` defines `sdm_setup_packages` (core UI deps), `sdm_app_packages` (all modelling backends), and `sdm_optional_packages` (per-feature deps).
- Any package loaded via `library()` or `::` in app.R or R/ui_*.R **must be in `sdm_setup_packages`** to avoid first-launch install failures.
- `install_packages.R` uses `sdm_setup_packages`; `scripts/windows_setup.R` uses `sdm_app_packages`.

## Important file locations

- `R/optimized_sdm.R` — engine loader (not `optimized_sdm.R` at root)
- `R/bootstrap.R` — project root detection, path helpers
- `R/occurrences.R` — cleaning, CoordinateCleaner integration
- `R/covariates_stack.R` — combines climate + elevation + soil into training raster
- `R/model_glm.R` — primary model backend; random and spatial-block CV
- `R/prediction.R` — suitability raster prediction
- `R/future_projection.R` — future BIO layer swap and delta raster export
- `R/script_export.R` — reproducible R script export with all parameters embedded

## PR Checklist Template

Use this in every PR description:

## Summary
What does this PR add/fix?

## Scientific / user reason
Why does this matter for SDM users?

## Scope
Files changed:
- ...

Out of scope:
- ...

## User-visible behavior
What changes in the app or outputs?

## Tests
- [ ] R sources parse
- [ ] scripts/smoke_test.R passes
- [ ] tests/testthat.R passes
- [ ] Added/updated tests for this feature

## Dependencies
- [ ] No new dependency
- [ ] New optional dependency, with clean skip/install hint
- [ ] New hard dependency, documented in DESCRIPTION and installer

## Reproducibility/reporting
- [ ] Seed/parameters recorded where relevant
- [ ] Output/report metadata updated where relevant

## Screenshots / outputs
Attach if UI or report changed.

## Known limitations
What should reviewers know?
