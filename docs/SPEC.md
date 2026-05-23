# SDM Dashboard Workbench — Specification

## 1. Project Overview

**Type:** R/Shiny local desktop application for species distribution modelling (SDM).

**Core function:** Clean presence-only occurrence records, fit GLM (and experimental GAM/Rangebagging) presence/background models, generate habitat suitability maps, and export results — all from a local, privacy-first web dashboard.

**Repository:** https://github.com/5p00kyy/sdm-dashboard (upstream) | https://github.com/unstable-branch/sdm-dashboard (origin)

---

## 2. Architecture

### Entry points

| File | Purpose |
|------|---------|
| `app.R` | Shiny UI — main user-facing dashboard |
| `pipeline.R` | Non-interactive batch workflow |
| `launch_app.R` | Opens browser on launch |
| `R/core/optimized_sdm.R` | Engine loader → `R/load.R` |

### Module loader (`R/load.R`)

Sources all modules in dependency order. Each module is self-contained with no circular dependencies.

**Canonical order:**
```
bootstrap → config → packages → logging → validation
→ occurrences → covariates_climate → covariates_elevation
→ covariates_soil → covariates_stack
→ model_glm → model_gam → model_rangebag → model_ensemble → model_registry
→ prediction → future_projection → plots → report → run_sdm → app_helpers
```

**Extended order (available modules, loaded when present):**
```
biomod2_compat, boundary, metrics_binary, cv_folds, covariates_soilgrid,
model_biomod2, model_dnn
```

### Key modules

| Module | Responsibility |
|--------|---------------|
| `R/core/bootstrap.R` | Project root detection, path helpers |
| `R/core/config.R` | Global defaults, choices, `config` environment |
| `R/core/packages.R` | Package installation, core count, torch setup |
| `R/data/occurrences.R` | CSV/TSV reading, cleaning, thinning |
| `R/covariates_*.R` | WorldClim, elevation, soil layer loading |
| `R/covariates/covariates_stack.R` | Combines covariates into training raster stack |
| `R/models/model_glm.R` | GLM fitting, background sampling, CV (random + spatial-block) |
| `R/models/model_gam.R` | GAM backend (experimental) |
| `R/models/model_rangebag.R` | Rangebagging backend (experimental) |
| `R/models/model_ensemble.R` | Ensemble of GLM + Rangebagging (experimental) |
| `R/models/prediction.R` | Suitability map raster prediction |
| `R/covariates/future_projection.R` | Future climate BIO swap, delta raster export |
| `R/output/plots.R` | Map rendering with terra/ggplot2 |
| `R/output/report.R` | Text summary report generation |
| `R/core/run_sdm.R` | `run_fast_sdm()` — public orchestration API |
| `R/core/app_helpers.R` | UI helpers, extent resolution, formatting |

---

## 3. Functionality Specification

### Data inputs

- **Occurrence CSV/TSV** with `longitude`/`latitude` columns (and aliases: `lon`, `decimalLongitude`, etc.)
- **Synthetic demo** bundled at `data/examples/synthetic_presence_data.csv`
- Column detection for species name, source/provider, country code

### Occurrence cleaning

- Minimum records per source threshold (default: 15)
- Small source merging option
- Raster-cell thinning (coordinates sharing same climate cell)
- Distance-based thinning (user-specified km threshold)

### Climate covariates

- **WorldClim BIO layers** (1–19) at 10/5/2.5 arc-min resolution
- Download-and-cache via `geodata::worldclim_global()`
- User-specified cache directory

### Optional covariates

- **OpenTopography** elevation DEM (requires API key)
- **HWSD v2** soil GeoTIFF (user-provided path)
- **SoilGrids** (extended module, not yet integrated in app)

### Modelling backends

| Backend | Status | Notes |
|---------|--------|-------|
| GLM | **Stable** | Quadratic terms, weighted, spatial-block CV |
| GAM | Experimental | Behind model registry |
| Rangebagging | Experimental | Behind model registry |
| GLM + Rangebag ensemble | Experimental | Behind model registry |
| MaxEnt (maxnet) | Experimental | Direct via maxnet/glmnet, no Java required, regmult + features configurable |
| biomod2 | Experimental | Gated behind `getOption("sdm.enable_biomod2", FALSE)`, enable to use |
| DNN (cito/torch) | Dormant | Not wired, do not use |

### Cross-validation

- **Random k-fold** CV (default: 3-fold)
- **Spatial-block** CV with auto-calculated block size
- Metrics: AUC, TSS, sensitivity, specificity, Continuous Boyce Index (CBI), confusion counts
- Permutation importance (algorithm-agnostic, stored in result$variable_importance)

### Output products

- Suitability GeoTIFF (EPSG:4326)
- PNG preview map
- Cleaned occurrence CSV
- Text summary report
- ODMAP report (CSV + Markdown, Zurell et al. 2020)
- Reproducible R script export
- Sidecar raster bundle (when multiple models run)
- Future suitability GeoTIFF + current-to-future delta raster + MESS extrapolation rasters

### Projection

- Preset extents: Australia full/north/east, world, custom
- Custom boundary file upload (shp, kml, geojson, tif)
- Threshold slider (0.05–0.95)

---

## 4. UI Specification

### Control panel (left sidebar)

Sections (all collapsible):
1. **Display** — dark mode toggle
2. **Input data** — species label, data source, file upload
3. **Climate data** — WorldClim directory, resolution, BIO variable selection
4. **Optional covariates** — elevation, soil
5. **Modelling algorithms** — (extended modules, not yet in clean UI)
6. **Model settings** — backend, background points, thinning, quadratic, CV strategy
7. **Projection** — extent preset, threshold, future projection toggle

### Main panel (right, 9/12 width)

- **Dashboard tab** — suitability map + summary panel
- **Future projection tab** — future suitability + delta map
- **Observation records tab** — occurrence scatter + top sources table
- **Model diagnostics tab** — coefficient table + run log
- **Downloads tab** — all export buttons

### Theme

- bslib v5, bootswatch "flatly", primary `#0B6E69`
- Dark mode: body class `sdm-dark`, bg `#07111D`, accent `#4ADECB`
- Mobile-responsive: single-column below 991px

---

## 5. Configuration

All configuration lives in `R/core/config.R`:

| Variable | Default | Description |
|----------|---------|-------------|
| `sdm_default_biovars` | `c(1,4,6,12,15,18)` | Default BIO variables |
| `sdm_default_background_n` | `10000` | Background points |
| `sdm_default_cv_folds` | `3` | CV folds |
| `sdm_default_cv_strategy` | `"random"` | Random or spatial_blocks |
| `sdm_default_thinning_mode` | `"auto"` | auto/none/raster_cell/distance |
| `sdm_default_threshold` | `0.5` | Suitability threshold |
| `config$biomod2_default` | `c('GLM','RF','GBM','MAXNET')` | (extended) |
| `config$dnn_default` | `'DNN_Medium'` | (extended) |

Boundary files: `config$sdm_australia_boundary_path`, `config$sdm_world_boundary_path`

---

## 6. Verification & Testing

### Smoke test
```bash
Rscript scripts/smoke_test.R
```

### testthat
```bash
Rscript tests/testthat.R
```

### Release audit
```bash
Rscript scripts/audit_release.R
```

### Release builds
```bash
Rscript scripts/make_release_zip.R source --version=v0.3.0-beta
Rscript scripts/make_release_zip.R ready --version=v0.3.0-beta
```

---

## 7. Privacy & Security

- **Never** commit: real occurrence data, API keys, `.Renviron`, `.env`, downloaded rasters, model outputs, logs, screenshots, release zips
- **Always** review outputs before sharing (coordinates, paths, species names)
- API keys entered in app are session-only, never persisted

---

## 8. Dependencies

**Core (required):** `terra`, `shiny`, `bslib`

**Setup:** `geodata`

**Suggested:** `mgcv`, `testthat`

**Extended (loaded but optional):** `biomod2`, `randomForest`, `gbm`, `maxnet`, `nnet`, `mgcv`, `earth`, `rpart`, `mda`, `gam`, `xgboost`, `httr`, `jsonlite`, `cito`, `torch`, `reticulate`

---

## 9. Release History

| Tag | Date | Notes |
|-----|------|-------|
| `v0.1.0-beta` | — | First public beta |
| `v0.2.0-beta` | — | Dark UI, Australia-first view |
| `v0.3.0-beta` | target | Distance thinning, spatial-block CV, expanded diagnostics |

---

## 10. Known Issues & Limitations

- biomod2 backend requires `options(sdm.enable_biomod2 = TRUE)` to enable; not installed by default
- MaxEnt backend requires the maxnet package (`install.packages('maxnet')`); not installed by default
- Spatial-block CV is implemented for GLM only; experimental backends use their own default CV
- Future projection requires user-provided future BIO GeoTIFFs or automated CMIP6 download (planned)
- DNN models (cito/torch) are dormant and not wired to the app UI
- CoordinateCleaner is optional; requires `install.packages('CoordinateCleaner')` if use_cc = TRUE
- GBIF integration requires `install.packages('rgbif')` for data fetching