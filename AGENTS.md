# AGENTS.md — SDM Dashboard Workbench

## Git workflow

- **Commit locally only for significant changes** — bug fixes, new features, non-trivial refactors. Skip trivial CSS tweaks or comment changes.
- **Never push to GitHub unless explicitly asked** — after committing locally, ask the user if they want to push.

## Run commands

```bash
# Smoke test (always run before PR)
Rscript scripts/smoke_test.R

# Full testthat suite
Rscript tests/testthat.R

# Install dependencies
Rscript install_packages.R

# Parse all R sources (subdirectories included)
Rscript -e 'files <- list.files("R", pattern = "[.][Rr]$", recursive = TRUE, full.names = TRUE); for (f in files) parse(f); parse("app.R"); parse("pipeline.R"); parse("launch_app.R")'

# Release audit (before shipping)
Rscript scripts/audit_release.R
```

## Architecture

- **Entry point:** `app.R` (Shiny UI). Orchestration: `R/core/run_sdm.R` → `run_fast_sdm()`.
- **R/ has 8 subdirectories:** `core/`, `data/`, `covariates/`, `models/`, `ecology/`, `output/`, `ui/`, `modules/`. `R/load.R` sits at top level.
- **Module loader:** `R/load.R` uses `sdm_resolve_module()` to find 91 modules across subdirectories in fixed dependency order. No auto-sourcing.
- **Config:** `R/core/config.R` — all `sdm_default_*` constants. Secrets must not be added here.
- **Path resolution:** `app.R` resolves `app_dir` from `--file=` arg or `sys.frames()`, not `getwd()`. All paths use `file.path(app_dir, ...)`.

## Boot-up process

```
app.R
  → source R/core/bootstrap.R → sdm_set_project_root(app_dir)
  → source R/core/optimized_sdm.R → sources R/load.R → 91 modules
  → source R/ui/ui_header.R, R/ui/ui_sidebar_controls.R, R/ui/ui_main_tabs.R
  → ensure_sdm_packages(c("shiny","bslib","terra","leaflet","sf","DT"))
  → library(shiny) library(bslib) library(leaflet) library(sf)
  → if (!interactive()) shiny::runApp(host="0.0.0.0", port=3838)
```

Windows launcher: `run_app_windows.bat` → `scripts/windows_setup.R` → `launch_app.R` → `app.R`

## CI

Single workflow: `.github/workflows/r-quality.yml` — parse R sources, install deps, smoke_test, testthat, audit_release. Runs on ubuntu-latest.

## R/Shiny gotchas (verified by runtime crashes)

- **`observe()` does NOT accept `ignoreInit`** — only `observeEvent()` does.
- **`bslib::modal()` does not exist** — use `modalDialog()`.
- **`passwordInput()` does NOT accept `autocomplete`** — wrap with `tagAppendAttributes(..., autocomplete = "new-password")`.
- **`nzchar(NULL)` returns `logical(0)`** — use `nzchar(x %||% "")` or check `is.null(x)` first.
- **`callr::r_bg` runs in a separate process** — `<<-` on Shiny reactives has no effect. Background downloads must source `bootstrap.R` before `optimized_sdm.R` in the child.
- **`rv$cleaned_occurrence` is a list** — `{df, source_counts, n_absent_excluded, original_rows}`. NOT a dataframe.
- **`rv$undo_stack` is a list** — capped at 10 states, used by Observation Records tab.
- **Numeric inputs can receive `Inf`/`NA`** — use `safe_numeric()` in `R/ui/ui_sidebar_controls.R`.
- **`sdm_default_cv_block_size_km` is `NA_real_`** — UI defaults to 50 when NA.

## Key conventions

- **Climate source toggle:** `source = c("worldclim","chelsa")` — CHELSA v2.1 uses `bio1_1979-2013` naming (two-digit bio1-9, single-digit bio10-19); WorldClim uses `bio1.tif`.
- **biomod2 is gated:** Requires `options(sdm.enable_biomod2 = TRUE)` AND `requireNamespace("biomod2", quietly = TRUE)`. Never add to base packages.
- **Spatial-block CV fallback:** Fewer than 5 occurrence points → `cv_folds.R` warns and falls back to random k-fold.
- **Synthetic example:** `data/examples/synthetic_presence_data.csv` — safe to commit; real occurrence data must never be committed.
- **Lock file:** `renv.lock` pins R package versions. Use `renv::restore()` on a new machine.

## Data handling

- WorldClim cached in `Worldclim/`; CHELSA in `chelsa/`; future layers in `Worldclim_future/`. Do not commit downloaded rasters.
- Occurrence CSV must have `longitude`/`latitude` columns (or aliases: `lon`, `decimalLongitude`).
- Outputs go to `outputs/` by default. This directory is gitignored.

## WSL access

WSL has no GUI browser. Access from a **Windows browser** at `http://<WSL-IP>:3838`. Get the IP:
```bash
hostname -I | awk '{print $1}'
```

## Package install quirks

- `R/core/packages.R` defines 4 vectors: `sdm_required_packages` (minimal bootstrap), `sdm_setup_packages` (core UI deps), `sdm_app_packages` (all modelling backends), `sdm_optional_packages` (per-feature).
- Any package loaded via `library()` or `::` in app.R or R/ui_*.R **must be in `sdm_setup_packages`** to avoid first-launch failures.
- `install_packages.R` uses `sdm_setup_packages`; `scripts/windows_setup.R` uses `sdm_app_packages`.

## CSS / UI conventions

- **Single dark mode system:** `body.sdm-dark` + CSS variables in `www/sdm-theme.css`.
- **CSS fallback:** `app.R` injects CSS inline via `tags$style()` as backup for the external stylesheet.
- **Leaflet maps:** CartoDB Positron (light) + DarkMatter (dark) tile groups with `baseGroups` in layersControl.
- **Status dot classes:** `.status-dot-ok`, `.status-dot-warn`, `.status-dot-error`, `.status-dot-unknown`.
- **Get Data tab:** `.gd-section-summary`, `.gd-section-summary-compact`, `.gd-section-icon`, `.gd-section-body`.
- **Observation Records tab:** `.obs-metric-card`, `.obs-metric-value`, `.obs-metric-label`, `.flagged-actions`, `.btn-toolbar`, `.source-table-container`, `.obs-log-output`, `.obs-record-table`.
- **Flagged actions:** `btn-group btn-group-sm` toolbar with Remove flagged, Clear flags, Undo buttons.

## Important file locations

- `R/core/bootstrap.R` — project root detection, path helpers
- `R/core/config.R` — all `sdm_default_*` constants
- `R/core/packages.R` — dependency vectors, `ensure_sdm_packages()`
- `R/core/optimized_sdm.R` — engine loader, sources `load.R`
- `R/core/run_sdm.R` — `run_fast_sdm()` orchestration
- `R/core/validation.R` — input validation helpers
- `R/data/occurrences.R` — cleaning, CoordinateCleaner integration
- `R/data/occurrences_dwca.R` — Darwin Core Archive reader
- `R/covariates/covariates_climate.R` — WorldClim/CHELSA download + load
- `R/covariates/covariates_stack.R` — combines climate + elevation + soil
- `R/covariates/download_helper.R` — background download helper (`callr::r_bg`)
- `R/covariates/future_projection.R` — future BIO layer swap and delta raster
- `R/models/model_glm.R` — primary model backend; random and spatial-block CV
- `R/models/prediction.R` — suitability raster prediction
- `R/models/cv_engine.R` — cross-validation engine
- `R/ecology/eoo_aoo.R` — extent/area of occurrence calculations
- `R/output/report.R` — text report generation
- `R/output/report_odmap.R` — ODMAP standard report
- `R/output/plots.R` — `render_suitability_leaflet()`, map rendering
- `R/ui/ui_main_tabs.R` — 6-tab layout: Dashboard, Future projection, Observation records, Model diagnostics, Get Data, Downloads
- `R/ui/leaflet_plugins.R` — CDN plugin definitions (markercluster, draw, heat, side-by-side — not wired at runtime)
- `R/modules/mod_get_data.R` — Get Data tab server
- `R/modules/mod_model_run.R` — model run tab server
- `R/modules/mod_results.R` — results tab server (GBIF exclusion uses `showNotification`, not `append_log`)
- `R/modules/mod_readiness.R` — readiness preflight checks
- `scripts/audit_release.R` — release validation (checks expected files, no public clutter, ZIP contents)
- `scripts/smoke_test.R` — quick smoke test

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
