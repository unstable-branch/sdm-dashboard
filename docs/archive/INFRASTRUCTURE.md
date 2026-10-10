# Infrastructure Setup

## Prerequisites

- **Node.js >= 22** — managed via `fnm` (Fast Node Manager)
- **Docker Compose** — for full-stack deployment
- **R >= 4.3** — for local Plumber development (optional, Docker handles this)

## Quick Start — Full Stack (Docker)

```bash
# Build and start all services (first time takes ~30 min for R packages)
docker compose up -d

# Wait for Plumber to finish installing R packages (check logs)
docker compose logs -f plumber

# Once healthy, access:
# Frontend: http://localhost:3000
# API: http://localhost:4000
# Plumber: http://localhost:8000
# Garage Web UI: http://localhost:3901
```

## Quick Start — Development (Docker + Local)

```bash
# Start only infrastructure + Plumber (local code mounted)
docker compose -f docker-compose.dev.yml up -d

# Start API locally
cd api && npm run dev

# Start frontend locally (another terminal)
cd frontend && npm run dev
```

## Quick Start — Manual (No Docker)

```bash
# Install fnm (if not already installed)
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc

# Use correct Node version (auto-detected from .node-version)
fnm use

# Install dependencies
cd packages/shared && pnpm install
cd ../../frontend && npm install
cd ../api && npm install
cd ../..

# Start infrastructure services
docker compose up -d postgres redis garage

# Run database migrations
cd api && npm run db:migrate

# Start API server
cd api && npm run dev

# Start frontend (in another terminal)
cd frontend && npm run dev
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL + PostGIS | 5432 | Species, runs, occurrences storage |
| Redis | 6379 | Job queue (BullMQ), caching |
| Garage (S3-compatible) | 3900 (API), 3901 (Web UI) | Raster file storage (AGPLv3, open-source) |
| R Plumber | 8000 | Computation API (model fitting, prediction) |
| Hono API | 4000 | BFF API (frontend proxy, data management) |
| Next.js Frontend | 3000 | Web UI |

## Environment Variables

See `api/.env.example` for configuration. Copy to `api/.env` for local overrides.

```
DATABASE_URL=postgresql://sdm:sdm_password@localhost:5432/sdm_platform
REDIS_URL=redis://localhost:6379
GARAGE_ENDPOINT=localhost:3900
GARAGE_ACCESS_KEY_ID=sdm
GARAGE_SECRET_KEY=sdm_garage_secret
GARAGE_BUCKET_RASTERS=sdm-rasters
GARAGE_BUCKET_EXPORTS=sdm-exports
PLUMBER_URL=http://localhost:8000
PORT=4000
```

## Without Docker

If Docker is not available, the API will start in degraded mode:
- Plumber service will show as "unreachable" in `/health`
- Database operations will fail until PostgreSQL is available
- File storage will use local filesystem fallback (TODO)

To run PostgreSQL locally without Docker:
```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib postgis
sudo -u postgres psql -c "CREATE USER sdm WITH PASSWORD 'sdm_password';"
sudo -u postgres psql -c "CREATE DATABASE sdm_platform OWNER sdm;"
sudo -u postgres psql -d sdm_platform -c "CREATE EXTENSION postgis;"
```

To run Garage locally without Docker:
```bash
# Download Garage binary from https://garagehq.deuxfleurs.fr/
garage server
```

## Why Garage?

Garage is an open-source (AGPLv3) S3-compatible object storage written in Rust.
It replaced MinIO in this project because MinIO changed to the SSPL license,
which is not approved by the Open Source Initiative (OSI).

Garage features:
- Lightweight single binary, no dependencies
- Designed for self-hosted and multi-node deployments
- Native S3 API compatibility
- LSM-tree storage engine for efficient writes
