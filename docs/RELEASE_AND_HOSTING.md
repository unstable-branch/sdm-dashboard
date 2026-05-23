# Release And Hosting Policy

## Position

SDM Dashboard Workbench should stay open source and self-hostable. The default public artifact is source code plus reproducible release packages. A hosted instance can exist for the project team or demos, but it should not become the only supported way to run the platform.

This matters because SDM workflows often involve sensitive occurrence data, unpublished survey records, local paths, API keys, and large generated rasters.

## Release Channels

| Channel | Audience | Artifact |
|---------|----------|----------|
| Source release | Developers and reviewers | Git tag plus `sdm-dashboard-<tag>-source.zip` |
| Windows-ready legacy Shiny | Desktop users | `sdm-dashboard-<tag>-windows-ready.zip` |
| Container images | Self-hosted platform users | GHCR images for frontend, API, Plumber, and legacy Shiny |
| Docker Compose | Operators | Version-pinned repo checkout or image override files |

The release workflow creates draft GitHub Releases for `v*` tags and pushes images to GitHub Container Registry.

## Versioning

Use semver with prerelease tags until the platform is stable:

- `v0.4.0-beta.1` for the first modern-platform beta release.
- `v0.4.0-beta.2` for fixes discovered during self-host testing.
- Reserve `v1.0.0` for a stable API/storage contract, migration policy, documented backups, and a tested self-host install path.

Tag releases from `main` after `dev -> main` CI is green.

## Main Branch Readiness

Before opening or merging the release PR:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

If the local machine cannot run the R gate because system libraries are missing, record that explicitly in the PR and rely on GitHub Actions for the R result.

## Self-Hosting

Use `docker-compose.prod.yml` for private/team deployments. Production compose requires explicit secrets:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `PLUMBER_INTERNAL_KEY`
- `GARAGE_ACCESS_KEY`
- `GARAGE_SECRET_KEY`
- `GRAFANA_PASSWORD`

Operators are responsible for TLS, backups, retention, user access, and firewalling admin surfaces. Do not expose Postgres, Redis, Garage admin ports, Prometheus, or Grafana publicly without access controls.

## Hosted Demo Guidance

A public demo should use synthetic or clearly redistributable data only. It should disable or constrain uploads, external API credentials, persistent user storage, and generated artifact retention unless the privacy model has been reviewed.

A private hosted instance for project collaborators is reasonable once production secrets, backups, TLS, and update procedure are documented for that host.

## Open-Source Repo Hygiene

Keep deployment-specific material outside the public repo:

- Real occurrence data and generated rasters
- `.env`, `.Renviron`, SSL keys, API keys, and service tokens
- Hostnames or infrastructure notes that are not meant as generic examples
- Release zip artifacts after they are generated locally
- Screenshots containing sensitive species, coordinates, users, or local paths
