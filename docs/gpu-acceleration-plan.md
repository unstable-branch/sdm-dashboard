# GPU Acceleration Integration Plan

## Current State

Only the **DNN (cito/torch)** backend has GPU support. All other models run CPU-only. The Docker deployment stack has zero GPU provisioning and DNN is not installed in containers at all.

---

## Phase 0: Fix DNN Backend Wiring

The DNN R code (`R/models/model_dnn.R`, 789 lines) is complete but has critical integration gaps.

| Step | File | Change | Lines |
|------|------|--------|-------|
| 0.1 | `R/core/run_sdm.R` — `extra_args` block (~line 236) | Add `"dnn"` case forwarding `dnn_model_type`, `dnn_device` | +5 |
| 0.2 | `R/core/run_sdm.R` — param extraction from `cfg` | Extract `dnn_model_type`, `dnn_device` alongside other model params | +5 |
| 0.3 | `tests/testthat/test-dnn.R:82` | Replace `detect_torch_device()` → `setup_torch_cuda()` (function doesn't exist) | 1 |
| 0.4 | `packages/shared/src/schemas.ts` | Add `dnnModelType` + `dnnDevice` to `modelConfigSchema` | +10 |

**Estimated: 20 min**

---

## Phase 1: CPU Parallelism Fixes

No GPU required — these work on any hardware by removing artificial single-thread restrictions.

| Step | File | Change | Lines |
|------|------|--------|-------|
| 1.1 | `R/models/model_rf.R:98` | `num.threads = 1` → `num.threads = normalize_core_count(n_cores)` | 1 |
| 1.2 | `R/models/model_xgboost.R:25,94` | `nthread = 1L` → `nthread = n_cores` | 2 |
| 1.3 | `R/models/model_xgboost.R:159` | `cores = 1` → `cores = normalize_core_count(n_cores)` in `terra::app()` | 1 |
| 1.4 | `R/models/model_esm.R:222` | Wire `n_cores` into `ecospat::ecospat.ESM.Projection()` (currently ignored) | +5 |
| 1.5 | `R/models/model_rangebag.R:174` | CV: `n_cores = 1` → `n_cores = normalize_core_count(n_cores)` | 1 |

**Estimated: 15 min**

---

## Phase 2: Docker BLAS Acceleration

Benefits **GLM, GAM, MaxNet, ESM, AOA, climate matching** automatically — no code changes to the models. Currently `rocker/r-ver:4.4.2` ships single-threaded reference BLAS. OpenBLAS gives 2-8x speedup on BLAS-heavy operations (IRLS, QR, Cholesky, matrix multiply).

| Step | File | Change | Lines |
|------|------|--------|-------|
| 2.1 | `plumber/Dockerfile` — apt-get list | Add `libopenblas-dev` | 1 |
| 2.2 | `Dockerfile` (Shiny legacy) — apt-get list | Add `libopenblas-dev` (if used for compute) | 1 |
| 2.3 | `plumber/Dockerfile` — after apt RUN | `update-alternatives --set libblas.so.3 /usr/lib/x86_64-linux-gnu/openblas-pthread/libblas.so.3` | 3 |
| 2.4 | `R/core/packages.R` `configure_parallel()` | Add `OPENBLAS_LOOPS=1` for deterministic results | 1 |

**Estimated: 30 min + image rebuild**

---

## Phase 3: cito/torch CPU Docker Installation

Makes DNN available in production (CPU-only, no GPU required).

| Step | File | Change | Lines |
|------|------|--------|-------|
| 3.1 | `plumber/Dockerfile` — pkgs vector (line 40-49) | Add `"cito"` | 1 |
| 3.2 | `plumber/Dockerfile` — new Stage 2b RUN | Install `torch` from CRAN, then `torch::install_torch()` (CPU) | 5 |
| 3.3 | `packages/shared/src/constants.ts` | Set `dnn.available = true` | 1 |
| 3.4 | `.github/workflows/platform-ci.yml` | Add DNN smoke test to CI (CPU-only) | — |

**Estimated: 30 min + image rebuild**

---

## Phase 4: Frontend DNN Configuration UI

| Step | File | Change | Lines |
|------|------|--------|-------|
| 4.1 | `frontend/src/components/model/model-config-form.tsx` | Add DNN conditional panel: architecture selector (Small/Medium/Large), device selector (auto/cpu/gpu) | +50 |
| 4.2 | `R/ui/ui_sidebar_controls.R` | Add DNN `conditionalPanel` for Shiny: same controls | +30 |
| 4.3 | `frontend/src/services/types.ts` | Add `DnnConfig` interface | +5 |

**Estimated: 1.5 hr**

---

## Phase 5: XGBoost GPU Support (optional — requires CUDA build)

XGBoost R package supports `tree_method = "gpu_hist"` since v1.3.0, but the Posit PGM binary does not include CUDA. Requires building from source with `-DUSE_CUDA=ON`.

| Step | File | Change | Lines |
|------|------|--------|-------|
| 5.1 | `R/models/model_xgboost.R` | Add `device` param (default `"cpu"`) to `fit_xgboost_sdm()` | +10 |
| 5.2 | `R/models/model_xgboost.R` | When `device = "gpu"`: `tree_method = "gpu_hist"`, `predictor = "gpu_predictor"` | +10 |
| 5.3 | `plumber/Dockerfile` — build stage | Add CUDA toolkit, rebuild xgboost with `-DUSE_CUDA=ON` | +10 |
| 5.4 | `docker-compose.yml` — plumber service | Add `runtime: nvidia` + `deploy.resources.reservations.devices` | +5 |

**Estimated: 1 hr + image rebuild**

---

## Phase 6: GPU Health Monitoring

| Step | File | Change | Lines |
|------|------|--------|-------|
| 6.1 | `plumber/R/plumber.R` | Add `GET /health/gpu` endpoint: GPU detection, CUDA version, device count, memory status | +20 |
| 6.2 | `frontend/src/app/(dashboard)/admin/page.tsx` | Show GPU status card on admin dashboard | +20 |

**Estimated: 45 min**

---

## Effort Summary

| Phase | Scope | Lines Changed | Time | Depends On |
|-------|-------|--------------|------|------------|
| P0 | Fix DNN wiring | ~20 | 20 min | — |
| P1 | CPU parallelism | ~10 | 15 min | — |
| P2 | OpenBLAS in Docker | ~6 | 30 min | — |
| P3 | CPU cito in Docker | ~8 | 30 min | P0 |
| P4 | DNN frontend UI | ~85 | 1.5 hr | P0, P3 |
| P5 | XGBoost GPU | ~25 | 1 hr | P1, P3 |
| P6 | GPU health | ~40 | 45 min | P3, P5 |

**CPU-only (P0-P4):** ~130 lines, ~3.5 hours
**With GPU (P0-P6):** ~200 lines, ~5.5 hours

---

## Dependency Graph

```
P0 (fix DNN wiring) ──→ P3 (CPU cito Docker) ──→ P4 (DNN frontend UI)
                         │
P1 (CPU parallelism) ────┼──→ P5 (XGBoost GPU) ──→ P6 (GPU health)
                         │
P2 (OpenBLAS Docker) ────┘
```

P0 + P1 + P2 can run in parallel. P3 needs P0. P4 needs P0+P3. P5 needs P1+P3. P6 needs P3+P5.

---

## Models Affected by Each Phase

| Model | P0 | P1 | P2 | P3 | P4 | P5 | P6 |
|-------|----|----|----|----|----|----|----|
| DNN (cito/torch) | ✅ | — | — | ✅ | ✅ | — | ✅ |
| XGBoost (BRT) | — | ✅ | — | — | — | ✅ | — |
| Random Forest (ranger) | — | ✅ | — | — | — | — | — |
| GLM | — | — | ✅ | — | — | — | — |
| GAM | — | — | ✅ | — | — | — | — |
| MaxNet | — | — | ✅ | — | — | — | — |
| ESM | — | ✅ | ✅ | — | — | — | — |
| Rangebagging | — | ✅ | — | — | — | — | — |
| AOA / Climate matching | — | — | ✅ | — | — | — | — |
