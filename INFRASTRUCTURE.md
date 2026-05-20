# Infrastructure Setup

## Prerequisites

- **Node.js >= 22** — managed via `fnm` (Fast Node Manager)
- **Docker Compose** — for PostgreSQL/PostGIS, Redis, MinIO

## Quick Start

```bash
# Install fnm (if not already installed)
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc

# Use correct Node version (auto-detected from .node-version)
fnm use

# Install dependencies
cd packages/shared && npm install
cd ../../frontend && npm install
cd ../api && npm install
cd ../..

# Start infrastructure services
docker compose up -d

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
| MinIO | 9000 (API), 9001 (Console) | Raster file storage (S3-compatible) |
| R Plumber | 8000 | Computation API (model fitting, prediction) |
| Hono API | 4000 | BFF API (frontend proxy, data management) |
| Next.js Frontend | 3000 | Web UI |

## Environment Variables

See `api/.env` for configuration. Copy to `.env.local` for overrides.

```
DATABASE_URL=postgresql://sdm:sdm_password@localhost:5432/sdm_platform
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=sdm
MINIO_SECRET_KEY=sdm_minio_password
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
