# SDM Dashboard — Jacob Contributor Roadmap

Prepared for Jacob / `mrcanofcatfood/sdm-dashboard`, based on review of his fork against upstream `5p00kyy/sdm-dashboard` and cross-checking the SDM methods/packages he is moving toward.

## 1. Executive summary

Jacob's direction is good. The fork is not random churn; it is converging on a real product vision:

> A local, reproducible R/Shiny species distribution modelling workbench for presence-only occurrence data, with transparent data cleaning, defensible modelling choices, projection-risk diagnostics, and exportable reports.

The issue is not the ideas. The issue is integration discipline. His current fork bundles too many independent concepts into one diverged branch, so it is hard to review, hard to test, and currently not mergeable as a single PR.

Current state observed:

- Fork `mrcanofcatfood/sdm-dashboard` is 28 commits ahead and 3 commits behind upstream.
- Upstream `5p00kyy/sdm-dashboard` `main` is green.
- Fork latest commit has failing GitHub Actions.
- A direct merge from fork `main` into upstream creates conflicts in 28 files.
- Local parse + smoke test pass, but the full test suite fails once missing test packages are installed.

Recommendation:

- Do **not** merge the fork wholesale.
- Do **salvage it by theme**, starting from fresh branches off upstream `main`.
- Each PR should implement one concept, include tests/docs/dependencies, and keep CI green.

## 2. Product north star

The dashboard should become a standards-aware SDM workbench, not a black-box model toy.

Core promise:

1. Import occurrence data safely.
2. Preserve raw records and provenance.
3. Clean and flag records transparently.
4. Load climate/covariate rasters reproducibly.
5. Fit simple, defensible models first.
6. Evaluate with appropriate metrics and cross-validation.
7. Warn when projections extrapolate outside calibration conditions.
8. Export maps, metrics, sidecars, and an ODMAP-style report.

Default user path should stay simple:

- Upload occurrence CSV.
- Choose species and extent.
- Use WorldClim bioclim variables.
- Fit GLM or MaxNet.
- Review AUC/TSS/CBI, response curves, MESS map, and report.

Advanced paths should be gated:

- biomod2 multi-algorithm modelling.
- ESM rare-species mode.
- multi-model ensembles.
- optional covariates beyond climate.
- batch processing.
- authenticated GBIF downloads.

## 3. Contributor rules for Jacob

These rules are what will turn exploration into mergeable work.

### Branching rule

Never work directly on fork `main` for upstream PRs.

Use this pattern every time:

```bash
git remote add upstream https://github.com/5p00kyy/sdm-dashboard.git  # once only
git fetch upstream
git switch -c feature/mess-diagnostics upstream/main
```

Then open a PR from `mrcanofcatfood:feature/mess-diagnostics` into `5p00kyy:main`.

### PR size rule

One PR = one idea.

Good PR:

- 2–8 files changed.
- One module or one UI slice.
- Tests included.
- README/METHODS docs included if user-facing.
- No generated rasters, caches, local paths, or fork-specific repo links.

Bad PR:

- Refactors app structure, adds models, changes docs, changes CI, and fixes unrelated bugs all at once.
- Pulls in generated files like `all_files.txt` or downloaded climate rasters.
- Changes defaults to experimental features before they are stable.

### Local gate before opening a PR

Run at minimum:

```bash
git diff --check
Rscript -e 'files <- list.files(pattern = "[.][Rr]$", recursive = TRUE, full.names = TRUE); for (f in files) parse(f); message("parsed ", length(files), " files")'
Rscript scripts/smoke_test.R
Rscript tests/testthat.R
Rscript scripts/audit_release.R
```

If the PR adds optional dependencies, the tests must skip cleanly when those packages are not installed.

### OpenCode / coding-agent prompt template

Use this when asking OpenCode/Minimax to implement a slice:

```text
You are working on sdm-dashboard. Start from upstream/main. Implement only this PR:

Goal: <one sentence>
Files allowed: <explicit file list>
Out of scope: no UI refactor, no generated files, no unrelated docs, no changes to defaults unless requested.
Acceptance:
- R source parses
- scripts/smoke_test.R passes
- tests/testthat.R passes
- add/adjust tests for this behavior
- update DESCRIPTION / R/packages.R only if dependencies actually changed
- update README/METHODS only for user-visible changes

Do not touch fork metadata, downloaded rasters, caches, or unrelated files.
```

## 4. Cross-referenced feature map

| Theme Jacob is exploring | Scientific / ecosystem basis | Roadmap position | Merge condition |
|---|---|---:|---|
| ODMAP reports | ODMAP was created to standardise SDM reporting across Overview, Data, Model, Assessment, Prediction. | Core | Report captures data source, cleaning, covariates, model parameters, validation, projection settings. |
| GBIF + Darwin Core Archive | `rgbif` is the R interface to GBIF; TDWG Darwin Core standardises biodiversity occurrence fields; `finch` parses DwC-A. | Core ingestion, staged | Raw data preserved; DOI/citation captured where available; cleaning flags exported. |
| CoordinateCleaner | Standard R package for automated occurrence QA: centroids, ocean, GBIF HQ, institutions, zero/invalid coords, outliers. | Core QA, optional dependency | Flag-only by default; never silently deletes records; test skips if package absent. |
| WorldClim / CHELSA | Both are standard climate data sources. WorldClim 2.1 provides 1970–2000 bioclim variables; CHELSA provides kilometre-scale climatologies/bioclim data. | Core + alternate climate source | Version, resolution, variable names, CRS/resampling, and source captured in metadata. |
| VIF / collinearity screening | Common SDM predictor-reduction step; flexsdm and similar workflows include collinearity reduction. | Core diagnostics | Transparent selected/dropped variables; user can override/keep variables for ecological reasons. |
| CBI / Boyce index | Presence-only evaluation metric; useful alongside AUC/TSS, especially when absences are pseudo/background. | Core metric | Handles ties, tiny samples, duplicate predictions, and returns documented NA/warnings when invalid. |
| MESS / extrapolation | Used to detect novel environmental conditions when projecting outside calibration domain. | Core projection safety | Produces MESS raster, per-variable novelty, percent extrapolated area, tests against synthetic rasters. |
| MaxNet | R-native MaxEnt-like model via `glmnet`; avoids Java MaxEnt. | Stable experimental backend | Feature classes + regularization exposed; tuning path documented; contract tests pass. |
| biomod2 | Mature ensemble platform for SDMs; supports multiple algorithms, CV, metrics, projections, reports. | Advanced/gated | Behind option or install check; component models, failures, weights, metrics inspectable. |
| ESM / ecospat | Ensembles of Small Models are relevant for rare/data-poor species, but validation is fragile. | Advanced rare-species mode | Explicit warnings; sample-size/predictor-count gates; reports high uncertainty and fold limitations. |
| Multi-model ensemble | Useful but can become algorithm salad. | Later advanced | Transparent model list, weights, failed models, uncertainty map, reproducible CV design. |
| Response curves + permutation importance | Good interpretability tools. | Core diagnostics after stable model contracts | Works for GLM/MaxNet first; optional for others. Exports plots + CSV. |
| Optional covariates: vegetation, drought, land cover, human footprint, UV, soil | Useful, but high risk for download/API/mismatch bugs. | Later, one covariate family per PR | Each module has metadata, cache rules, alignment tests, and no live-network CI requirement. |
| Batch processing | Operationally valuable for many species. | Later reproducibility layer | Sequential first; parallel later; per-species failures visible; manifest per run. |
| UI refactor / Leaflet maps | Good UX direction, but easy to destabilise. | After core modules are stable | Behaviour-preserving modularization first; then map features in separate PRs. |
| DNN / TensorFlow / Torch | Heavy optional dependency; weak first target for a local SDM tool. | Icebox | Only revisit after biomod2/MaxNet/ESM path is stable. |

## 5. Development roadmap

### Milestone 0 — Reset and contributor baseline

Goal: get Jacob working from clean branches and green CI.

#### PR 0.1 — Fork sync and hygiene

Purpose: create a clean branch from upstream `main`; do not attempt to merge fork `main`.

Tasks:

- Add upstream remote.
- Create feature branch from `upstream/main`.
- Remove generated/local artifacts from future PRs:
  - `all_files.txt`
  - downloaded `Worldclim/` rasters
  - local absolute paths
  - fork-specific README/CITATION links unless intentionally changed
- Confirm upstream baseline passes.

Acceptance:

- Branch diff is empty or only contributor docs.
- CI green.

#### PR 0.2 — Test/dependency discipline

Purpose: make future feature PRs reliable.

Tasks:

- Decide which packages are hard app dependencies vs optional advanced dependencies.
- Ensure `DESCRIPTION`, `R/packages.R`, and CI agree.
- Keep optional dependency tests skipped if package absent.
- Do not make `biomod2`, `ecospat`, `torch`, `CoordinateCleaner`, `rgbif`, or `finch` hard dependencies unless the upstream explicitly chooses that.

Acceptance:

- `tests/testthat.R` passes locally and in GitHub Actions.
- Tests do not fail because `skip_if_not_installed`, `expect_s3_class`, etc. are unavailable.
- New dependency policy documented in README or CONTRIBUTING.

### Milestone 1 — Core scientific reliability

This is the best place for Jacob to get early working PRs because it aligns with the strongest methods and is easiest to test.

#### PR 1.1 — MESS / MOD projection diagnostics

Purpose: safely tell users when projected suitability is outside training environmental space.

Scope:

- `R/extrapolation.R`
- `tests/testthat/test-extrapolation-mess.R`
- optional small docs in `METHODS.md`

Implementation notes:

- Avoid passing lists directly into `terra::app()`; combine SpatRasters into a SpatRaster stack first.
- Return:
  - `mess` raster
  - per-variable rasters
  - most dissimilar variable / MOD raster
  - percent extrapolated cells
  - training ranges
- Handle zero-range predictors cleanly.

Acceptance:

- Synthetic raster test proves below-range and above-range cells become negative MESS.
- Mismatched variable names produce a clear error.
- Projection output records MESS sidecar path.

#### PR 1.2 — Continuous Boyce Index hardening

Purpose: make presence-only evaluation more defensible.

Scope:

- `R/metrics_binary.R` or `R/metrics_helper.R`
- `tests/testthat/test-metrics-cbi.R`
- `METHODS.md`

Implementation notes:

- Define what happens for too few presences, no variation, duplicate suitability values, and all-NA predictions.
- Return `NA_real_` with a warning rather than fake precision when invalid.

Acceptance:

- Perfect separation, random predictions, counter-prediction, ties, and tiny-n cases tested.
- Metric interpretation is documented.

#### PR 1.3 — VIF / collinearity report

Purpose: reduce predictor collinearity without hiding ecological decisions.

Scope:

- `R/predictor_selection.R`
- tests
- small UI/report hook if already available

Implementation notes:

- Compute VIF on the accessible/background area, not an arbitrary full-world raster.
- Default threshold can be 10, but expose it as a parameter.
- Preserve a dropped-variable table with reason and VIF history.

Acceptance:

- Correlated synthetic variables are dropped deterministically.
- Zero-variance variables handled.
- Report lists selected and dropped predictors.

#### PR 1.4 — ODMAP report improvements

Purpose: make every run auditable.

Scope:

- `R/report_odmap.R`
- report tests
- README/METHODS

ODMAP minimum fields:

- Objective/species.
- Raw occurrence source and record count.
- Cleaning/filtering steps.
- Calibration/projection extent.
- Predictor source/version/resolution.
- Model backend and parameters.
- Background/pseudoabsence strategy.
- Cross-validation design.
- Metrics.
- Threshold rule.
- Projection/extrapolation diagnostics.
- Output file list.

Acceptance:

- CSV and Markdown/HTML reports generated in tests.
- Missing optional fields render as `not recorded`, not errors.

### Milestone 2 — Occurrence ingestion and provenance

#### PR 2.1 — Occurrence reader hardening

Purpose: make CSV/TSV upload robust before adding GBIF/DwC-A.

Scope:

- `R/occurrences.R`
- tests

Tasks:

- Detect common lon/lat column names.
- Validate coordinate range.
- Preserve original rows plus normalized `longitude`, `latitude`, `species`.
- Add clear errors for missing columns.

Acceptance:

- CSV, TSV, uppercase/lowercase coordinate columns tested.
- Bad coordinates produce clear warnings/errors.

#### PR 2.2 — CoordinateCleaner flag-only integration

Purpose: automated QA without silently deleting data.

Scope:

- `R/occurrences.R`
- tests
- optional UI checkbox later

Rules:

- If `CoordinateCleaner` is absent, show install hint and continue without flags.
- If present, add columns like `cc_flag`, `cc_reasons`.
- Do not drop flagged records by default.

Acceptance:

- Known bad points like `(0,0)` are flagged.
- Clean records remain.
- Report includes cleaning summary.

#### PR 2.3 — DwC-A upload support

Purpose: support GBIF/BioCASe-style archive uploads.

Scope:

- `R/occurrences_dwca.R`
- `R/occurrences.R`
- tests with tiny fixture archive

Rules:

- Use `finch` if installed; skip otherwise.
- Extract core fields only: species/scientificName, decimalLongitude, decimalLatitude, eventDate, basisOfRecord, coordinateUncertaintyInMeters, occurrenceID, datasetKey, institutionCode, collectionCode.
- Preserve DOI / dataset metadata where present.

Acceptance:

- Tiny fixture `.zip` parses.
- Missing optional metadata does not fail.
- Raw-to-cleaned row counts recorded.

#### PR 2.4 — GBIF public search

Purpose: let users fetch occurrence records without authenticated downloads.

Scope:

- `R/occurrences.R`
- tests using mocks, not live GBIF
- UI later

Rules:

- Use `rgbif::occ_search` for public records.
- Capture query parameters, timestamp, and GBIF citation guidance.
- Do not require a token for public search.

Acceptance:

- Mocked response converts to normalized occurrence table.
- Network failures are user-friendly.

#### PR 2.5 — Authenticated GBIF download — later

This should wait. Authenticated `occ_download` requires GBIF username/password/email and DOI handling. Prefer environment variables / `.Renviron`, not UI plaintext tokens.

### Milestone 3 — Climate and covariate foundations

#### PR 3.1 — Climate source abstraction: WorldClim and CHELSA

Purpose: support alternate climate source without breaking defaults.

Scope:

- `R/covariates_climate.R`
- tests
- docs

Rules:

- WorldClim remains default.
- CHELSA source must be explicit.
- Validate BIO1–BIO19 filename patterns.
- Record source, version, resolution, variable names.

Acceptance:

- WorldClim and CHELSA discovery both tested using dummy files.
- Missing BIO layers produce precise error message.

#### PR 3.2 — Future projection files and metadata

Purpose: make future climate projections reproducible and safe.

Scope:

- `R/future_projection.R`
- tests

Rules:

- Require exact matching variable names.
- Record GCM/scenario/year if supplied.
- Always pair future projection with MESS diagnostics.

Acceptance:

- Missing BIO files tested.
- Delta raster optional but tested.
- MESS sidecar recorded.

#### PR 3.3+ — Optional covariates one family at a time

Order recommended:

1. Elevation/terrain — most generally useful.
2. Soil — useful but harder to source/align.
3. Vegetation/NDVI — useful but remote-data-heavy.
4. Land cover/human footprint.
5. Drought/UV — later specialty covariates.

Each covariate PR must include:

- Source metadata.
- Cache path rules.
- CRS/resolution alignment tests.
- Clear no-network CI strategy.
- Report output.

### Milestone 4 — Model backend hardening

#### PR 4.1 — MaxNet backend contract and tuning path

Purpose: make MaxEnt-like modelling available without Java.

Scope:

- `R/model_maxnet.R`
- `R/model_registry.R`
- tests
- docs

Rules:

- Use `maxnet` as optional dependency.
- Expose feature classes and regularization multiplier.
- Do not pretend one default is universally optimal.
- Later: add tuning grid inspired by ENMeval-style workflows.

Acceptance:

- Fit/predict contract test passes.
- Prediction raster writes.
- Feature/regmult recorded in report.
- Package absence skips cleanly.

#### PR 4.2 — Response curves and permutation importance

Purpose: interpretability for fitted models.

Scope:

- `R/response_curves.R`
- `R/importance.R`
- tests
- report/download hooks later

Rules:

- Start with GLM and MaxNet.
- Export both plot and CSV.
- Treat correlated predictors cautiously in docs.

Acceptance:

- Synthetic model returns monotonic response when expected.
- Constant/noisy variables handled.

#### PR 4.3 — biomod2 adapter, gated

Purpose: advanced multi-algorithm modelling without destabilising default app.

Scope:

- `R/model_biomod2.R`
- `R/biomod2_compat.R`
- registry tests

Rules:

- Keep behind `options(sdm.enable_biomod2 = TRUE)` or explicit install check.
- Do not make biomod2 required for basic app.
- Record algorithms, CV, failed algorithms, variable importance, and ensemble options.

Acceptance:

- If package absent, registry omits biomod2 cleanly.
- If package present/enabled, contract tests fit and predict on small synthetic data.

#### PR 4.4 — ESM rare-species mode

Purpose: support rare/data-poor species with Ensembles of Small Models.

Scope:

- `R/model_esm.R`
- registry tests
- methods docs

Rules:

- Explicitly label as experimental/advanced.
- Recommend when occurrence count is low, but warn when validation is weak.
- Gate predictor count to avoid combinatorial explosion.
- Report number of bivariate models, kept/dropped pairs, weights, and uncertainty.

Acceptance:

- Requires `ecospat`/`biomod2`; skips if absent.
- Tiny synthetic tests validate contract without huge runtime.
- UI warning appears for low n / many predictors.

#### Icebox — DNN/Torch/TensorFlow

Do not prioritize this yet. It adds heavy dependency and operational complexity. If revisited later, use biomod2/cito or a separate advanced backend after the core scientific workflows are green.

### Milestone 5 — Ensembles without algorithm salad

#### PR 5.1 — Simple ensemble contract

Purpose: formalize how ensembles are represented.

Rules:

- Components list.
- Component metrics.
- Weights.
- Failed components.
- Uncertainty/disagreement raster when available.
- Same predict contract as single models.

Acceptance:

- Two simple components fit and predict.
- Weights sum to one.
- Failed component is reported, not silently swallowed.

#### PR 5.2 — Multi-model ensemble UI

Only after PR 5.1.

Rules:

- User selects components.
- App refuses ensemble with fewer than two valid components.
- biomod2 components hidden unless enabled.
- Experimental warning shown.

#### PR 5.3 — Ensemble reporting

Report:

- Which models ran.
- Which failed and why.
- Component AUC/TSS/CBI.
- Weighting scheme.
- Uncertainty/disagreement map.

### Milestone 6 — UX and Shiny app stability

#### PR 6.1 — UI module split, no behaviour changes

Purpose: make app maintainable.

Scope:

- Split `app.R` into `R/ui_header.R`, `R/ui_sidebar_controls.R`, `R/ui_main_tabs.R`.
- No new features in same PR.

Acceptance:

- Visual behaviour equivalent.
- Smoke test passes.
- No model/data logic moved into UI files.

#### PR 6.2 — Leaflet map diagnostics

Purpose: interactive review of occurrence and predictions.

Rules:

- Presence/background toggles.
- Suitability layer.
- MESS/extrapolation layer later.
- No crash when no result exists.

#### PR 6.3 — Cancel/progress state

Purpose: avoid stuck Run button and long-running UI confusion.

Rules:

- Reset running state on early return/error.
- Cancellation checkpoints in long operations.
- Clear logs.

### Milestone 7 — Reproducibility, script export, batch jobs

#### PR 7.1 — Run manifest

Purpose: every run should be reproducible.

Manifest should include:

- App version / git SHA if available.
- R version and package versions.
- Seed.
- Input file hashes.
- Occurrence cleaning summary.
- Covariate source/version/resolution.
- Model parameters.
- CV folds/strategy.
- Output paths.

#### PR 7.2 — Reproducible script export

Purpose: let users rerun a model outside Shiny.

Acceptance:

- Script uses recorded parameters.
- No absolute local paths unless user selected them.
- Script has comments for optional dependencies.

#### PR 7.3 — Sequential batch runner

Purpose: batch processing without parallel complexity first.

Rules:

- CSV config in, per-species output out.
- Per-species failure logs.
- Summary CSV.
- No hidden failure swallowing.

#### PR 7.4 — Parallel batch runner

Only after sequential runner passes.

Rules:

- Use `future` / `future.apply` optionally.
- Respect core limit.
- Deterministic seeds per species.
- Same outputs as sequential mode.

## 6. Suggested first five PRs for Jacob

These are the practical next steps that can produce actual mergeable work quickly.

### PR A — Fix MESS diagnostics

Why: scientifically important, already close, easy to test.

Files:

- `R/extrapolation.R`
- `tests/testthat/test-extrapolation-mess.R`
- `METHODS.md` small note

Do not touch UI.

### PR B — Harden CBI metric

Why: small and valuable.

Files:

- `R/metrics_binary.R` / `R/metrics_helper.R`
- `tests/testthat/test-metrics-cbi.R`
- `METHODS.md`

### PR C — ODMAP report completeness

Why: aligns with the strongest external standard.

Files:

- `R/report_odmap.R`
- `tests/testthat/test-report-odmap.R`
- `README.md` / `METHODS.md`

### PR D — CoordinateCleaner flag-only integration

Why: practical user value; clear optional dependency pattern.

Files:

- `R/occurrences.R`
- `tests/testthat/test-coordinatecleaner.R`
- docs

### PR E — DwC-A upload parser

Why: unlocks real GBIF download archives without needing API credentials.

Files:

- `R/occurrences_dwca.R`
- `R/occurrences.R`
- tests with tiny fixture archive
- docs

## 7. PR checklist template

Jacob can paste this into every PR description.

```markdown
## Summary
What does this PR add/fix?

## Scientific / user reason
Why does this matter for SDM users?

## Scope
Files changed:
- ...

Out of scope:
- ...

## User-visible behavior
What changes in the app or outputs?

## Tests
- [ ] R sources parse
- [ ] scripts/smoke_test.R passes
- [ ] tests/testthat.R passes
- [ ] Added/updated tests for this feature

## Dependencies
- [ ] No new dependency
- [ ] New optional dependency, with clean skip/install hint
- [ ] New hard dependency, documented in DESCRIPTION and installer

## Reproducibility/reporting
- [ ] Seed/parameters recorded where relevant
- [ ] Output/report metadata updated where relevant

## Screenshots / outputs
Attach if UI or report changed.

## Known limitations
What should reviewers know?
```

## 8. Reviewer acceptance standard

A PR is mergeable when:

1. It starts from current upstream `main`.
2. It has one clear purpose.
3. CI is green.
4. Tests prove the behavior.
5. Optional packages are optional in tests and runtime.
6. No generated files, local data, absolute paths, or unrelated refactors.
7. User-facing methods are documented.
8. Outputs are reproducible and inspectable.

## 9. Evidence and references used

- Zurell et al. 2020, ODMAP: standard protocol for reporting SDMs, DOI `10.1111/ecog.04960`.
- Hirzel et al. 2006, Boyce/CBI evaluation for habitat suitability models, DOI `10.1016/j.ecolmodel.2006.05.017`.
- CoordinateCleaner / Zizka et al. 2019, automated cleaning of occurrence records, DOI `10.1111/2041-210X.13152`.
- flexsdm paper/package: flexible SDM workflows including pre-modelling, collinearity reduction, partitions, ESM, DOI `10.1111/2041-210X.13874`.
- `maxnet` CRAN: R-native MaxEnt-like SDM using `glmnet`.
- `biomod2` CRAN/docs: ensemble SDM platform with multiple algorithms, CV, evaluation, ensemble projections, reports.
- `ecospat` CRAN: ecosystem/niche tools; imports biomod2/terra and supports ESM/Boyce-style workflows.
- `rgbif` docs: GBIF API access; authenticated downloads require GBIF username/password/email via environment configuration.
- TDWG Darwin Core: biodiversity occurrence data standard and Darwin Core Archives.
- `finch` CRAN/docs: parses Darwin Core Archives.
- WorldClim 2.1 docs: 1970–2000 bioclim variables at 30s–10m resolutions.
- CHELSA docs: kilometre-scale climate climatologies and bioclim datasets.

## 10. Bottom line

Jacob is aiming at the right target: a serious, transparent SDM workbench. The way to get there is not more giant commits. It is a ladder of small, reviewable PRs:

1. Scientific diagnostics first: MESS, CBI, VIF, ODMAP.
2. Data provenance next: CoordinateCleaner, GBIF/DwC-A.
3. Climate/covariate robustness after that.
4. Model backends once contracts are stable.
5. Ensembles, ESM, batch, and UI polish last.

If he follows that order, his fork becomes a source of steady upstream improvements rather than a permanent divergent prototype.
