# Shared upload storage contract

The API resolves opaque input asset IDs to server-owned storage locators. A client must not supply a filesystem path, storage root, or root override.

## Upload root

Without `SDM_INPUT_ASSET_UPLOAD_ROOT`, the API uses `<SDM_PROJECT_ROOT>/data/uploads` and the worker uses `<app_dir>/data/uploads`. Those project roots must identify the same shared application tree.

A custom `SDM_INPUT_ASSET_UPLOAD_ROOT` must be an absolute, canonical path to a real readable directory. Set the same value in the API and Plumber processes and mount the same upload storage at that exact path in both services. Relative paths, dot or parent components, trailing separators, and symlink aliases are rejected. The API rejects noncanonical roots instead of accepting an asset that the worker cannot consume. The worker checks the root and file path components for symlinks before reading a target-group CSV.

This contract applies to the `uploads` root. It does not change the independently configured climate collection, boundary, or system roots.

An API-only environment override is not sufficient. Existing Compose upload mounts are not an automatic custom-root forwarding mechanism: a deployment using a custom root must explicitly provide matching environment values, mounts, access permissions, and a connected worker run.

## Acceptance boundaries

Default-root and canonical custom-root tests exercise the target-group adapter, production sampler and registered GLM fit. API tests separately check default/custom root resolution and denial of ambiguous or aliased roots. These tests do not establish a live authenticated API-to-worker dispatch, configured custom-root deployment, or worker-time current authorization and content-identity revalidation. Those remain separate runtime and deployment checks.
