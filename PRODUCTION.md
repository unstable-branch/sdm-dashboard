# SDM Dashboard - Production Deployment

This deployment target is intended for self-hosted or private-team installations. The public open-source repo should remain generic and should not contain real occurrence data, generated rasters, API keys, deployment hostnames, or user uploads.

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with production values before starting services

# 2. Start all services
docker compose -f docker-compose.prod.yml up -d

# 3. Run database migrations
docker compose -f docker-compose.prod.yml exec api npm run db:migrate

# 4. Verify health
curl http://localhost/health
```

## Required Environment

Production compose fails closed when required secrets are missing.

| Variable | Purpose |
|----------|---------|
| `POSTGRES_PASSWORD` | Password for the bundled Postgres service |
| `DATABASE_URL` | Database connection string used by API and Plumber |
| `JWT_SECRET` | JWT signing secret for browser/API auth |
| `PLUMBER_INTERNAL_KEY` | Shared internal token for Hono API to Plumber requests |
| `GARAGE_ACCESS_KEY` | S3-compatible access key for Garage |
| `GARAGE_SECRET_KEY` | S3-compatible secret key for Garage |
| `GRAFANA_PASSWORD` | Grafana admin password |

Use different random values for `JWT_SECRET` and `PLUMBER_INTERNAL_KEY`. Keep `.env`, `ssl/`, backups, and volume data out of git.

## Architecture

```
nginx:80/443 → frontend:3000 (Next.js)
            → api:4000 (Hono/BullMQ)
            → ws:4000 (WebSocket)

api:4000 → postgres:5432 (PostGIS)
         → redis:6379 (BullMQ/caching)
         → plumber:8000 (R SDM engine)
         → garage:3900 (S3 storage)

prometheus:9090 → metrics collection
grafana:3000 → dashboards
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| nginx | 80/443 | Reverse proxy, SSL termination |
| frontend | 3000 | Next.js UI |
| api | 4000 | Hono BFF + BullMQ worker |
| postgres | 5432 | PostgreSQL + PostGIS |
| redis | 6379 | Queue + caching |
| plumber | 8000 | R SDM computation |
| garage | 3900 | S3-compatible storage |
| prometheus | 9090 | Metrics collection |
| grafana | 3001 | Monitoring dashboards |

## SSL/TLS

Place your certificates in `./ssl/`:
- `ssl/cert.pem` - Certificate
- `ssl/key.pem` - Private key

Update nginx.conf to use SSL:
```nginx
server {
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
}
```

For a public hostname, put this stack behind normal HTTPS termination and restrict admin surfaces. Do not expose Postgres, Redis, Garage admin APIs, Prometheus, or Grafana to the public internet without authentication and firewall rules.

## Release Images

The release workflow publishes container images to GitHub Container Registry when a `v*` tag is pushed:

- `ghcr.io/unstable-branch/sdm-dashboard/sdm-frontend:<tag>`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-api:<tag>`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber:<tag>`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-shiny:<tag>`

The compose files currently build from source by default. For a pinned production deployment, either check out the release tag before running compose or override the service definitions to use the matching GHCR images.

## Monitoring

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin / $GRAFANA_PASSWORD)

## Health Checks

All services have health checks. View status:
```bash
docker compose -f docker-compose.prod.yml ps
```

## Backup

```bash
# Database backup
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U sdm sdm_platform > backup.sql

# Garage S3 backup
docker compose -f docker-compose.prod.yml exec garage garage bucket export sdm-data ./backup/

# Restore database
cat backup.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U sdm sdm_platform
```

## Scaling

### Horizontal scaling (API)
```bash
docker compose -f docker-compose.prod.yml up -d --scale api=3
```

### Vertical scaling (Plumber/R)
Edit docker-compose.prod.yml:
```yaml
plumber:
  deploy:
    resources:
      limits:
        cpus: "4"
        memory: 8G
```

## Troubleshooting

```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f plumber

# Check service health
docker compose -f docker-compose.prod.yml ps

# Restart a service
docker compose -f docker-compose.prod.yml restart api

# Run migrations
docker compose -f docker-compose.prod.yml exec api npm run db:migrate
```
