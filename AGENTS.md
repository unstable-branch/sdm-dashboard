# AGENTS.md — SDM Dashboard Workbench

## Git workflow

- **Commit locally first** — always `git add` and `git commit` changes to the local repo immediately after completing a task.
- **Never push to GitHub unless explicitly asked** — do not run `git push` without the user requesting it. After committing locally, ask the user if they want to push to origin.

## Run commands

```bash
# Smoke test (always run before PR)
Rscript scripts/smoke_test.R

# Full testthat suite
Rscript tests/testthat.R

# Install dependencies
Rscript install_packages.R

# Parse all R sources (excludes renv/)
Rscript -e 'files <- list.files(path = c("R", "scripts", "tests"), pattern = "[.][Rr]$", recursive = TRUE, full.names = TRUE); for (f in files) parse(f); parse("app.R"); parse("pipeline.R"); parse("launch_app.R")'
```

## Architecture

- **Entry point:** `app.R` (Shiny UI). Orchestration engine: `R/core/run_sdm.R` → `run_fast_sdm()`.
- **R/ is organized into subdirectories:** `core/`, `data/`, `covariates/`, `models/`, `ecology/`, `output/`, `ui/`, `modules/`.
- **Module loader:** `R/load.R` uses `sdm_resolve_module()` to find files across subdirectories. Sources ~70 modules in fixed dependency order.
- **Config:** `R/core/config.R` sets project-wide defaults; secrets must not be added here.
- **Path resolution:** `app.R` resolves `app_dir` from `--file=` arg or `sys.frames()`, not `getwd()`. All paths use `file.path(app_dir, ...)`.

## Boot-up process

```
app.R
  → source R/core/bootstrap.R → sdm_set_project_root(app_dir)
  → source R/core/optimized_sdm.R → sources bootstrap again → sources R/load.R → all modules
  → source R/ui/ui_header.R, R/ui/ui_sidebar_controls.R, R/ui/ui_main_tabs.R
  → ensure_sdm_packages(c("shiny","bslib","terra","leaflet","sf","DT"))
  → library(shiny) library(bslib) library(leaflet) library(sf)
  → if (!interactive()) shiny::runApp(host="0.0.0.0", port=3838)
```

Windows launcher: `run_app_windows.bat` → `scripts/windows_setup.R` → `launch_app.R` → `app.R`

## R/Shiny gotchas (verified by runtime crashes)

- **`observe()` does NOT accept `ignoreInit`** — only `observeEvent()` does. Using it in `observe()` causes startup crash.
- **`bslib::modal()` does not exist** — use Shiny's `modalDialog()` instead.
- **`passwordInput()` does NOT accept `autocomplete`** — wrap with `tagAppendAttributes(..., autocomplete = "new-password")`.
- **`nzchar(NULL)` returns `logical(0)`** — causes `if` runtime errors. Use `nzchar(x %||% "")` or check `is.null(x)` first.
- **`callr::r_bg` runs in a separate process** — `<<-` on Shiny reactives inside `verify_fun` has no effect. Background download functions must source `bootstrap.R` before `optimized_sdm.R` in the child process.
- **`rv$cleaned_occurrence` is a list** — structure: `{df, source_counts, n_absent_excluded, original_rows}`. NOT a dataframe.
- **Numeric inputs can receive `Inf`/`NA`** — use `safe_numeric()` helper in `R/ui/ui_sidebar_controls.R` to sanitize values before passing to `numericInput()`.
- **`sdm_default_cv_block_size_km` is `NA_real_`** — UI defaults to 50 when NA.

## Key conventions

- **Climate source toggle:** `source = c("worldclim","chelsa")` — CHELSA v2.1 files use `bio1_1979-2013` naming (two-digit for bio1-9, single-digit for bio10-19); WorldClim uses `bio1.tif`. Set via `sdm_default_climate_source` in config or UI toggle.
- **biomod2 is gated:** Requires `options(sdm.enable_biomod2 = TRUE)` AND `requireNamespace("biomod2", quietly = TRUE)`. Never add to base packages.
- **Spatial-block CV fallback:** When `cv_strategy = "spatial_blocks"` but fewer than 5 occurrence points exist, `cv_folds.R` emits a warning and falls back to random k-fold.
- **Synthetic example:** `data/examples/synthetic_presence_data.csv` — safe to commit; real occurrence data must never be committed.
- **Lock file:** `renv.lock` pins R package versions. Use `renv::restore()` to recreate the environment on a new machine.

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

- `R/core/packages.R` defines `sdm_setup_packages` (core UI deps), `sdm_app_packages` (all modelling backends), and `sdm_optional_packages` (per-feature deps).
- Any package loaded via `library()` or `::` in app.R or R/ui_*.R **must be in `sdm_setup_packages`** to avoid first-launch install failures.
- `install_packages.R` uses `sdm_setup_packages`; `scripts/windows_setup.R` uses `sdm_app_packages`.

## CSS / UI conventions

- **Single dark mode system:** `body.sdm-dark` + CSS variables in `www/sdm-theme.css`. The old `body:not(.sdm-light)` duplicate system was removed.
- **CSS fallback:** `app.R` injects CSS inline via `tags$style()` as backup for the external `sdm-theme.css` link.
- **Status dot classes:** `.status-dot-ok`, `.status-dot-warn`, `.status-dot-error`, `.status-dot-unknown`.
- **Get Data tab classes:** `.gd-section-summary`, `.gd-section-summary-compact`, `.gd-section-icon`, `.gd-section-body`.

## Important file locations

- `R/core/bootstrap.R` — project root detection, path helpers
- `R/core/config.R` — all sdm_default_* constants
- `R/core/packages.R` — dependency lists, ensure_sdm_packages()
- `R/core/optimized_sdm.R` — engine loader, sources bootstrap + load.R
- `R/core/run_sdm.R` — run_fast_sdm() orchestration
- `R/core/sdm_config.R` — config object builder
- `R/data/occurrences.R` — cleaning, CoordinateCleaner integration
- `R/covariates/covariates_climate.R` — WorldClim/CHELSA download + load
- `R/covariates/covariates_stack.R` — combines climate + elevation + soil
- `R/covariates/download_helper.R` — background download helper (callr::r_bg)
- `R/covariates/future_projection.R` — future BIO layer swap and delta raster
- `R/models/model_glm.R` — primary model backend; random and spatial-block CV
- `R/models/prediction.R` — suitability raster prediction
- `R/output/report.R` — text report generation
- `R/output/report_odmap.R` — ODMAP standard report
- `R/ui/ui_sidebar_controls.R` — sidebar inputs
- `R/ui/ui_main_tabs.R` — tab layout
- `R/modules/mod_get_data.R` — Get Data tab server
- `R/modules/mod_model_run.R` — model run tab server
- `R/modules/mod_results.R` — results tab server
- `R/modules/mod_readiness.R` — readiness preflight checks

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
