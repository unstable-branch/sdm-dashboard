# Security And Privacy

SDM Dashboard is designed for local-first modelling. User-uploaded files, downloaded covariates, generated outputs, and API keys should remain on the user's machine unless the app is intentionally deployed to a server.

## Sensitive Data

- Occurrence records can reveal sensitive species locations, survey sites, landholder information, or unpublished research.
- Generated outputs and reports can contain coordinates, file paths, species names, and model summaries.
- Screenshots can expose local paths, uploaded file names, coordinates, or API keys.

Do not commit or publish private data, generated outputs, logs, screenshots with sensitive content, `.env`, `.Renviron`, or API keys.

## API Keys

OpenTopography elevation access may require `OPENTOPOGRAPHY_API_KEY`. Prefer environment variables or deployment secret stores. Never hard-code keys in source files, Docker images, Compose files, GitHub Actions, reports, or screenshots.

## Deployments

For public or shared deployments, assume uploaded files are sensitive. Use HTTPS, restrict access when appropriate, define retention/deletion policies for uploads and outputs, and avoid persistent shared storage unless users understand the risk.

Live deployments should use the digest-pinned production Compose stack (see docs/PRODUCTION.md) with operator-managed secrets, TLS, backups and access controls.

## Responsible Disclosure

If you discover a vulnerability or privacy issue, please do not open a public issue with exploit details or sensitive data. Contact the maintainers privately through the repository's security advisory/contact mechanism. Include a concise description, reproduction steps if safe, affected versions or files, and any suggested mitigation.
