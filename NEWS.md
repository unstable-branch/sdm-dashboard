# SDM Dashboard Changelog

## v0.5.0 (unreleased)

### Testing
- Expanded smoke test suite from basic parse checks to 42 test functions across 9 tag categories
- Phase 1: Core restructure — 70+ function assertions, CV strategy normalization, extent helpers, config builder, batch CSV parsing, EOO/AOO, CLIMEX response index, ODMAP report, manifest generation, VIF, calibration
- Phase 2: Model backend tests — GAM (AUC 0.929), ensemble (AUC 0.813), MaxNet, RF, XGBoost, DNN, biomod2 (graceful skip on missing deps)
- Phase 3: Ecology tests — dispersal, CLIMEX, climate matching, niche overlap, species richness, AOA (5 pass, 1 graceful skip)
- Phase 4+5: Covariate and reporting tests — WorldClim/CHELSA discovery, OpenTopo helpers, VIF selection, stack alignment, cache verification, summary reports, response curves, diagnostic plots, MESS/MOD, future projection helpers (18 tests, all pass)
- Phase 6: Core utility tests — CV folds, bioclim math (Hargreaves PET, GDD, moisture index), boundary registry, metrics helpers (AUC rank, Boyce index), ensemble importance, torch GPU detection, app helpers, validation (8 tests, all pass)
- CI integration: `--tags=fast` runs in <30s for PR checks; full suite covers fast+ml+ecology+covariates+reporting+core

### API
- Improved crash detection with proper 404 handling, grace period, and retry logic
- Set `startedAt` on sync-path run INSERT to enable grace period
- Decoupled queue worker from Plumber polling; added SSE-driven status sync
- Consolidated rate limiters; delegate filesystem operations to Plumber
- Fixed rate limit 429 errors and cancelled status handling in sync paths

### UI
- Fixed model dropdown labels showing NA — corrected `setNames` args and fallback field name
- Fixed model dropdown showing empty labels — use `spec$label` directly
- Fixed model dropdown merge approach — preserve defaults when API returns empty fields
- Replaced static hero badges with dynamic status-driven badges
- Moved dark/light theme toggle from sidebar to hero header
- Replaced hardcoded dark-mode CSS hex values with `--sdm-*` CSS variables

### Architecture
- Refactored monolithic `app.R` server into modular structure
- Removed root-level `optimized_sdm.R` compatibility shim
- Added all modules to explicit dependency ordering in `load.R`
- Added progress tracking to model fitting stages (PA replication, multi-ensemble, ESM)
- Added elapsed time, current stage, and full timestamps to run progress
- Comprehensive error handling and memory leak fixes

### Bug Fixes
- Fixed progress tracking broken — `[NA]%` in logs and wrong percentage extraction
- Fixed silent `try()` in `download_worldclim_layers`
- Fixed NULL extent crash in `load_climate_covariates`
- Fixed pattern matching on full paths in `verify_worldclim_cache`

### Models
- Added biomod2 adapter with gating strategy (`options(sdm.enable_biomod2 = TRUE)`)
- Registered 12 model backends: GLM, GAM, Rangebag, Ensemble, Multi-Ensemble (stable), MaxNet, ESM-GLM, ESM-MaxNet, RF, XGBoost, DNN, biomod2 (conditional)

