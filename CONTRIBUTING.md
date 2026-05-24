# Contributing

Thank you for improving SDM Dashboard Workbench. Contributions should keep the public repository lightweight, reproducible, and safe for users who work with sensitive occurrence data.

## Development Workflow

1. Create a focused branch for each change.
2. Keep app behavior changes separate from documentation, deployment, or release-scaffolding changes when practical.
3. Run from the project root so relative paths resolve consistently.
4. Prefer small, reviewable pull requests with a clear description of user impact and testing performed.

## Setup

Install R 4.3+ and packages used by the app:

```bash
Rscript install_packages.R
```

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
