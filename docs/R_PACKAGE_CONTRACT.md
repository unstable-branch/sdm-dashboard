# R package contract

The repository-level R 4.5.0 `renv.lock` is the reproducible base for its locked local R profile. `scripts/check_renv_imports.py` checks that every non-base package declared in `Depends`, `Imports`, or `LinkingTo` has a lock record. Its self-test covers inline, continued, and empty DCF fields; it does not claim that every source reference belongs in this profile or that `renv::status()` is synchronized.

The Plumber images have a separate build contract: their Dockerfiles install `plumber/install-runtime-packages.R` from a dated Posit Package Manager repository (the CPU/CUDA images use R 4.4.2; ROCm uses R 4.6.1). Those image-specific package sets are not restored from this R 4.5.0 lock. Packages preinstalled by an image are not evidence that their source paths were tested by the repository-level restore, and this lock does not pin or validate those image builds.

## Supported Plumber API runtime additions

| Packages | Contract and evidence |
|---|---|
| `pool`, `RPostgres`, `uuid` | Hard Imports and locked runtime dependencies. `plumber/R/run_server.R` loads `pool` during server startup; `plumber/R/db_pool.R` needs `RPostgres` for configured PostgreSQL connections; the supported boundary-upload path in `plumber/R/helpers/boundary_helpers.R` calls `uuid::UUIDgenerate()`. |
| `targets` | Hard Import and locked read-side dependency for existing Targets job status/results: `plumber/R/helpers/models_helpers.R` calls `targets::tar_meta()` when a stored `_targets` directory exists. New Targets execution remains unavailable (503); the lock entry does not enable job creation. |

Other API dependencies already recorded in the lock remain unchanged. A locked version is not, by itself, proof that each supported API endpoint or deployment image was exercised.

## Batch / Targets boundary

The legacy `scripts/batch_run.R` exits immediately with `TARGETS_DURABLE_EXECUTION_UNAVAILABLE`, before loading `optparse` or dispatching to Targets. This matches the modern API's HTTP 503 boundary for new Targets-backed execution. `targets` remains locked only for read-only inspection of existing stored jobs; it does not enable submissions. `optparse`, `tarchetypes`, and `geotargets` are not required by the supported base paths. Do not infer that `--no-targets` re-enables the disabled CLI.

## Optional and development profile boundary

The following packages remain outside the repository-level lock's base profile. Their source paths are feature-specific, optional, or test/development-only; they are not hard dependencies for every core run. The current Plumber Docker build preinstalls many feature packages from its dated PPM snapshot, but that separate image path does not add them to this lock or prove their feature paths were verified here. A feature-specific environment must declare and lock its own dependency closure and be verified before that feature is advertised as supported.

| Boundary | Packages | Source evidence |
|---|---|---|
| Optional model backends and tuning | `biomod2`, `brms`, `cmdstanr`, `dbarts`, `earth`, `ecospat`, `ENMeval`, `gbm`, `gllvm`, `glmnet`, `INLA`, `maxnet`, `mda`, `unmarked`, `xgboost` | `R/models/model_registry.R` conditionally registers backends when optional packages are installed; `R/models/enmeval.R` retains metric helpers but only defines the ENMeval-backed tuner when ENMeval exists. `install_packages.R` treats special integrations such as INLA as optional. |
| Provider, format, or Python/GEE integrations | `arrow`, `finch`, `galah`, `httr`, `rgbif`, `rgee` | Python model registration is conditional on `arrow`; `read_dwca()` guards `finch`; GBIF operations guard `rgbif`; ALA access uses `galah` when present and `httr` for its HTTP path; GEE helpers require both `rgee` and initialized credentials. These are not required for API startup or the core GLM path. |
| Optional cleaning, Redis, explainability, test tooling | `CoordinateCleaner`, `fastshap`, `mockery`, `redux` | Coordinate cleaning defaults off and warns when the optional package is absent; SHAP helpers return an unavailable result without `fastshap`; Redis degrades to a no-op without `redux`; `mockery` is test/development-only. |

This is an explicit base-versus-optional boundary, not a claim that every listed feature has its own completed profile. Until such profiles are separately locked and verified, do not run their source paths as though the primary lock covered them. `renv::status()` is still expected to report source-scanned dependencies outside the primary profile; this contract does not suppress or waive that result.
