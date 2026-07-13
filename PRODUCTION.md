# SDM Dashboard - Production Deployment

This deployment target is intended for self-hosted or private-team installations. The public open-source repo should remain generic and should not contain real occurrence data, generated rasters, API keys, deployment hostnames, or user uploads.

## Quick Start

Use the exact image digests from the reviewed draft release. Production Compose never builds the application services.

```bash
# 1. Configure secrets and immutable release images
cp .env.example .env
cat deploy/images.env.example >> .env
# Replace every CHANGEME and REPLACE_WITH_RELEASE_DIGEST value.
# Copy digests from image-digests.txt and choose cpu, cuda, or rocm.

# 2. Pull and start without a source build
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-build

# 3. Verify health and resolved images
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml images
curl http://localhost/health
```

The API image runs Drizzle migrations before starting the server. Back up the database and object storage before every upgrade; do not run an extra migration command concurrently.

## Required Environment

Production compose fails closed when required secrets or application digests are missing.

| Variable | Purpose |
|----------|---------|
| `SDM_FRONTEND_DIGEST` | Reviewed `sha256:...` digest for `sdm-frontend` |
| `SDM_API_DIGEST` | Reviewed `sha256:...` digest for `sdm-api` |
| `SDM_PLUMBER_VARIANT` | `cpu`, `cuda`, or `rocm` |
| `SDM_PLUMBER_DIGEST` | Digest for the matching Plumber variant |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Bundled Postgres password and application connection string |
| `JWT_SECRET`, `CSRF_SECRET` | Browser/API authentication secrets |
| `DATA_ENCRYPTION_KEY`, `SDM_ENCRYPTION_KEY` | Encryption-at-rest keys |
| `PLUMBER_INTERNAL_KEY` | Shared Hono-to-Plumber token |
| `GARAGE_ACCESS_KEY`, `GARAGE_SECRET_KEY` | S3-compatible credentials |
| `GARAGE_BUCKET_RASTERS`, `GARAGE_BUCKET_EXPORTS` | Explicit object-storage buckets |
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` | Garage cluster/admin secrets |
| `GRAFANA_PASSWORD` | Grafana admin password |

Keep `.env`, `ssl/`, backups, and volume data out of git. Use different random values for unrelated secrets.

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

A validated SemVer tag publishes five GHCR repositories:

- `ghcr.io/unstable-branch/sdm-dashboard/sdm-frontend`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-api`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cpu`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cuda`
- `ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-rocm`

Each build receives SemVer, exact `v...`, and immutable `sha-<commit>` tags plus OCI source/version/revision metadata, SBOM, and provenance. The workflow deliberately publishes no `latest` alias. `image-digests.txt` in the draft release is the deployment authority; copy the selected `name@sha256:...` values into `.env`.

CPU is the production default. CUDA and ROCm require their documented host device access and real-hardware release-candidate tests. Add the matching no-build runtime overlay:

```bash
# NVIDIA: set SDM_PLUMBER_VARIANT=cuda and its matching digest
docker compose -f docker-compose.prod.yml -f deploy/compose.cuda.yml up -d --no-build

# AMD: set SDM_PLUMBER_VARIANT=rocm, its digest, and host video/render GIDs
docker compose -f docker-compose.prod.yml -f deploy/compose.rocm.yml up -d --no-build
```

## Upgrade And Rollback

1. Back up PostgreSQL, Garage/object storage, and generated outputs.
2. Record the current `.env` digest values and migration state.
3. Replace only the three application digest values, then run `pull` and `up -d --no-build`.
4. Verify migrations, authentication, historical runs/downloads, and one new real workflow.
5. To roll back, restore the previous digests. If migrations are not backward-compatible, restore the matching database/object-storage backup before starting old images.

Use `docs/QA_RELEASE_CHECKLIST.md` for the required rehearsal and evidence.

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
docker compose -f docker-compose.prod.yml up -d --no-build --scale api=3
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

# Migrations run in the API entrypoint; inspect startup logs
docker compose -f docker-compose.prod.yml logs api
```
