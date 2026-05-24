# SDM Dashboard Workbench

SDM Dashboard Workbench is a species distribution modelling platform with two deployment options:

- **Modern stack** (recommended): Next.js UI + Hono API + Plumber R engine + PostgreSQL, run via Docker Compose or locally for development
- **Legacy R/Shiny** (desktop): single-process R/Shiny app for local use

It provides multi-algorithm, multi-species SDM with occurrence cleaning, climate/environmental covariates, model fitting, evaluation, future projection, and a rich ecology toolkit.

This is a beta release. Interfaces, defaults, packaging, and outputs may change before a stable `v1.0.0` release. Validate model outputs carefully before operational use.

The public repository contains source code, documentation, scripts, templates, and small synthetic examples only. Real occurrence data, downloaded rasters, generated outputs, API keys, screenshots, and release archives should stay local.

Project direction is tracked in [`docs/SPEC.md`](docs/SPEC.md). The legacy desktop and future CRAN extraction policy is documented in [`docs/LEGACY_AND_CRAN.md`](docs/LEGACY_AND_CRAN.md).


## Quick Start (Modern Stack)

### Prerequisites

- **Node.js** 22+ and **pnpm** (`npm install -g pnpm`)
- **Docker** + **Docker Compose** (for backing services: PostgreSQL, Redis, Plumber, Garage)
- **R** 4.3+ is only needed inside the Plumber Docker container — not required on the host

### Full stack via Docker Compose

```bash
# 1. Clone the repository
git clone https://github.com/unstable-branch/sdm-dashboard.git
cd sdm-dashboard

# 2. Start all services
docker compose -f docker-compose.yml up

# Open http://localhost:3000
```

Services start in dependency order: **postgres** → **redis** → **garage** → **plumber** → **api** → **frontend**. Local compose starts Garage in single-node mode with a dev-only `sdm-artifacts` bucket and matching dev-only credentials, and the API container applies Drizzle migrations before starting the server. First startup may take several minutes while Docker builds the Plumber image.

### Local development

Run only the backing services in Docker, then develop the API and frontend on the host for fast hot-reload.

**Terminal 1 — Backing services:**

```bash
docker compose -f docker-compose.yml up postgres redis plumber garage -d
```

This starts:

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL + PostGIS | 5432 | Database |
| Redis 7 | 6379 | Queue + caching |
| Plumber R API | 8000 | SDM computation engine |
| Garage S3 | 3900 | Raster / artifact storage |

**Terminal 2 — API (Hono):**

```bash
cp api/.env.example api/.env   # if not present
cd api
pnpm install
env PLUMBER_INTERNAL_KEY=sdm-internal-key-change-in-production \
    JWT_SECRET=sdm-dev-secret-change-in-production \
    pnpm dev
```

Starts on `http://localhost:4000`. Health check: `curl http://localhost:4000/health`

**Terminal 3 — Frontend (Next.js):**

```bash
cd frontend
pnpm install
pnpm dev
```

Starts on `http://localhost:3000`, proxying API calls to port 4000.

**Database setup:**

After starting PostgreSQL for host-local development, run migrations from the API directory:

```bash
cd api
pnpm db:migrate
```

This creates all tables: `users`, `projects`, `api_keys`, `species`, `runs`, `occurrences`, `project_members`.

### First-time auth

Use the browser register/login screens at `http://localhost:3000/register` and `http://localhost:3000/login` for normal use.

For API-only testing, register a user:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@sdm.local","password":"yourpassword","name":"Your Name"}'
```

Or log in if already registered:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@sdm.local","password":"yourpassword"}'
```

Both return a `token` field that can be used with direct API requests:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/v1/projects
```

For API key usage from curl or scripts, pass the key as a header:

```bash
curl -H 'X-API-Key: test-key' http://localhost:4000/api/v1/sdm/runs
```


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

## Architecture

### Modern stack

```
Browser (Next.js 15, port 3000)
  ↓ HTTPS
API Gateway (Hono BFF, port 4000)
  ├── JWT / API Key auth middleware
  ├── Rate limiting (BullMQ/Redis)
  ├── CSRF protection
  └── Route handlers
       ↓ X-Hono-Internal + X-Forwarded-User
  Plumber R API (port 8000)
  ├── Auth gate (API key validation against PostgreSQL)
  ├── SDM computation
  └── Response proxies
       ↓
  PostgreSQL 16 + PostGIS  (users, projects, runs, species, occurrences)
  Redis 7 + BullMQ         (job queue, rate limiting)
  Garage S3                (raster storage, output artifacts)
```

### Legacy R/Shiny

The `app.R` in the project root is a single-process Shiny app for local desktop use. It runs on port 3838 with no built-in auth or API layer. The historical Shiny-first line is preserved on the `legacy-shiny` branch; the current `dev` branch keeps the desktop app available while making the modern stack the primary platform.

```
Browser ← Shiny (port 3838) ← R modules (91 modules via R/load.R)
```

## Project Structure

```
api/               Hono API (TypeScript, port 4000)
├── src/
│   ├── routes/        API route handlers
│   ├── middleware/     Auth, CSRF, rate-limit, cache
│   ├── services/       Plumber proxy, BullMQ queue, S3 storage, WebSocket
│   └── db/            Drizzle ORM schema + connection
├── drizzle/          SQL migration files
└── package.json

frontend/          Next.js 15 UI (TypeScript, port 3000)
├── src/
│   ├── app/          Page routes (app router)
│   ├── components/   React components
│   ├── services/     API client, types
│   ├── hooks/        WebSocket, job progress
│   └── stores/       Zustand state
└── package.json

plumber/           R/Plumber computation API (port 8000)
├── R/
│   ├── plumber.R     Endpoint definitions
│   ├── run_server.R  Server entry point with auth
│   └── auth.R        API key validation
└── Dockerfile

R/                 Legacy Shiny modules
├── core/           bootstrap, config, logging, run_sdm, pipeline stages
├── data/           occurrences, DwCA parsing
├── covariates/     climate, elevation, soil, future, etc.
├── models/         GLM, GAM, MaxNet, RF, XGBoost, ESM, DNN, JSDM, ensemble
├── ecology/        climate matching, EOO/AOO, AOA, niche overlap, etc.
├── ui/             header, sidebar, tabs, Leaflet plugins
├── modules/        Shiny modules (get_data, model_run, results, readiness)
├── output/         metrics, plots, reports, manifest, batch, script export
└── load.R          Module loader

packages/shared/   Shared TypeScript types (referenced by api + frontend)
├── src/index.ts
└── package.json

docker-compose.yml  Full-stack orchestration
```

## Environment Variables

### Modern stack

| Variable | Service | Purpose | Required? |
|----------|---------|---------|-----------|
| `DATABASE_URL` | api, plumber | PostgreSQL connection | Yes |
| `JWT_SECRET` | api | JWT token signing | Yes, for auth |
| `PLUMBER_INTERNAL_KEY` | api, plumber | Hono→Plumber auth handshake | Yes |
| `REDIS_URL` | api | Redis connection | Yes, for queue |
| `GARAGE_ENDPOINT` | api | S3 endpoint | Yes, for storage |
| `GARAGE_ACCESS_KEY` | api | S3 access key | Yes, for storage |
| `GARAGE_SECRET_KEY` | api | S3 secret key | Yes, for storage |
| `PORT` | api | API listen port (default 4000) | No |
| `PLUMBER_URL` | api | Plumber URL (default `http://localhost:8000`) | No |
| `PLUMBER_AUTH_DISABLED` | plumber | Skip Plumber auth gate (dev only) | No |

### Legacy R/Shiny

| Variable | Used for | Required? |
|----------|----------|-----------|
| `OPENTOPOGRAPHY_API_KEY` | Elevation downloads from OpenTopography | Yes, if using elevation covariate |

Create a `.Renviron` file in the project root to set R-specific variables. `.env` files are used for the Node.js stack. Both are git-ignored.

## Which Download

Most users should use the latest GitHub Release rather than cloning the repository once releases are published.

- Windows users (legacy Shiny): download `sdm-dashboard-vX.Y.Z-windows-ready.zip` from Releases, extract, then double-click `run_app_windows.bat`.
- Self-hosted platform users: use the release tag and Docker Compose files, or pull the GHCR images published by the release workflow.
- Developers: clone the repository or download `sdm-dashboard-vX.Y.Z-source.zip`.

Current beta source:

- Repository: `https://github.com/unstable-branch/sdm-dashboard`
- Legacy Shiny branch: `legacy-shiny`

Release and hosting policy is documented in `docs/RELEASE_AND_HOSTING.md`.

## CRAN Status

The current repository is not ready to submit to CRAN as-is. The modern platform includes web, Docker, database, queue, and object-storage services that do not belong in a CRAN package. A future CRAN track would extract a smaller pure-R modelling/core package from reusable functions after the modern beta release is stable. See [`docs/LEGACY_AND_CRAN.md`](docs/LEGACY_AND_CRAN.md).

## Legacy R/Shiny (Desktop)

### Local Run

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

### WSL2 Run

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

### Windows Run

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

## Docker (Legacy Shiny)

Build and run the legacy Shiny app with Docker:

```bash
docker build -t sdm-dashboard .
docker run --rm -p 3838:3838 sdm-dashboard
```

For the modern stack, use `docker compose -f docker-compose.yml up` instead.

## Interpretation Caveats

Outputs are habitat suitability or relative occurrence-support maps, not confirmed presence/absence maps. Results depend on occurrence quality, sampling bias, spatial extent, background sampling, covariate choice/resolution, model assumptions, and projection domain. Treat outputs as screening or decision-support products that require ecological review and independent validation before operational use.

## Privacy

- Do not commit real occurrence datasets unless they are explicitly public and redistribution is allowed.
- Do not commit API keys, `.Renviron`, `.env`, downloaded rasters, generated model outputs, logs, or screenshots with sensitive information.
- Keep templates and synthetic examples in `data/`; keep local working data at the project root or ignored cache/output folders.

## Verification

### Modern stack

```bash
# API health
curl http://localhost:4000/health

# Node platform checks
pnpm run check:node

# Compose validation
pnpm run check:compose
```

### Legacy R/Shiny

```bash
Rscript scripts/smoke_test.R
Rscript tests/testthat.R
Rscript scripts/audit_release.R
```

## Contributing And Citation

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CITATION.cff` for contribution, conduct, security/privacy, and citation guidance. The project is licensed under the MIT License.
