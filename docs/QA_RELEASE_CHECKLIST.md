# Release Candidate Gate

Use this gate for every `v2` prerelease candidate. It is evidence for a release decision, not permission to publish. Stable `v2.0.0` remains reserved until every stable criterion below has been exercised and accepted.

## 1. Candidate identity and branch state

- [ ] `VERSION` contains the intended strict SemVer without the leading `v`.
- [ ] `api/package.json`, `frontend/package.json`, `packages/shared/package.json`, and `CITATION.cff` match `VERSION`.
- [ ] `CHANGELOG.md` has a dated candidate heading and no candidate changes remain only under `Unreleased`.
- [ ] Release notes cover features, fixes, breaking changes, schema/storage changes, accelerator support, known limitations, and rollback concerns.
- [ ] `dev` contains the intended candidate and has no unreconciled `main` commits.
- [ ] The release PR is `dev -> main`, CI is green, and the candidate tag will be created from the merged `main` commit.

Verify ancestry before the release PR:

```bash
git fetch origin main dev --tags
git merge-base --is-ancestor origin/main origin/dev
git rev-list --left-right --count origin/main...origin/dev
```

The first command must succeed. A nonzero left count means `main` has commits that must be merged back into `dev` by PR before promotion. Do not rebase either shared branch.

## 2. Automated gates

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
pnpm run check:accelerators
pnpm run check:release
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
actionlint
git diff --check
```

- [ ] Platform CI, R Quality Checks, Backend determinism, and Playwright are green for the exact candidate commit.
- [ ] `python3 scripts/audit_release_config.py vX.Y.Z-prerelease` passes after the local candidate tag is created.
- [ ] Production Compose renders with reviewed image digests and contains no app-service `build:` blocks.
- [ ] Source and Windows-ready zip dry-runs contain no secrets, data, caches, generated outputs, or maintainer-only files.

If a tool is unavailable locally, record that limitation and link the authoritative CI run. A missing gate is not silently treated as a pass.

## 3. Fresh install

Use a disposable host or VM with empty volumes and no local application images.

- [ ] Copy `deploy/images.env.example`, then replace all three digests from the workflow-produced `image-digests.txt`.
- [ ] Configure production secrets and TLS without committing them.
- [ ] Run `docker compose -f docker-compose.prod.yml pull` and then `docker compose -f docker-compose.prod.yml up -d --no-build`.
- [ ] Confirm PostgreSQL, Redis, Garage, Plumber, API, frontend, and nginx become healthy.
- [ ] Confirm the API entrypoint applies migrations on the empty database before serving.
- [ ] Register/login, create a project, and verify object-storage bootstrap and download paths.
- [ ] Confirm no service attempts a source build and `docker compose images` resolves the reviewed digests.

## 4. Upgrade and migration

Start from the most recent published prerelease with representative projects, users, API keys, occurrences, completed runs, and stored artifacts.

- [ ] Back up PostgreSQL, Garage/object storage, and generated outputs before changing image digests.
- [ ] Record the current image digests and schema migration state.
- [ ] Replace only the application image digests, then run `pull` and `up -d --no-build`.
- [ ] Confirm migrations complete once, services restart cleanly, existing login/API keys work, and old projects/runs/artifacts remain readable.
- [ ] Run one new workflow after migration and compare its manifest/provenance with the pre-upgrade baseline.
- [ ] Review every migration for forward/backward compatibility and destructive operations.

## 5. Rollback rehearsal

- [ ] Restore the previous reviewed image digests and restart with `--no-build`.
- [ ] If the candidate migration is not backward-compatible, stop services and restore the pre-upgrade database/object-storage backup before starting old images.
- [ ] Verify authentication, project listing, a historical result/download, and a new small run after rollback.
- [ ] Record rollback duration, commands, data-loss window, and any manual repair.

A candidate with no demonstrated rollback path is not stable-ready.

## 6. Real workflow QA

Run with synthetic or redistributable data only.

- [ ] Browser registration/login and API-key authentication.
- [ ] Project/species creation, occurrence upload, preview, cleaning, and persistence.
- [ ] At least one small GLM run from submission through progress, results, diagnostics, manifest, and download.
- [ ] A queued/cancelled run and a failed run with actionable error reporting.
- [ ] Climate/covariate availability and one future-projection path where test data permits.
- [ ] Existing completed runs remain readable after restart and upgrade.
- [ ] Desktop, laptop, tablet, and mobile UI checks show no critical clipping, overflow, or console errors.

## 7. Accelerator matrix

Each Plumber image is a distinct release artifact. Do not substitute one tag for all hardware paths.

- [ ] CPU: `sdm-plumber-cpu`, health/readiness, GLM workflow, and graceful DNN unavailability where optional dependencies are absent.
- [ ] CUDA: `sdm-plumber-cuda` plus `deploy/compose.cuda.yml` on a supported NVIDIA host, GPU status, a real accelerated model, and CPU fallback behavior.
- [ ] ROCm: `sdm-plumber-rocm` plus `deploy/compose.rocm.yml` on a supported AMD host, `torch.version.hip`, GPU status, and `scripts/smoke-rocm-model.R` or an equivalent real model workflow.
- [ ] Image names, SemVer tags, `sha-<commit>` tags, OCI labels, SBOM/provenance, and recorded digests all identify the same candidate commit.

Hardware paths require real compatible hosts. Static Compose checks alone do not qualify an accelerator image.

## 8. Release decision and post-release ancestry

- [ ] Review the draft release, zip checksums, five image digests, generated notes, and known limitations before publication.
- [ ] Do not publish if any required gate lacks evidence or an accepted written exception.
- [ ] After the release merge/tag, immediately open and merge a `main -> dev` reconciliation PR.
- [ ] Verify `git merge-base --is-ancestor origin/main origin/dev` succeeds before new feature work lands.

The reconciliation PR preserves the release merge/tag ancestry on `dev`; never replace it with a rebase or a force-push.
