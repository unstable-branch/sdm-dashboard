# AGENTS.md — SDM Dashboard Workbench

## Git workflow

This repo uses a two-step integration flow:

```
feature branch -> dev -> main
```

- `main` is the stable branch. Do not push directly to `main`. It should move only by PR from `dev` after CI passes.
- `dev` is the integration branch. It should stay mostly working, but it is allowed to move faster than `main`.
- Bigger work happens on feature branches, then PRs into `dev`.
- Small docs/CI fixes may go straight to `dev` only when the change is low risk and the owner explicitly asked for it.
- Never rewrite shared branch history after pushing. No force-push to `main` or `dev`.
- Commit locally at logical checkpoints: a bug fixed, a feature working, a refactor complete, or a test added.
- Avoid committing broken states to `dev` or `main`. WIP belongs on a feature branch.

Branch names should use GitHub handles or short repo-local aliases, then the topic:

- `mrcanofcatfood/obs-records-table`
- `5p00kyy/ci-cleanup`
- `mrcanofcatfood/gbif-import`
- `5p00kyy/release-audit`

Use conventional commit prefixes:

- `feat:` user-facing feature
- `fix:` bug fix
- `test:` tests or fixtures
- `docs:` documentation only
- `refactor:` internal restructure without behavior change
- `chore:` maintenance/tooling

PR targets:

- Feature/fix PRs target `dev`.
- Release/stabilization PRs target `main` from `dev`.
- If two people need the same files, split the work first or agree who owns that file slice.
- Keep PRs reviewable. Prefer several focused PRs over one giant mixed UI/model/docs/test change.

Before opening a PR:

1. Rebase or merge the latest target branch.
2. Run at least the smoke test or explain why it could not run.
3. Check `git diff --stat` for accidental large/binary/generated files.
4. Summarize user-visible behavior, test coverage, and known limitations.

## Run commands

```bash
# Fast syntax check
Rscript -e 'files <- list.files(path = c("R", "scripts", "tests"), pattern = "[.][Rr]$", recursive = TRUE, full.names = TRUE); for (f in files) parse(f); parse("app.R"); parse("pipeline.R"); parse("launch_app.R")'

# Smoke test (always run before PR)
Rscript scripts/smoke_test.R

# Full testthat suite
Rscript tests/testthat.R

# Release/public bundle audit
Rscript scripts/audit_release.R

# Install dependencies
Rscript install_packages.R
```

If local R is unavailable, rely on GitHub Actions and say that local R was unavailable in the PR/check notes.

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
- **Leaflet proxy groups must match render groups** — if `renderLeaflet()` uses group names like `clean` and `flagged`, proxy add/remove calls must use the same names.
- **Reactive values can hold lists** — inspect structure before assuming a dataframe. `rv$cleaned_occurrence` is list-shaped.
- **Do not use remote/CDN assets casually** — Shiny should remain usable locally/offline where possible. Add JS/CSS dependencies deliberately.

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
- Real occurrence datasets, downloaded rasters, generated outputs, logs, API keys, and screenshots must not be committed.
- `AGENTS.md` is allowed to be tracked, but release/source bundles must exclude it.

## Development priorities

- Keep the app usable for local desktop work first. Web/deployment polish is secondary unless explicitly scoped.
- Scientific outputs need honest labels: experimental, optional, skipped, failed, or validated. Do not imply a model/backend is production-ready because a UI control exists.
- Optional packages must fail gracefully with clear install hints and skipped tests.
- Prefer simple, inspectable R modules over broad rewrites. If a feature touches UI, model code, tests, and release scripts, split it unless the coupling is real.
- Preserve reproducibility: seeds, selected covariates, model id, thresholds, extents, and output paths should be recorded in reports/manifests where relevant.

## Review posture

For code review, prioritize:

- runtime crashes and Shiny reactive mistakes;
- incorrect SDM/statistical claims;
- broken CI/test assumptions;
- generated or private files accidentally tracked;
- mismatches between UI labels and actual backend behavior;
- large mixed commits that should be split before merge.

Do not accept a PR just because it is visually impressive. Check that it starts, the relevant workflow works, and CI passes.

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
