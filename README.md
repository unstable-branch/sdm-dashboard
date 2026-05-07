# SDM Dashboard Workbench

SDM Dashboard Workbench is a local R/Shiny application for species distribution modelling from presence-only occurrence records. It combines occurrence cleaning, selected WorldClim BIO layers, optional elevation and soil covariates, GLM-based modelling, map export, and a compact text report in one desktop-friendly workflow.

This is a beta release. Interfaces, defaults, packaging, and outputs may change before a stable `v1.0.0` release. Validate model outputs carefully before operational use.

The public repository contains source code, documentation, scripts, templates, and small synthetic examples only. Real occurrence data, downloaded rasters, generated outputs, API keys, screenshots, and release archives should stay local.


## Current Status

Implemented and tested in the current beta:

- GLM presence/background workflow for presence-only occurrence records.
- Experimental GAM, Rangebagging, and GLM + Rangebagging ensemble backends behind the model registry.
- Occurrence cleaning, duplicate removal, source summaries, synthetic example data, raster-cell thinning, and deterministic distance thinning.
- Selected WorldClim BIO covariates with optional local download/cache.
- Optional OpenTopography elevation covariate.
- Optional local HWSD v2 soil covariate.
- GLM random or spatial-block cross-validation, with AUC, TSS, sensitivity, specificity, and confusion-count diagnostics.
- Exportable suitability GeoTIFF, PNG preview, cleaned occurrence table, summary report, and sidecar raster bundle when available.
- Optional model-aware future-climate projection from user-provided future BIO GeoTIFFs, including future suitability and delta rasters.
- Dark/professional dashboard presentation mode with an Australia-first workbench map view.
- Windows launcher, command-line pipeline, Docker scaffold, smoke tests, release audit, and testthat checks.

Planned research extensions, not integrated unless a later release explicitly says so:

- SoilGrids helper/download flow.
- Automated CMIP6 download/selection and multi-GCM averaging.
- Boundary/mask UI.
- Additional model backends such as biomod2-managed MaxEnt/maxnet, Random Forest, BRT/GBM, BART, NSDM, JSDM, or hybrid/mechanistic models.

Do not treat planned/experimental items as available until they have UI support, tests, and documentation.

## Features

- Shiny dashboard for occurrence CSV/TSV uploads or a bundled synthetic example dataset.
- Presence/background SDM workflow with configurable extent, threshold, thinning mode, cross-validation folds/strategy, and CPU use.
- WorldClim BIO climate layers with optional local download/cache.
- Optional OpenTopography elevation and local HWSD v2 soil covariates.
- Random or spatial-block GLM cross-validation with AUC, TSS, sensitivity, specificity, and confusion-count diagnostics.
- Exportable suitability GeoTIFF, PNG preview, cleaned occurrence table, summary report, and model sidecar raster bundle when available.
- Optional future-climate projection for matching BIO GeoTIFF scenarios, including suitability-change delta exports.
- Dark/professional presentation mode with an Australia-first map view and real Australia boundary overlay.
- Windows one-click runner, command-line pipeline, Docker scaffold, and lightweight checks for maintainers.

## Which Download

Most users should use the latest GitHub Release rather than cloning the repository.

- Windows users: download `sdm-dashboard-vX.Y.Z-windows-ready.zip` or `sdm-dashboard-vX.Y.Z-beta-windows-ready.zip` from Releases, extract it, then double-click `run_app_windows.bat`.
- Developers and Linux/macOS users: clone the repository or download `sdm-dashboard-vX.Y.Z-source.zip`.
- The source zip excludes generated outputs, private data, downloaded rasters, and caches.
- The Windows-ready zip may be larger because it can include the default WorldClim BIO layers for faster first launch.

Latest beta release:

- Repository: `https://github.com/5p00kyy/sdm-dashboard`
- Release tag: `v0.3.0-beta`
- Source asset: `sdm-dashboard-v0.3.0-beta-source.zip`
- Windows-ready asset: `sdm-dashboard-v0.3.0-beta-windows-ready.zip`

Previous beta release:

- Release tag: `v0.2.0-beta`
- Source asset: `sdm-dashboard-v0.2.0-beta-source.zip`
- Windows-ready asset: `sdm-dashboard-v0.2.0-beta-windows-ready.zip`

First public beta release:

- Release tag: `v0.1.0-beta`
- Windows asset: `sdm-dashboard-v0.1.0-beta-windows-ready.zip`
- Source asset: `sdm-dashboard-v0.1.0-beta-source.zip`

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

## Windows Run

On Windows, extract the Windows-ready zip and double-click:

```text
run_app_windows.bat
```

The helper locates R, installs missing packages, checks default WorldClim layers, and starts the app. See `README_WINDOWS.md` for additional Windows notes.

## Data Inputs

Occurrence data must include longitude and latitude columns. Accepted names include:

- Longitude: `longitude`, `lon`, `decimalLongitude`, or `x`
- Latitude: `latitude`, `lat`, `decimalLatitude`, or `y`
- Optional source/provider: `source`, `institutionCode`, `provider`, or similar

Use `data/presence_data_template.csv` as the input template. Use `data/examples/synthetic_presence_data.csv` for first-run testing only; it is artificial and must not be interpreted as real occurrence evidence.

## Covariates

- WorldClim: selected BIO layers are downloaded/cached under `Worldclim/` when requested. Cite and use WorldClim according to its terms before redistributing rasters or derived products.
- Elevation: optional OpenTopography Global DEM access. Set `OPENTOPOGRAPHY_API_KEY` or enter a key in the app. Keys are not saved by the app and should never be committed.
- Soil: optional HWSD v2 GeoTIFF at `covariates/hwsd_v2/HWSD_V2_SMU_selected.tif`. Check HWSD licensing and citation requirements before redistributing derived files.
- Future climate: optional projection uses a local folder such as `Worldclim_future/` containing future BIO GeoTIFFs with the same selected BIO variable numbers as the current-climate run. It reuses the fitted backend and static elevation/soil covariates, then exports future suitability and current-to-future delta rasters.

Generated working folders such as `outputs/`, `checkpoints/`, `logs/`, `Worldclim/`, `Worldclim_future/`, and `covariates/` can contain large files or sensitive project data and are ignored by git.

## Docker

Build and run locally with Docker:

```bash
docker build -t sdm-dashboard .
docker run --rm -p 3838:3838 sdm-dashboard
```

Or use Compose:

```bash
docker compose up --build
```

Mount local working data only when needed, for example with bind mounts for `Worldclim/`, `covariates/`, or `outputs/`. Do not bake private data or API keys into images. Hosted deployments need a Shiny-capable runtime such as Shiny Server, Posit Connect, shinyapps.io, or a container platform that can run the Shiny process.

## Interpretation Caveats

Outputs are habitat suitability or relative occurrence-support maps, not confirmed presence/absence maps. Results depend on occurrence quality, sampling bias, spatial extent, background sampling, covariate choice/resolution, model assumptions, and projection domain. Treat outputs as screening or decision-support products that require ecological review and independent validation before operational use.

## Privacy

- Do not commit real occurrence datasets unless they are explicitly public and redistribution is allowed.
- Do not commit API keys, `.Renviron`, `.env`, downloaded rasters, generated model outputs, logs, screenshots with sensitive information, or release zip files.
- Keep templates and synthetic examples in `data/`; keep local working data at the project root or ignored cache/output folders.
- Review generated reports and screenshots before sharing because coordinates, paths, and species names can be sensitive.

## Verification

Run the lightweight source checks:

```bash
Rscript scripts/smoke_test.R
Rscript tests/testthat.R
Rscript scripts/audit_release.R
```

Build release assets with explicit versions:

```bash
Rscript scripts/make_release_zip.R source --version=v0.3.0-beta
Rscript scripts/make_release_zip.R ready --version=v0.3.0-beta
```

## Contributing And Citation

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CITATION.cff` for contribution, conduct, security/privacy, and citation guidance. The project is licensed under the MIT License.
