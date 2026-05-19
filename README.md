# SDM Dashboard Workbench

SDM Dashboard Workbench is a local R/Shiny application for species distribution modelling from presence-only occurrence records. It provides a multi-algorithm, multi-species workbench with occurrence cleaning, climate/environmental covariates, model fitting, evaluation, future projection, and a rich ecology toolkit — all in one desktop-friendly workflow.

This is a beta release. Interfaces, defaults, packaging, and outputs may change before a stable `v1.0.0` release. Validate model outputs carefully before operational use.

The public repository contains source code, documentation, scripts, templates, and small synthetic examples only. Real occurrence data, downloaded rasters, generated outputs, API keys, screenshots, and release archives should stay local.


## Current Status

### Model Backends

| Backend | Status | Package | Description |
|---------|--------|---------|-------------|
| GLM | Stable | stats | Generalised linear model (default) |
| GAM | Stable | mgcv | Generalised additive model with spatial-block CV |
| MaxEnt (maxnet) | Stable | maxnet | Maximum entropy with tunable features & regularisation |
| Random Forest | Stable | ranger | Fast random forest with permutation importance |
| XGBoost/BRT | Stable | xgboost | Gradient boosted trees with feature importance |
| ESM-GLM | Stable | ecospat | Ensemble of small models (GLM pairs) |
| ESM-MaxNet | Stable | ecospat | Ensemble of small models (MaxNet pairs) |
| Multi-ensemble | Stable | — | Weighted combination of any stable backends |
| DNN | Conditional | cito + torch | Deep neural network (appears when both packages installed) |
| JSDM (HMSC) | Framework | Hmsc | Joint species distribution model for species interactions |
| Rangebag | Experimental | rangebag | Range bagging envelope model |
| biomod2 | Legacy | biomod2 | biomod2-managed MaxEnt (legacy integration) |

### Ecology Toolkit

- **Climate matching** — Mahalanobis, standardised Euclidean, and Euclidean distance maps for assessing site similarity to training conditions
- **EOO/AOO** — Extent of Occurrence (MCP) and Area of Occupancy (2×2 km grid) per IUCN Red List standards
- **AOA** — Area of Applicability via weighted dissimilarity (Meyer & Pebesma 2022)
- **Niche overlap** — Schoener's D, Hellinger's I, stability/unfilling/expansion (PCA density estimation)
- **Species richness** — Binary, probabilistic, or weighted stacking across multiple SDM outputs
- **Dispersal simulation** — Kernel-based range expansion from introduction points
- **CLIMEX import** — Mechanistic suitability from temperature/moisture response curves, combined with correlative SDM
- **Range size change** — Expansion/contraction metrics between current and future projections
- **Calibration plots** — Binned observed vs predicted (Pearce & Ferrier 2000)

### Modelling Features

- **PA replication** — Multiple background samples (N=5 default), averaged predictions for robustness
- **Spatial-block CV** — Random or spatial-block cross-validation; blockCV variogram-based blocks when available
- **VIF collinearity reduction** — Optional VIF filtering before model fitting
- **Bias correction** — Target-group or thickened background sampling
- **Hyperparameter tuning** — Grid search for MaxNet (regularisation × features) and GAM (k parameter)
- **Response curves** — Marginal and partial dependence plots
- **Permutation importance** — Algorithm-agnostic; ensemble importance weighted by component AUC
- **Multi-SSP comparison** — Run two future scenarios side-by-side with comparison metrics
- **Rapid response mode** — One-click auto-algorithm selection based on record count
- **Background model runs** — Non-blocking execution via callr; cancel button supported

### Data & Covariates

- WorldClim BIO climate layers with local download/cache
- Optional OpenTopography elevation (API key or `.Renviron`)
- Optional HWSD v2 soil covariates
- Optional NDVI, vegetation, UV, drought, human footprint, LULC, bioclim seasonality layers
- GBIF occurrence ingestion (public API or authenticated download with DOI capture)
- DwCA archive support with coordinate uncertainty filtering
- Occurrence cleaning: CoordinateCleaner, source summaries, raster-cell thinning, distance thinning, click-to-remove on map

### Outputs & Export

- Suitability GeoTIFF with LZW compression
- PNG preview, cleaned occurrence CSV, summary text report
- ODMAP standard report
- Reproducible R script export for all backends
- Structured run log with collapsible sections
- Run comparison table across multiple model runs
- Batch runner with summary table
- Future-climate projection with suitability, delta, and MESS extrapolation rasters
- Sidecar raster bundles (ensemble components, pair uncertainty, etc.)

### UI/UX

- Dark/professional dashboard with Australia-first map view
- Advanced sidebar toggle (hides expert settings by default)
- Compact header mode
- Persistent settings via localStorage (survives page refresh)
- Interactive Leaflet map with layer toggles
- Metric cards, readiness preflight, and model badges
- Windows launcher, command-line pipeline, Docker scaffold

## Project Structure

```
R/
├── core/          bootstrap, config, logging, run_sdm, pipeline stages
├── data/          occurrences, DwCA parsing
├── covariates/    climate, elevation, soil, future, NDVI, vegetation, etc.
├── models/        GLM, GAM, MaxNet, RF, XGBoost, ESM, DNN, JSDM, ensemble, registry
├── ecology/       climate matching, EOO/AOO, AOA, niche overlap, richness, dispersal, CLIMEX
├── ui/            header, sidebar, tabs, Leaflet plugins
├── modules/       Shiny modules (get_data, model_run, results, readiness)
├── output/        metrics, plots, reports, manifest, batch, script export
└── load.R         Module loader with subdirectory resolution
```

## Which Download

Most users should use the latest GitHub Release rather than cloning the repository.

- Windows users: download `sdm-dashboard-vX.Y.Z-windows-ready.zip` from Releases, extract, then double-click `run_app_windows.bat`.
- Developers and Linux/macOS users: clone the repository or download `sdm-dashboard-vX.Y.Z-source.zip`.

Latest beta release:

- Repository: `https://github.com/mrcanofcatfood/sdm-dashboard`

## Local Run

Install R 4.3+ and system libraries required by `terra`/GDAL on your platform, then run from the project root:

```bash
Rscript install_packages.R
Rscript app.R
```

Open the printed local URL, usually `http://127.0.0.1:3838`. To launch with browser-opening behavior, use:

```bash
Rscript launch_app.R
```

Run the non-interactive pipeline with:

```bash
Rscript pipeline.R
```

The pipeline uses `presence_data.csv` in the project root when present, otherwise it falls back to `data/examples/synthetic_presence_data.csv`.

## WSL2 Run

WSL2 does not have a GUI browser. The app runs inside WSL2 but you access it from your **Windows browser**.

**One-time setup** (from Windows PowerShell as Administrator):

```powershell
cd C:\path\to\sdm-dashboard-main
.\scripts\wsl_setup.ps1
```

**Every time you want to use the app:**

1. In WSL2 terminal: `Rscript app.R` — wait for "Listening on http://0.0.0.0:3838"
2. Get WSL2 IP: `hostname -I | awk '{print $1}'`
3. In Windows browser: `http://<WSL2-IP>:3838`

## Windows Run

On Windows, extract the Windows-ready zip and double-click:

```text
run_app_windows.bat
```

See `README_WINDOWS.md` for additional Windows notes.

## Data Inputs

Occurrence data must include longitude and latitude columns. Accepted names include:

- Longitude: `longitude`, `lon`, `decimalLongitude`, or `x`
- Latitude: `latitude`, `lat`, `decimalLatitude`, or `y`
- Optional source/provider: `source`, `institutionCode`, `provider`, or similar

Use `data/presence_data_template.csv` as the input template. Use `data/examples/synthetic_presence_data.csv` for first-run testing only; it is artificial and must not be interpreted as real occurrence evidence.

## Covariates

- **WorldClim**: selected BIO layers are downloaded/cached under `Worldclim/`. Cite and use WorldClim according to its terms before redistributing.
- **Elevation**: optional OpenTopography Global DEM. Set `OPENTOPOGRAPHY_API_KEY` or enter a key in the app. Keys are not saved by the app.
- **Soil**: optional HWSD v2 GeoTIFF at `covariates/hwsd_v2/HWSD_V2_SMU_selected.tif`.
- **Future climate**: optional projection from user-provided future BIO GeoTIFFs. Supports two SSP scenarios for comparison.
- **Extended covariates**: NDVI, vegetation, UV, drought, human footprint, LULC, bioclim seasonality (when data files are available).

Generated working folders such as `outputs/`, `checkpoints/`, `logs/`, `Worldclim/`, `Worldclim_future/`, and `covariates/` can contain large files or sensitive project data and are ignored by git.

## Docker

Build and run locally with Docker:

```bash
docker build -t sdm-dashboard .
docker run --rm -p 3838:3838 sdm-dashboard
```

Mount local working data only when needed. Do not bake private data or API keys into images.

## Interpretation Caveats

Outputs are habitat suitability or relative occurrence-support maps, not confirmed presence/absence maps. Results depend on occurrence quality, sampling bias, spatial extent, background sampling, covariate choice/resolution, model assumptions, and projection domain. Treat outputs as screening or decision-support products that require ecological review and independent validation before operational use.

## Privacy

- Do not commit real occurrence datasets unless they are explicitly public and redistribution is allowed.
- Do not commit API keys, `.Renviron`, `.env`, downloaded rasters, generated model outputs, logs, or screenshots with sensitive information.
- Keep templates and synthetic examples in `data/`; keep local working data at the project root or ignored cache/output folders.

## API Keys

| Variable | Used for | Required? |
|----------|----------|-----------|
| `OPENTOPOGRAPHY_API_KEY` | Elevation downloads from OpenTopography | Yes, if using elevation covariate |

Create a `.Renviron` file in the project root (or your home directory) to set them. The file `.Renviron` is git-ignored and must never be committed. After editing, restart R for the change to take effect. API keys entered via the Shiny UI take precedence over `.Renviron` values.

## Verification

Run the lightweight source checks:

```bash
Rscript scripts/smoke_test.R
Rscript tests/testthat.R
Rscript scripts/audit_release.R
```

## Contributing And Citation

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CITATION.cff` for contribution, conduct, security/privacy, and citation guidance. The project is licensed under the MIT License.
