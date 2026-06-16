# Architectural Resilience Assessment

## Executive Summary

The app has strong CI fundamentals (Trivy, Playwright, deterministic testing) but **5 critical architectural fragilities** that will cause hard-to-debug failures on any upstream change:

1. **`extract_tensor` layout coupling** — assumes non-public `XPtrTorchTensor` memory layout
2. **`assignInNamespace` monkey-patching** — 9 places override cito/torch internals
3. **Hardcoded C++ ABI symbols** — 10 mangled libtorch symbols in cuda_graph.cpp
4. **No GPU CI** — Blackwell NaN bug found manually, not by CI
5. **torch unpinned in renv.lock** — CUDA binary version can drift from R package

---

## 1. Dependency Management & Version Pinning

### Current State

| Component | Pinned By | Quality |
|-----------|-----------|---------|
| R version 4.5.0 | `renv.lock:3` | ✅ Good |
| CRAN packages | `renv.lock` | ✅ Good |
| **torch R package** | **NOT in renv.lock** | ❌ **CRITICAL GAP** |
| cito 1.1 | `renv.lock:548` | ✅ Good |
| CUDA 12.8 | `plumber/Dockerfile:13` (apt pin) | ✅ Good |
| libtorch 2.8.0+cu128 | `plumber/Dockerfile:27` (URL) | ✅ Good |
| lantern (torch bridge) | `plumber/Dockerfile:37` (git v0.17.0) | ✅ Good |
| Node 22-alpine | Tag only, no SHA | ⚠️ Weak |
| pnpm 10.30.3 | `npm install -g pnpm@10.30.3` | ✅ Good |

### Recommendations

**P0 — Pin torch in renv.lock:**
```bash
renv::snapshot()  # will add torch + its dependencies
```
Without this, `renv::restore()` in CI installs a different torch version than the Docker build. The MLverse torch CDN repo IS in renv.lock (line 11: `cu128/0.17.0`), but torch itself isn't listed as a record.

**P1 — Add SHA256 pinning for Node base images:**
```
FROM node:22-alpine@sha256:<specific_hash>
```

**P2 — Pin R package versions in Docker build:**
Replace `install.packages()` (latest) with `remotes::install_version()` or use `renv::restore()` inside the Dockerfile. The `plumber/Dockerfile` (lines 67-87) installs ~25 R packages at latest — any can break on CRAN update.

**P3 — Evaluate conda as alternative:**
Would simplify CUDA + R + Python co-dependency. But `renv` already works for R. The cost of adding conda outweighs benefit unless Python ML models become required.

---

## 2. Custom Bridge Maintainability

### Critical Coupling: `common.h::extract_tensor`

**File:** `sdmtorch/src/common.h:28-39`

```cpp
at::Tensor extract_tensor(SEXP xptr) {
  void* raw = R_ExternalPtrAddr(xptr);          // Get XPtrTorchTensor*
  at::Tensor* t = static_cast<at::Tensor*>(
    *static_cast<void**>(raw));                  // Deref offset 0 as shared_ptr::_M_ptr
  return *t;
}
```

**Risk:** If the R torch package changes from `shared_ptr<void>` to `unique_ptr<void>`, adds a vtable, or changes field order (e.g., `_M_ptr` moves from offset 0), this silently produces a dangling pointer. The sentinel check (lines 33-35) only guards one specific misalignment.

**Fix:** Create an R-level function in the torch package that returns the raw `at::Tensor*` via a `.Call` interface, rather than reverse-engineering the XPtrTorch layout. Or use the torch R package's existing `.Call("torch_tensor_from_buffer", ...)` to create tensors without touching internals.

**Alternative:** Replace the bridge's custom tensor extraction with `torch::Tensor::data_ptr()` from a properly-typed reference, avoiding the layout assumption entirely.

### Monkey-Patching: `assignInNamespace`

**Files:** `R/models/model_dnn.R:451`, `R/models/model_dnn_multispecies.R:142`

**Risk:** cito 1.1 internal function `train_model` is replaced at runtime. cito 1.2 could rename it, change its signature, or refactor the training loop. The replacement is temporarily, but if any error during training prevents the restoration (lines 491, 205), cito is left in a broken state.

**Fix:** Add version gates:
```r
if (packageVersion("cito") >= "1.2") {
  stop("SDM DNN training requires cito < 1.2", call. = FALSE)
}
```

**Better fix:** Upstream the `train_model` replacement as a cito option (e.g., `cito::dnn(..., custom_train = train_model_fused)`). This removes the monkey-patch entirely.

### Hardcoded ABI Symbols: `cuda_graph.cpp`

**File:** `sdmtorch/src/cuda_graph.cpp:89-101`

Ten mangled C++ symbols like `_ZN2at4cuda9CUDAGraphC1Eb` are hardcoded. These change with every libtorch update. The `sdm_check_so_abi()` warns on version mismatch but does not block execution.

**Fix:** Structure as a thin versioning wrapper:
```cpp
// Load symbol, fail with clear message on miss
void* sym = dlsym(handle, "_ZN2at4cuda9CUDAGraphC1Eb");
if (!sym) sym = dlsym(handle, "_ZN2at4cuda9CUDAGraphC1ESt10shared_ptrINS_8GeneratorEE");
// ... add fallbacks for known torch versions
```

### Test Coverage Gap

5 `.so` files, 17 exported functions, **zero C++ unit tests**. No test for `extract_tensor`, `pinned_alloc`, `tensor_view` in isolation.

**Fix:** Add Catch2 or doctest for the bridge:
```cpp
// test_extract_tensor.cpp
TEST_CASE("extract_tensor roundtrips") {
  at::Tensor t = at::ones({3});
  SEXP xp = wrap_in_xptrtorch(t);  // helper
  at::Tensor t2 = extract_tensor(xp);
  CHECK(t.equal(t2));
}
```

---

## 3. Hardware & CUDA Evolution

### Current State

- **No `-arch=sm_XX` flags** in Makefile — uses `-march=native` (CPU), no CUDA arch spec
- **No compute capability detection** — `nvidia-smi` queries name but never checks `sm_` version
- **Blackwell NaN workaround** is manual: `train_step_adam.cpp` replaces `_fused_adam_` kernel
- **dlsym fallback order** for cudart: `libcudart.so.13` → `libcudart.so.12` → `libcudart.so`

### Recommendations

**P1 — Add compute capability check at startup:**
```r
gpu_cc <- torch::cuda_get_device_capability(0)  # returns c(12, 0) for Blackwell
if (gpu_cc[1] >= 12 && gpu_cc[2] >= 0) {
  # Blackwell+: disable fused Adam, enable safe ATen-op fallback
}
```
This makes the Blackwell NaN workaround automatic instead of manual (sdmtorch/README.md:8-9).

**P1 — Add fat binary support for CUDA builds:**
When building cuda_graph.so with a CUDA toolkit:
```makefile
# Generate SASS for all supported architectures, PTX for forward compat
NVCC_FLAGS = -gencode arch=compute_75,code=sm_75  \  # Turing
             -gencode arch=compute_80,code=sm_80  \  # Ampere
             -gencode arch=compute_89,code=sm_89  \  # Ada Lovelace
             -gencode arch=compute_90,code=sm_90  \  # Hopper
             -gencode arch=compute_120,code=sm_120 \ # Blackwell (future)
             -gencode arch=compute_120,code=compute_120 # PTX forward compat
```

**P2 — Remove `-march=native`:**
Replace with `-mtune=generic -O3` for Docker portability across host CPU generations. The native flag causes SIGILL on different CPUs.

---

## 4. Upstream Package Compatibility

### Critical Couplings

| Coupling | File | Risk | Mitigation |
|----------|------|------|------------|
| `assignInNamespace("train_model", ...)` | `model_dnn.R:451` | cito API change | Version gate + upstream patch |
| `extract_tensor` layout | `common.h:28-39` | torch XPtrTorch change | R-level data_ptr API |
| Mangled ABI symbols | `cuda_graph.cpp:89-101` | libtorch update | Symbol fallbacks + version check |
| `cito:::get_lr_scheduler` | `torch_fused_adam.R:176` | cito internal change | Copy the function or upstream |
| `cito:::cast_to_r_keep_dim` | `torch_fused_adam.R:594` | cito internal change | Copy the function or upstream |
| `CRAN package installs` | `plumber/Dockerfile:67-87` | CRAN update breaks | Pin versions in Dockerfile |

### Abstraction Layer Proposal

**Option A — ONNX:**
Export cito model → ONNX → inference via onnxruntime (CPU) or TensorRT (GPU). Decouples training from inference. Cost: medium (~2 weeks), benefit: complete independence from cito/torch.

**Option B — TorchScript JIT:**
cito models are already torch `nn_module` — can be traced via `torch::jit_trace_module()` (line 259 in `torch_fused_adam.R`). Save traced model, load for inference without cito dependency. Cost: low (already partially implemented), benefit: removes cito from inference path.

**Option C — Bridge as torch R package plugin:**
Restructure the bridge as a torch R package extension (linking to libtorch the way torch's own C++ code does) rather than reverse-engineering XPtrTorch. Cost: medium, benefit: eliminates all layout assumptions.

**Recommendation: Option B (TorchScript) + Option C (proper extension).**

---

## 5. Testing & Continuous Integration

### Current Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| No GPU runners in CI | GPU path exercised only on dev machines | **CRITICAL** |
| smoke_test.R forces `dnn_device = "cpu"` | DNN GPU path never tested | **HIGH** |
| sdmtorch GPU benchmarks not in CI | perf regressions undetected | **HIGH** |
| No cuda-memcheck/compute-sanitizer | memory errors silent | **HIGH** |
| No scheduled builds against R/CUDA RC | breakage detected too late | **MEDIUM** |
| No C++ unit tests for bridge | extract_tensor silently broken | **HIGH** |
| No test for `tensor_view.so`, `pinned_alloc.so` | zero coverage for these modules | **MEDIUM** |

### Multi-Level Test Strategy

**Level 1 — C++ Unit Tests (CI: CPU-only):**
```
sdmtorch/test/test_extract_tensor  — at::Tensor roundtrip
sdmtorch/test/test_adam_step       — numerical equality with torch::optim::Adam
sdmtorch/test/test_tensor_view     — view semantics, GC safety
sdmtorch/test/test_pinned_alloc    — alloc/fill/free cycle, no leaks
```
Framework: doctest (header-only, no dependency). Integration via Makefile test targets.

**Level 2 — R Integration Tests (CI: CPU-only):**
```
sdmtorch/test/test_adam.R:          — existing, runs on CPU
sdmtorch/test/test_libtorch.R:      — existing, runs on CPU
sdmtorch/test/test_pinned_from_r.R  — new: pinned_alloc from R + torch_tensor
```
These run in r-quality.yml on ubuntu-latest (no GPU needed for CPU codepath validation).

**Level 3 — GPU Tests (CI: self-hosted GPU runner):**
```
sdmtorch/test/test_gpu_basics.R     — new: cuda_is_available, tensor creation
sdmtorch/test/test_gpu_adam.R       — new: fused Adam on GPU numerical equality
sdmtorch/test/test_gpu_memcheck.R   — new: compute-sanitizer wrapper
scripts/smoke_test.R --gpu          — new: tags=gpu variant
```
Requires a self-hosted runner with `nvidia-gpu` label. Set up once, shared across repos.

**Level 4 — Scheduled GPU Regression (CI: self-hosted):**
```
Nightly: smoke_test.R --gpu + sdmtorch GPU benchmarks
Weekly: R-devel RC + CUDA RC combo test
```
`.github/workflows/nightly-gpu.yml` — cron: `0 6 * * *`.

### compute-sanitizer Integration

```yaml
- name: CUDA memory check
  run: |
    compute-sanitizer --tool memcheck --leak-check full \
      Rscript -e 'torch::cuda_is_available()'
    compute-sanitizer --tool initcheck \
      Rscript scripts/smoke_test.R --tags=fast
```

---

## 6. Observability & Alerting

### Current State

`GET /api/v1/gpu/status` returns: name, driver, CUDA version, VRAM, util%, temp, torch info. But:
- No git hash or build ID
- No canary inference
- No Prometheus alerts configured (despite prometheus.yml existing)
- No memory leak detection
- No kernel execution time monitoring

### Recommendations

**P1 — Add build metadata to health endpoint:**
```r
list(
  git_hash = system("git rev-parse HEAD", intern = TRUE),
  build_time = "...",  # embedded at Docker build
  bridge_version = sdmtorch_torch_version,
  model_version = semver
)
```

**P1 — Add canary inference to health check:**
```r
handle_gpu_health <- function() {
  # Run a tiny DNN inference
  x <- torch::torch_randn(c(1, 10), device = "cuda")
  model <- torch::nn_linear(10, 1)
  result <- model(x)
  # Check result is finite
  if (!all(is.finite(as.array(result)))) {
    return(response$internal_server_error("GPU produced NaN"))
  }
  # Record kernel execution time
  list(canary_time_ms = elapsed_ms, ok = TRUE)
}
```

**P2 — Add Prometheus GPU metrics:**
```r
# In plumber route:
prometheus::gauge("gpu_vram_free_mib", free_mib)
prometheus::gauge("gpu_temp_celsius", temp)
prometheus::histogram("gpu_kernel_time_ms", elapsed_ms, buckets = c(1, 5, 10, 50, 100))
```

**P2 — Add memory leak alert:**
```r
# Track VRAM over time; alert if strictly increasing for 5+ samples
vram_history <- numeric(0)
observeEvent(reactiveTimer(60000), {
  free <- sdm_gpu_free_vram_mib()
  vram_history <<- c(vram_history, free)
  if (length(vram_history) > 5) {
    if (all(diff(tail(vram_history, 5)) < 0)) {
      warning("GPU memory leak detected: VRAM decreasing over 5 min")
    }
  }
})
```

---

## 7. Documentation & Knowledge Transfer

### Current State

Good project-level docs: README, CONTRIBUTING, AGENTS.md, CHANGELOG, SMOKE_TESTS, DEPLOY. But **zero architecture decision records** (ADRs) for the bridge's most critical choices.

### Required Documentation

**ADR-001:** Why not use libtorch directly? (Answer: Blackwell NaN, need for custom Adam)
**ADR-002:** Why `extract_tensor` uses offset-0 `shared_ptr::_M_ptr`? (Answer: simplest working approach; known fragility to upstream changes)
**ADR-003:** Why `dlsym` for CUDA calls instead of linking CUDA headers? (Answer: no CUDA toolkit required at build time; runtime loading isolates version differences)
**ADR-004:** Why `assignInNamespace` for cito? (Answer: cito has no plugin system; planned upstream contribution)
**ADR-005:** Why `mclapply` with CUDA is unsafe but still present? (Answer: legacy path, pending rewrite to PSOCK)

### Developer Quickstart for Bridge

Create `sdmtorch/DEVELOPER.md`:
```
sdmtorch/DEVELOPER.md
=====================

Quick start:
  make all        # Build all .so files (CPU-only: adam, libtorch, tensor_view, pinned_alloc)
  make cuda_graph # Needs CUDA toolkit
  make test-adam  # Run Adam unit test

Architecture:
  Each .so file is a standalone Rcpp module loaded via dyn.load().
  Data flows: R (SEXP) → extract_tensor() → at::Tensor → CUDA → at::Tensor → R (SEXP)

When updating torch R package:
  1. Run `make clean && make all`
  2. If `train_step_adam.so` fails: check `extract_tensor` layout (common.h)
  3. If `cuda_graph.so` fails: update mangled ABI symbols
  4. Run `Rscript scripts/smoke_test.R --tags=fast`

When adding a new .so:
  1. Copy existing pattern (train_step_adam.cpp)
  2. Add export to Makefile `all` target
  3. Add R-side dyn.load call
  4. Add test in sdmtorch/test/
```

### Bus Factor Mitigation

- Add `CODEOWNERS` file marking `sdmtorch/` with 2+ owners
- Document the `extract_tensor` layout assumption in a prominent comment at the top of every file that uses it
- Every `assignInNamespace` call should have a comment linking to the ADR

---

## 8. Migration Paths & Security

### Quantitative Sunset Criteria for Custom Bridge

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Maintainer hours | > 20 hrs/quarter on bridge | Prioritize TorchScript migration |
| torch XPtrTorch layout change | Breaking change in R torch | Emergency migration to direct libtorch |
| cito API change | `assignInNamespace` fails | Upstream patch or fork cito |
| perf gap vs libtorch | < 90% of libtorch speed | Profile and optimize bridge hot paths |
| New layer type needed | > 2 new ops/quarter | Auto-generate from ONNX opset |

### Stepwise Migration Plan

**Phase 1 (3 months):** TorchScript JIT trace at training end. Save as `model.pt`. Add inference-only code path that loads `model.pt` without cito. Validation: outputs match within 1e-5.

**Phase 2 (6 months):** Replace `assignInNamespace` with cito's `device` parameter (monkey-patch only when custom Adam needed). Move `train_model_fused` to a cito plugin.

**Phase 3 (12 months):** Deprecate custom bridge for all but Adam optimizer step. Use torch's `torch::optim::Adam` directly. `train_step_adam.so` becomes the sole surviving bridge component.

### Security

**Current measures:**
- Trivy scans all 3 Docker images for CRITICAL/HIGH (platform-ci.yml:327-351)
- Dependabot weekly scans for pnpm, Docker, GHA
- Nginx with security headers in production (CSP, HSTS, rate limiting)
- `rocker/r-ver` pinned by SHA256
- Non-root users (sdm, node, shiny)
- `docker-compose.prod.yml` fails closed on missing secrets

**Gaps:**
- No SAST (static analysis) for R code
- No CodeQL
- Node base images not SHA-pinned
- R packages not version-pinned in Dockerfile (latest from CRAN)
- No CVSS threshold for vulnerability response
- No staging environment gating for GPU updates

**P0 — Pin R package versions in Dockerfile:**
```dockerfile
RUN Rscript -e 'remotes::install_version("plumber", version = "1.2.2")'
# or use renv.lock:
RUN Rscript -e 'renv::restore()'
```

**P1 — Add container image signing:**
```bash
cosign sign ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber:<tag>
```
Verifiable attestation that the image was built by CI, not tampered with.

**P2 — Add staging GPU validation gate:**
Before any GPU update (CUDA driver, libtorch, torch R pkg) reaches production:
1. Build staging image
2. Run full smoke_test.R with GPU on staging runner
3. Run `compute-sanitizer --tool memcheck` on canary inference
4. Compare model outputs against known-good reference (deterministic seed)
5. Only then promote to production

---

## Priority Summary

| Priority | Action | Effort | Risk Reduced |
|----------|--------|--------|-------------|
| **P0** | Pin torch in renv.lock | 1 hr | CUDA version drift |
| **P0** | Add GPU self-hosted runner to CI | 1 day | No GPU testing in CI |
| **P0** | Pin R packages in Dockerfile | 2 hr | CRAN breakage |
| **P1** | Version gate cito `assignInNamespace` | 1 hr | cito upgrade breakage |
| **P1** | Add compute-sanitizer to CI (CPU paths) | 2 hr | Memory errors |
| **P1** | Add build metadata to health endpoint | 1 hr | Debug/deploy correlation |
| **P1** | Add canary inference to GPU health check | 4 hr | Silent NaN detection |
| **P1** | Replace `-march=native` with `-mtune=generic` | 10 min | Docker portability |
| **P1** | Write sdmtorch/DEVELOPER.md | 2 hr | Bus factor |
| **P2** | Add Catch2 tests for bridge internals | 8 hr | extract_tensor safety |
| **P2** | Replace `mclapply` with PSOCK for GPU | 4 hr | Fork+CUDA UB |
| **P2** | Add staging GPU validation gate | 2 days | CUDA update safety |
| **P2** | Implement TorchScript JIT save path | 2 weeks | cito decoupling |
