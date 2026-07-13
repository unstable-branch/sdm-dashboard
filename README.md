# SDM Dashboard Workbench

SDM Dashboard Workbench is a beta species distribution modelling platform.

The current project has two supported surfaces:

- **Modern platform, recommended:** Next.js 16 frontend, Hono API, Plumber R computation service, PostgreSQL/PostGIS, Redis/BullMQ, Garage-compatible object storage, and Docker Compose.
- **Legacy desktop app:** the original local R/Shiny workflow, kept for single-user desktop use and for continuity with the mature R modelling code.

The modern platform is the primary release direction. The Shiny app remains available, but it is no longer the architecture driver for new platform work.

This is beta software. Interfaces, defaults, packaging, API contracts, storage layout, and outputs may still change before stable `v2.0.0`. Validate ecological outputs carefully before operational use.

The public repository should contain source code, documentation, templates, and small synthetic examples only. Keep real occurrence data, downloaded rasters, generated outputs, logs, screenshots, API keys, `.env`, `.Renviron`, and release archives out of git.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 22+ and pnpm for local development
- R is not required on the host for the modern Docker stack; R runs inside the Plumber container

### Start The Modern Stack

```bash
git clone https://github.com/unstable-branch/sdm-dashboard.git
cd sdm-dashboard

cp .env.example .env 2>/dev/null || true
cp api/.env.example api/.env 2>/dev/null || true

docker compose -f docker-compose.yml --profile full up
```

Open `http://localhost:3000`.

First startup can take several minutes while Docker builds the Plumber image and installs R geospatial packages. The API container applies database migrations before the server starts. Local compose starts Garage in single-node mode with development credentials and a development bucket.

For self-hosting a reviewed release, use `docker-compose.prod.yml` with the exact digests from `image-digests.txt`; production pulls images and must be started with `--no-build`. See [PRODUCTION.md](PRODUCTION.md).

Stop the stack with:

```bash
docker compose -f docker-compose.yml --profile full down
```

To remove local development volumes as well:

```bash
docker compose -f docker-compose.yml --profile full down -v
```

### First Workflow

1. Register a user in the browser.
2. Create a project.
3. Upload a CSV using `data/examples/synthetic_presence_data.csv` or `data/presence_data_template.csv`.
4. Review detected coordinates/species and cleaned records.
5. Configure a small model run.
6. Watch progress from the dashboard or run/results pages.
7. Review diagnostics, outputs, manifests, and downloads.

Synthetic examples are for smoke testing only. Do not interpret them as real occurrence evidence.

## Local Development

Install workspace dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

Start backing services in Docker:

```bash
docker compose -f docker-compose.yml up -d postgres redis garage plumber
```

Run the API:

```bash
cd api
pnpm dev
```

Run the frontend:

```bash
cd frontend
pnpm dev
```

Useful health checks:

```bash
curl http://localhost:4000/health
curl http://localhost:8000/health
```

## Verification

Run these before a release PR:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

Some local machines will not have the R spatial system dependency set needed for the R smoke/testthat gates. GitHub Actions installs that dependency set and is the release authority for those gates when local R cannot run them.

Platform CI also builds the modern service images, boots the stack, checks health, runs a Plumber memory/concurrency smoke, runs Playwright, and verifies the Plumber OpenAPI contract.

## Architecture

```text
Browser
  -> Next.js frontend
  -> Hono API/BFF
     -> PostgreSQL/PostGIS for users, projects, runs, species, occurrences
     -> Redis/BullMQ for queueing, rate limits, and cache
     -> Garage-compatible object storage for rasters and exports
     -> Plumber R API for SDM computation
        -> R modelling, covariate, ecology, diagnostics, and output modules
```

Important entry points:

| Path | Purpose |
| ---- | ------- |
| `frontend/` | Next.js dashboard UI |
| `api/` | Hono API, auth, Drizzle schema, queues, storage, Plumber proxy |
| `packages/shared/` | Shared TypeScript schemas and generated Plumber types |
| `plumber/` | R/Plumber API wrapper around modelling modules |
| `R/` | SDM modelling, covariate, ecology, output, and legacy Shiny modules |
| `app.R` | Legacy Shiny desktop entry point |
| `docker-compose.yml` | Main local modern stack |
| `docker-compose.dev.yml` | Development backing services |
| `docker-compose.prod.yml` | Self-hosted production stack |

## Documentation

- `docs/DEPLOY.md` - install, setup, compose profiles, production notes, troubleshooting
- `docs/SPEC.md` - current project shape, architecture, functional scope, limitations
- `docs/QA_RELEASE_CHECKLIST.md` - beta release-candidate checklist
- `docs/RELEASE_AND_HOSTING.md` - release channels, versioning, hosting policy
- `docs/LEGACY_AND_CRAN.md` - Shiny preservation and future CRAN extraction track
- `docs/METHODS.md` and `docs/INTERPRETATION.md` - modelling and interpretation notes

## Legacy R/Shiny Desktop

The legacy Shiny app is still available for local single-user workflows:

```bash
Rscript launch_app.R
```

It runs locally, usually at `http://localhost:3838`, and has no built-in multi-user auth or API layer. Treat it as a private desktop tool. Windows users should see `README_WINDOWS.md`.

The historical Shiny-first line is preserved on the remote `legacy-shiny` branch.

## CRAN Status

The current repository is not a CRAN package candidate. It includes a browser frontend, Node API, Docker Compose, PostgreSQL, Redis, Garage object storage, and Plumber service runtime. A CRAN path would be a future extraction of a smaller pure-R modelling/core package with portable dependencies and fast package-shaped tests.

See `docs/LEGACY_AND_CRAN.md`.

## Privacy

Do not commit:

- real occurrence datasets unless they are explicitly public and redistributable
- downloaded climate/covariate rasters
- generated GeoTIFFs, model outputs, logs, reports, release zips, or screenshots
- `.env`, `.Renviron`, SSL keys, API keys, service tokens, or local host details

## Contributing And Citation

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CITATION.cff`.

The project is licensed under the MIT License.
