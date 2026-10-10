# R package contract

The repository-level R 4.5.0 `renv.lock` is the reproducible base for its declared local R profile. `scripts/check_renv_imports.py` independently requires every non-base package declared in root `Depends`, `Imports`, or `LinkingTo` to have a lock record; its self-test covers inline, continued, and empty DCF fields. `renv::status()` is also an acceptance gate: after an exact restore, `status$synchronized` must be `TRUE` for this base profile. The versioned `renv/settings.json` narrows renv's source scan to the declared profile by explicitly ignoring optional/development package references; this does not weaken the hard-dependency checker. The lock also records hard transitive dependencies of locked packages, including `sodium` imported by `plumber`.

The Plumber images have a separate build contract: their Dockerfiles install `plumber/install-runtime-packages.R` from a dated Posit Package Manager repository (the CPU/CUDA images use R 4.4.2; ROCm uses R 4.6.1). Those image-specific package sets are not restored from this R 4.5.0 lock. Packages preinstalled by an image are not evidence that their source paths were tested by the repository-level restore, and this lock does not pin or validate those image builds.

## Supported Plumber API runtime additions

| Packages | Contract and evidence |
|---|---|
| `pool`, `RPostgres`, `uuid` | Hard Imports and locked runtime dependencies. `plumber/R/run_server.R` loads `pool` during server startup; `plumber/R/db_pool.R` needs `RPostgres` for configured PostgreSQL connections; the supported boundary-upload path in `plumber/R/helpers/boundary_helpers.R` calls `uuid::UUIDgenerate()`. |
| `targets` | Hard Import and locked read-side dependency for existing Targets job status/results: `plumber/R/helpers/models_helpers.R` calls `targets::tar_meta()` when a stored `_targets` directory exists. New Targets execution remains unavailable (503); the lock entry does not enable job creation. |

Other API dependencies already recorded in the lock remain unchanged. A locked version is not, by itself, proof that each supported API endpoint or deployment image was exercised.

## Batch / Targets boundary

The batch CLI denies its default Targets-backed route with `TARGETS_DURABLE_EXECUTION_UNAVAILABLE` before loading `optparse` or Targets, parsing configuration, changing cluster environment variables, creating output paths, or dispatching. The exact `--no-targets` flag preserves the legacy `future_lapply` route; that optional route uses the legacy parser and requires `optparse`, which is not part of the base lock. `--help` reports both facts without loading optional packages. `targets` remains locked only for read-only inspection of existing stored jobs; it does not enable submissions. `tarchetypes` and `geotargets` remain unnecessary for supported base paths. Do not infer that the default CLI route is enabled.

## Optional and development profile boundary

The following packages remain outside the repository-level lock's base profile. Their source paths are feature-specific, optional, or test/development-only; they are not hard dependencies for every core run. The current Plumber Docker build preinstalls many feature packages from its dated PPM snapshot, but that separate image path does not add them to this lock or prove their feature paths were verified here. A feature-specific environment must declare and lock its own dependency closure and be verified before that feature is advertised as supported.

| Boundary | Packages | Source evidence |
|---|---|---|
| Optional model backends and tuning | `biomod2`, `brms`, `cmdstanr`, `dbarts`, `earth`, `ecospat`, `ENMeval`, `gbm`, `gllvm`, `glmnet`, `INLA`, `maxnet`, `mda`, `unmarked`, `xgboost` | `R/models/model_registry.R` conditionally registers backends when optional packages are installed; `R/models/enmeval.R` retains metric helpers but only defines the ENMeval-backed tuner when ENMeval exists. |
| Provider, format, or Python/GEE integrations | `arrow`, `finch`, `galah`, `httr`, `rgbif`, `rgee` | Python model registration is conditional on `arrow`; `read_dwca()` guards `finch`; GBIF operations guard `rgbif`; ALA access uses `galah` when present and `httr` for its HTTP path; GEE helpers require both `rgee` and initialized credentials. These are not required for API startup or the core GLM path. |
| Optional cleaning, Redis, explainability, test tooling | `CoordinateCleaner`, `fastshap`, `mockery`, `redux` | Coordinate cleaning defaults off and warns when the optional package is absent; SHAP helpers return an unavailable result without `fastshap`; Redis degrades to a no-op without `redux`; `mockery` is test/development-only. |
| Batch CLI parser | `optparse` | Used only by the exact legacy `scripts/batch_run.R --no-targets` route; optional and deliberately absent from the base lock. The Targets-backed default is denied before the parser loads. |
| Disabled Targets batch path | `tarchetypes`, `geotargets` | References belong to the unavailable Targets execution path; neither package enables submissions. |

This is an explicit base-versus-optional boundary, not a claim that every listed feature has its own completed profile. The 28 names in `renv/settings.json` are 25 optional/development source references, `optparse` for the optional legacy CLI, and `tarchetypes` plus `geotargets` for the disabled Targets path. `ignored.packages` keeps those feature-specific references out of the base profile's renv source scan; it neither installs nor locks them, and it does not alter `scripts/check_renv_imports.py`. `sodium` is deliberately not ignored: locked `plumber` imports it, so the lock records the restored version 1.4.0. Until separate feature profiles are locked and verified, do not run the optional source paths as though the primary lock covered them.

## CPU LibTorch boundary

The lock pins the R `torch` wrapper at 0.17.0, not its separately downloaded LibTorch/Lantern runtime. CPU LibTorch is needed to execute the `cito` DNN path on a CPU and the real CPU tensor/fused-Adam checks; `R/core/gpu_helpers.R` and `R/models/model_dnn.R` distinguish a present R wrapper from an installed LibTorch runtime. The `r-quality` workflow explicitly sets `CUDA=cpu`, runs `torch::install_torch()`, verifies a CPU tensor sum, and then runs `tests/testthat.R`. The CPU Plumber image has its own R 4.4.2 runtime build: `plumber/Dockerfile` and `plumber/install-cpu-dnn-packages.R` install the checksum-pinned CPU archive and compile the pinned wrapper. `Dockerfile.cuda` builds a separate CUDA 12.8 runtime, while `Dockerfile.rocm` uses Python PyTorch and deliberately omits R torch/cito. These image-specific runtimes are not part of the repository's R 4.5.0 lock.

## Acceptance procedure

In the pinned R 4.5.0 image, restore the exact lock into a fresh project library with a writable HOME/renv cache:

```sh
Rscript -e 'renv::restore(prompt = FALSE)'
Rscript -e 'status <- renv::status(); stopifnot(isTRUE(status$synchronized))'
```

The `status()` assertion is a required, separate-process gate. Keep CPU LibTorch outside `renv.lock`; where the CPU DNN and CPU tensor tests are in scope, install it into a writable scratch path and verify it in another process:

```sh
CUDA=cpu TORCH_HOME=/path/to/writable/scratch Rscript -e 'options(timeout = 1800); torch::install_torch()'
CUDA=cpu TORCH_HOME=/path/to/writable/scratch Rscript -e 'stopifnot(torch::torch_is_installed()); probe <- torch::torch_tensor(c(1, 2, 3), device = "cpu")$sum()$item(); stopifnot(identical(as.numeric(probe), 6))'
```

Run `Rscript tests/testthat.R` only after both gates pass. A synchronized dependency status is not a substitute for test results or optional-feature profile verification; dated command results and blockers belong in `docs/STATUS.md`.
