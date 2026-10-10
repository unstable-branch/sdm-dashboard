# Contributing

Thank you for improving SDM Dashboard. Contributions should keep the public repository lightweight, reproducible, and safe for users who work with sensitive occurrence data.

## Development Workflow

1. Create a focused branch from `dev` for each change.
2. Open a pull request into `dev`. CI must pass on the PR's latest commit before it can merge; direct pushes and force-pushes to `dev` and `main` are blocked.
3. Keep app behavior changes separate from documentation, deployment, or release-scaffolding changes when practical.
4. Run from the project root so relative paths resolve consistently.
5. Prefer small, reviewable pull requests with a clear description of user impact and testing performed.
6. Set your git identity to your GitHub account (or its noreply address) so commits are attributed correctly.

## Release Flow

Releases are cut by the maintainer:

1. On `dev`, bump `VERSION`, the package versions, `CITATION.cff` and `deploy/images.env.example`, and add a `CHANGELOG.md` heading. `pnpm run check:release` must pass.
2. Open a release pull request from `dev` into `main`. Only the maintainer merges into `main`.
3. Tag `vX.Y.Z-rc.N` on `main`. The release workflow publishes digest-pinned images and a draft pre-release for testing.
4. When testing passes, tag the same commit `vX.Y.Z`.

Choose the version by what changes for someone upgrading: breaking defaults, ports, auth, migrations or resource needs make it a major release. Never tag without bumping the version files.

## Setup

See the Development section of `README.md` (Docker, Node 22, pnpm). R is only needed on the host to run the R test suite; the pinned environment is in `renv.lock` (`renv::restore()`).

On Linux CI or servers, install GDAL/PROJ/GEOS/UDUNITS system libraries before installing `terra`.

## Testing

Run the lightweight smoke test before opening a pull request:

```bash
Rscript scripts/smoke_test.R
```

For modern platform changes, run:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
```

For app or modelling changes, also run the relevant UI locally with the synthetic example dataset and confirm exports still work. If your local R environment lacks spatial system libraries, note that in the PR and rely on GitHub Actions for the full R gate.

## Data And Privacy Expectations

- Do not commit private, licensed, embargoed, or sensitive occurrence records.
- Do not commit downloaded WorldClim, OpenTopography, HWSD, or other large covariate products.
- Do not commit generated outputs, logs, screenshots that expose sensitive data, `.env`, `.Renviron`, or API keys.
- Keep public examples synthetic or clearly licensed for redistribution.
- Document new external datasets with citation and license expectations.

## Code Guidelines

- Prefer minimal, readable changes that match the existing R style.
- Keep functions focused and avoid adding dependencies unless they are necessary.
- Handle missing external data and credentials with clear messages.
- Preserve local-first behavior: user uploads, caches, and outputs should remain on the user's machine unless a deployment explicitly changes that.

## Pull Request Checklist

- The smoke test passes or the reason it could not be run is documented.
- Public docs are updated for user-facing behavior changes.
- No local data, generated outputs, secrets, or large rasters are included.
- New dependencies or external services are documented.
