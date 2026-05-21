# SDM Dashboard - Production Deployment

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your production values

# 2. Start all services
docker compose -f docker-compose.prod.yml up -d

# 3. Run database migrations
docker compose -f docker-compose.prod.yml exec api npm run db:migrate

# 4. Verify health
curl http://localhost/health
```

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
