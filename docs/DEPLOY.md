# SDM Dashboard — Deployment Guide

## Prerequisites

- **Node.js** 22+ and **pnpm** (`npm install -g pnpm`)
- **Docker** + **Docker Compose** (for backing services)
- **R** 4.3+ is only needed in the Plumber container — not on the host

## Quick Start

```bash
# Clone and enter
git clone https://github.com/unstable-branch/sdm-dashboard.git
cd sdm-dashboard

# Copy environment configuration
cp .env.example .env
cp api/.env.example api/.env

# Start PostgreSQL, Redis, and mailpit
docker compose -f docker-compose.dev.yml --profile core --profile email up -d

# Install dependencies
pnpm install

# Run database migrations
cd api && npx tsx src/db/migrate.ts && cd ..

# Start API (port 4000)
cd api && npx tsx --env-file=.env src/index.ts &

# Start frontend (port 3000)
cd frontend && pnpm dev &

# First-time: create an admin user
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@sdm.local","password":"Admin1234!","role":"admin"}'
```

## Docker Compose Profiles

Services are organized by profile to control resource usage:

| Command | Services | Use case |
|---------|----------|----------|
| `--profile core up -d` | postgres, redis | Local API/frontend dev |
| `--profile email up -d` | mailpit | Email inspection (port 5000) |
| `--profile storage up -d` | garage | S3-compatible storage |
| `--profile computation up -d` | plumber | R model backend |
| `--profile proxy up -d` | api, frontend | Full web stack |

Combine profiles: `--profile core --profile email up -d`

## Environment Variables

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `POSTGRES_PASSWORD` | `sdm_password` | No | PostgreSQL password |
| `JWT_SECRET` | auto-generated | Yes | JWT signing key (64-char hex) |
| `PLUMBER_INTERNAL_KEY` | auto-generated | Yes | Shared secret between Hono and Plumber |
| `SMTP_HOST` | — | Only for password reset | SMTP server hostname |
| `SMTP_PORT` | `587` | No | SMTP port |
| `SMTP_SECURE` | `true` | No | Use TLS for SMTP |
| `SMTP_FROM` | `noreply@sdm-dashboard.local` | No | From address for emails |
| `APP_URL` | — | Only for password reset | Public URL for email links |
| `REDIS_URL` | `redis://localhost:6379` | No | Redis connection string |
| `GARAGE_ACCESS_KEY` | `dev-access-key` | No | Garage S3 access key |
| `GARAGE_SECRET_KEY` | auto-generated | No | Garage S3 secret key |

## Production Deployment

### Docker Compose (full stack)

```bash
docker compose -f docker-compose.yml --profile full up -d
```

This starts all services: postgres, redis, garage, plumber, api, frontend.

### Health checks

- **API**: `http://localhost:4000/health` — returns Plumber + Redis status
- **API ready**: `http://localhost:4000/ready` — component readiness probe
- **Frontend**: `http://localhost:3000/` — SPA
- **Plumber**: `http://localhost:8000/health` — R backend
- **Mailpit**: `http://localhost:5000/` — email inspector UI

### Backups

```bash
# Database
docker compose exec postgres pg_dump -U sdm sdm_platform > backup.sql

# Uploads
tar czf uploads-backup.tar.gz data/uploads/

# Outputs
tar czf outputs-backup.tar.gz outputs/
```

## Image sizes

| Image | Size | Notes |
|-------|------|-------|
| `sdm-dashboard-plumber` | ~1.5 GB | R + geospatial packages |
| `sdm-dashboard-api` | ~350 MB | Node.js Hono server |
| `sdm-dashboard-frontend` | ~200 MB | Next.js standalone |
| `postgis/postgis:16-3.4` | ~850 MB | PostgreSQL + PostGIS |
| `redis:7-alpine` | ~58 MB | Job queue |
| `dxflrs/garage:v2.3.0` | ~100 MB | S3 storage |
| `axllent/mailpit:latest` | ~130 MB | Email inspector |

## Offline / air-gapped deployment

Climate data is cached locally and configurable via environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SDM_WORLDCLIM_DIR` | `Worldclim` | Current WorldClim BIO layers |
| `SDM_CHELSA_DIR` | `chelsa` | CHELSA v2.1 BIO layers |
| `SDM_FUTURE_WORLDCLIM_DIR` | `Worldclim_future` | CMIP6 future projections |
| `SDM_INTERNET_CHECK_ENABLED` | `true` | Set to `false` for offline |

Place correctly-named `.tif` files in the directories above. In the Shiny UI, uncheck "Auto-download missing BIO layers".

## Troubleshooting

### Database migrations not applied

```bash
cd api && npx tsx src/db/migrate.ts
```

Drizzle only applies migrations listed in `meta/_journal.json`. Extra `.sql` files are silently ignored.

### Plumber container won't start

Check R package installation logs. Build with verbose output:

```bash
docker compose build --progress=plain plumber
```

### Permissions errors on uploads

The container runs as UID 1000 (`sdm`). Bind-mounted directories need correct ownership:

```bash
chmod 777 data/uploads/ outputs/
```
