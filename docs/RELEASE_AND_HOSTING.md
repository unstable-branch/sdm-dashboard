# Release And Hosting Policy

## Position

SDM Dashboard Workbench should stay open source and self-hostable. The default public artifact is source code plus reproducible release packages. A hosted instance can exist for the project team or demos, but it should not become the only supported way to run the platform.

This matters because SDM workflows often involve sensitive occurrence data, unpublished survey records, local paths, API keys, and large generated rasters.

## Release Channels

| Channel | Audience | Artifact |
|---------|----------|----------|
| Source release | Developers and reviewers | Git tag plus `sdm-dashboard-<tag>-source.zip` |
| Windows-ready legacy Shiny | Desktop users | `sdm-dashboard-<tag>-windows-ready.zip`; bundled WorldClim layers are included only when present in the release build tree |
| Container images | Self-hosted platform users | GHCR images for frontend, API, and separate CPU/CUDA/ROCm Plumber runtimes |
| Docker Compose | Operators | Digest-pinned production compose plus reviewed release digest manifest |

A strict SemVer `v*` tag on `main` triggers validation, publishes API/frontend plus separate CPU/CUDA/ROCm Plumber images, records their immutable digests, and assembles a review-only draft GitHub Release. It publishes no mutable `latest` or `stable` alias.

The normal platform CI gate and release workflow build the modern self-hosting images only: frontend, API, and the three Plumber hardware variants. The legacy Shiny app remains available through source, Windows-ready zip artifacts, and the `legacy-shiny` branch; it is not a blocking container-image gate for modern platform tags.

The historical Shiny-first code line is preserved on the `legacy-shiny` branch. Modern platform releases should still keep the desktop artifacts usable during beta, but the branch exists as the stable reference point for anyone who wants the old Shiny-only shape.

## Versioning

Use semver with prerelease tags until the modern platform is stable:

- `v0.x` and `v1.0.0` are the historical Shiny-first release line.
- `v1.0.0` is the final legacy Shiny release.
- `v2.0.0-beta.1` is the first modern-platform beta release.
- `v2.0.0-beta.2` and later beta tags are for fixes and rebaselines discovered during self-host and release-candidate testing.
- `v2.0.0-beta.4` is the current public-version baseline recorded by `VERSION`; later candidates must update all validated metadata together.
- Reserve stable `v2.0.0` for a stable API/storage contract, migration policy, documented backups, and a tested self-host install path.

The canonical public version is `VERSION`. The release workflow rejects a tag unless it matches `VERSION`, public Node package metadata, `CITATION.cff`, and a release heading in `CHANGELOG.md`. `DESCRIPTION` retains the independent legacy R/Shiny component version.

Tag releases from `main` only after `dev -> main` CI and the release-candidate checklist are green. After tagging, merge `main` back into `dev` by PR so release ancestry is retained.

The detailed `dev -> main` release-candidate plan is in `docs/DEV_MAIN_RELEASE_PLAN.md`.

## CRAN

Do not advertise the current platform as CRAN-ready. The full repository includes web, Docker, database, queue, and object-storage runtime surfaces. A CRAN submission should be treated as a future extraction of a smaller pure-R modelling/core package. See `docs/LEGACY_AND_CRAN.md`.

## Main Branch Readiness

Before opening or merging the release PR:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
pnpm run check:accelerators
pnpm run check:release
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

If the local machine cannot run the R gate because system libraries are missing, record that explicitly in the PR and rely on GitHub Actions for the R result.

## Self-Hosting

Use `docker-compose.prod.yml` for private/team deployments. The application services pull the exact digests supplied in `SDM_FRONTEND_DIGEST`, `SDM_API_DIGEST`, and `SDM_PLUMBER_DIGEST`; they never build from source. Select `SDM_PLUMBER_VARIANT=cpu`, `cuda`, or `rocm`. Start from `deploy/images.env.example` and copy values from the reviewed `image-digests.txt`. Production compose also requires explicit secrets:

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

Operators are responsible for TLS, backups, retention, user access, and firewalling admin surfaces. Do not expose Postgres, Redis, Garage admin ports, Prometheus, or Grafana publicly without access controls.

The local compose file starts Garage in single-node mode with a dev-only bucket so a fresh checkout can boot without manual object-storage setup. Production operators should provision Garage layout, keys, buckets, and backups deliberately before exposing the API. The API container applies Drizzle migrations at startup so empty self-hosted database volumes can bootstrap before workers and Plumber sync begin. Operators should still back up the database before upgrades.

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
