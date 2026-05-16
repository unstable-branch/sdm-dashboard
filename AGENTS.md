# AGENTS.md — SDM Dashboard Workbench

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

- **Entry point:** `app.R` (Shiny UI). Orchestration engine: `R/run_sdm.R` → `run_fast_sdm()`.
- **Module loader:** `R/load.R` sources 32 canonical modules in fixed dependency order, then auto-sources any extra `R/*.R` files not in the list. Current extras: `biomod2_compat.R`, `model_biomod2.R`, `model_dnn.R`, `torch_setup.R`, `ui_header.R`, `ui_main_tabs.R`, `ui_sidebar_controls.R`, `covariates_climate_future.R`, `download_helper.R`, `app_helpers.R`.
- **Config:** `R/config.R` sets project-wide defaults; secrets must not be added here.
- **Path resolution:** `app.R` resolves `app_dir` from `--file=` arg or `sys.frames()`, not `getwd()`. All paths use `file.path(app_dir, ...)`.

## Boot-up process

```
app.R
  → source R/bootstrap.R → sdm_set_project_root(app_dir)
  → source R/optimized_sdm.R → source R/load.R → 32 canonical modules + extras
  → source R/ui_header.R, R/ui_sidebar_controls.R, R/ui_main_tabs.R
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
- **`callr::r_bg` runs in a separate process** — `<<-` on Shiny reactives inside `verify_fun` has no effect. Use `download_covariate_bg()` with `init_engine = TRUE` to source modules in the child process.
- **`rv$cleaned_occurrence` is a list** — structure: `{df, source_counts, n_absent_excluded, original_rows}`. NOT a dataframe.
- **Numeric inputs can receive `Inf`/`NA`** — use `safe_numeric()` helper in `R/ui_sidebar_controls.R` to sanitize values before passing to `numericInput()`.
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

- `R/packages.R` defines `sdm_setup_packages` (core UI deps), `sdm_app_packages` (all modelling backends), and `sdm_optional_packages` (per-feature deps).
- Any package loaded via `library()` or `::` in app.R or R/ui_*.R **must be in `sdm_setup_packages`** to avoid first-launch install failures.
- `install_packages.R` uses `sdm_setup_packages`; `scripts/windows_setup.R` uses `sdm_app_packages`.

## CSS / UI conventions

- **Single dark mode system:** `body.sdm-dark` + CSS variables in `www/sdm-theme.css`. The old `body:not(.sdm-light)` duplicate system was removed.
- **CSS fallback:** `app.R` injects CSS inline via `tags$style()` as backup for the external `sdm-theme.css` link.
- **Status dot classes:** `.status-dot-ok`, `.status-dot-warn`, `.status-dot-error`, `.status-dot-unknown`.
- **Get Data tab classes:** `.gd-section-summary`, `.gd-section-summary-compact`, `.gd-section-icon`, `.gd-section-body`.

## Important file locations

- `R/optimized_sdm.R` — engine loader (not at root)
- `R/bootstrap.R` — project root detection, path helpers
- `R/occurrences.R` — cleaning, CoordinateCleaner integration
- `R/covariates_stack.R` — combines climate + elevation + soil into training raster
- `R/model_glm.R` — primary model backend; random and spatial-block CV
- `R/prediction.R` — suitability raster prediction
- `R/future_projection.R` — future BIO layer swap and delta raster export
- `R/download_helper.R` — background download helper with polling/verification
- `R/app_helpers.R` — `fmt_num()`, `safe_numeric()`, `metric_card()`, extent helpers

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
