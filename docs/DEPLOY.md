# Deployment Guide

This guide covers the modern SDM Dashboard Workbench platform. The legacy Shiny desktop app remains available through `app.R` and `README_WINDOWS.md`, but the modern Docker stack is the recommended beta deployment path.

## Prerequisites

- Docker and Docker Compose
- Node.js 22+ and pnpm for local development
- R is required only for host-local R development; the normal modern stack runs R inside the Plumber container

## Full Local Stack

Use this path for first-run testing, release-candidate QA, and local self-hosting experiments.

```bash
git clone https://github.com/unstable-branch/sdm-dashboard.git
cd sdm-dashboard

cp .env.example .env 2>/dev/null || true
cp api/.env.example api/.env 2>/dev/null || true

docker compose -f docker-compose.yml --profile full up
```

Open:

- Frontend: `http://localhost:3000`
- API health: `http://localhost:4000/health`
- Plumber health: `http://localhost:8000/health`
- Garage S3 API: `http://localhost:3900`

The first boot may take several minutes while the Plumber image installs R geospatial dependencies. The API container applies Drizzle migrations before starting, so an empty local database volume should bootstrap automatically.

Stop the stack:

```bash
docker compose -f docker-compose.yml --profile full down
```

Remove local volumes:

```bash
docker compose -f docker-compose.yml --profile full down -v
```

## Compose Profiles

`docker-compose.yml` uses profiles. Running `docker compose -f docker-compose.yml up` with no profile does not start the full platform.

| Profile | Services | Use |
| ------- | -------- | --- |
| `core` | postgres, redis | Database and queue only |
| `storage` | garage | Object storage |
| `computation` | plumber | R computation service |
| `proxy` | api, frontend | Web/API layer |
| `dev` | postgres, redis, garage, plumber, api, frontend | Local development stack |
| `full` | postgres, redis, garage, plumber, api, frontend | Full local modern stack |

Examples:

```bash
docker compose -f docker-compose.yml --profile core up -d
docker compose -f docker-compose.yml --profile dev up -d
docker compose -f docker-compose.yml --profile full up -d
```

You can also start named services directly:

```bash
docker compose -f docker-compose.yml up -d postgres redis garage plumber
```

## Host-Local Development

Run backing services in Docker:

```bash
docker compose -f docker-compose.yml up -d postgres redis garage plumber
```

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Run API:

```bash
cd api
pnpm dev
```

Run frontend:

```bash
cd frontend
pnpm dev
```

The frontend serves on `http://localhost:3000`; the API serves on `http://localhost:4000`.

If you start PostgreSQL manually or change database state outside the API container, run migrations from `api/`:

```bash
pnpm db:migrate
```

## Environment

For local development, use `.env` and `api/.env`. Do not commit either file.

The checked-in example files use local-only development values so the documented Docker Compose path can boot after copying them. Replace those values before any public deployment.

Important variables:

| Variable | Services | Purpose |
| -------- | -------- | ------- |
| `POSTGRES_PASSWORD` | postgres, api, plumber | Database password |
| `DATABASE_URL` | api, plumber | PostgreSQL connection string |
| `JWT_SECRET` | api | JWT signing secret |
| `PLUMBER_INTERNAL_KEY` | api, plumber | Internal Hono to Plumber auth secret |
| `DATA_ENCRYPTION_KEY` | api | 64-character hex key for API-side occurrence-file encryption |
| `SDM_ENCRYPTION_KEY` | plumber | R/Plumber occurrence-file encryption key; local beta setups may use the same generated value as `DATA_ENCRYPTION_KEY` |
| `REDIS_URL` | api | Redis/BullMQ connection |
| `GARAGE_ENDPOINT` | api | S3-compatible endpoint |
| `GARAGE_ACCESS_KEY` | garage, api | S3 access key |
| `GARAGE_SECRET_KEY` | garage, api | S3 secret key |
| `GARAGE_RPC_SECRET` | garage | Garage cluster RPC secret |
| `GARAGE_ADMIN_TOKEN` | garage | Garage admin token |
| `GARAGE_BUCKET` | garage, api | Local default bucket for the single-node stack |
| `GARAGE_BUCKET_RASTERS` | api | Raster bucket |
| `GARAGE_BUCKET_EXPORTS` | api | Export bucket |
| `FRONTEND_URL` | api | Browser-facing frontend URL |
| `APP_URL` | api | Public app URL for emails/links |
| `SMTP_*` | api | Optional password-reset email settings |

`PLUMBER_DOCS_ENABLED=true` should be used only for development or CI contract extraction. Production should leave Plumber OpenAPI docs disabled.

## Production Compose

Use `docker-compose.prod.yml` for self-hosted production-style deployments. Unlike the local source stack, production Compose has no application `build:` blocks. It pulls frontend, API, and the selected CPU/CUDA/ROCm Plumber image by exact digest.

Start with `deploy/images.env.example`, copy the reviewed values from the draft release `image-digests.txt`, and run:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-build
```

Production compose intentionally fails closed if required image digests or secrets are absent. Provide real values for:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `PLUMBER_INTERNAL_KEY`
- `GARAGE_ACCESS_KEY`
- `GARAGE_SECRET_KEY`
- `GARAGE_BUCKET_RASTERS`
- `GARAGE_BUCKET_EXPORTS`
- `GARAGE_RPC_SECRET`
- `GARAGE_ADMIN_TOKEN`
- `GRAFANA_PASSWORD`
- `SDM_FRONTEND_DIGEST`
- `SDM_API_DIGEST`
- `SDM_PLUMBER_DIGEST`
- `SDM_PLUMBER_VARIANT` (`cpu`, `cuda`, or `rocm`)

Operators are responsible for:

- TLS termination
- host firewalling
- database and object-storage backups
- retention policy for generated rasters/exports
- user access review
- upgrade and rollback procedure

Do not expose Postgres, Redis, Garage admin, Prometheus, or Grafana publicly without access controls.

## Backups

Example database backup:

```bash
docker compose -f docker-compose.yml --profile full exec postgres \
  pg_dump -U sdm sdm_platform > sdm-platform.sql
```

Back up object storage and generated outputs according to the storage backend used for the deployment. Local development volumes are not a substitute for a production backup plan.

## Offline Data

Climate and covariate data can be cached locally. Common directories:

| Directory | Purpose |
| --------- | ------- |
| `Worldclim/` | Current WorldClim BIO layers |
| `Worldclim_future/` | Future climate projections |
| `chelsa/` | CHELSA layers |
| `covariates/` | Local covariate files |

These folders can be large and are git-ignored.

## Troubleshooting

### `docker compose up` starts nothing

Use a profile:

```bash
docker compose -f docker-compose.yml --profile full up
```

### API health fails

Check service logs:

```bash
docker compose -f docker-compose.yml --profile full logs api postgres redis plumber garage
```

Confirm migrations ran before API startup and that `DATABASE_URL`, `JWT_SECRET`, and `PLUMBER_INTERNAL_KEY` are set.

### Plumber health fails

Check Plumber logs:

```bash
docker compose -f docker-compose.yml --profile full logs plumber
```

The first local source build is large because R geospatial packages are installed in the image. Production should pull reviewed digests instead of building.

### OpenAPI type generation fails

OpenAPI docs are disabled unless `PLUMBER_DOCS_ENABLED=true` is present in the Plumber container environment. CI uses a compose override for this. The JSON spec is served at:

```text
http://localhost:8000/openapi.json
```

### Playwright says port 3000 is already used

The Docker stack may already be serving the frontend. The test config is expected to reuse an existing server when one is present.
