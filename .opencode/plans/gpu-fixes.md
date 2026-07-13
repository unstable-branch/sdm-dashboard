# GPU Fix Plan — P0+P1+P2

## Files Changed (10 files, ~130 LOC)

### P0.1 — VRAM cap validation before GPU allocs

**File:** `R/core/gpu_helpers.R`

Add two new functions:
```r
sdm_gpu_free_vram_mib <- function() {
  tryCatch({
    smi <- Sys.which("nvidia-smi")
    if (nzchar(smi)) {
      out <- system2(smi, c("--query-gpu=memory.free", "--format=csv,noheader,nounits"),
        stdout = TRUE, stderr = FALSE)
      if (length(out) > 0 && nzchar(out[1])) {
        vals <- suppressWarnings(as.numeric(trimws(out)))
        vals <- vals[is.finite(vals)]
        if (length(vals) > 0) return(min(vals))
      }
    }
    torch::cuda_memory_stats()$reserved_bytes$current / (1024 * 1024)
  }, error = function(e) NA_real_)
}

sdm_gpu_can_alloc <- function(n_cells, n_layers = 1L, safety_margin = 0.8) {
  if (!sdm_use_gpu()) return(FALSE)
  bytes_needed <- as.numeric(n_cells) * as.numeric(n_layers) * 4L
  mib_needed <- bytes_needed / (1024 * 1024)
  free_mib <- sdm_gpu_free_vram_mib()
  if (is.na(free_mib)) return(TRUE)
  mib_needed < free_mib * safety_margin
}
```

Modify `raster_to_tensor()` to use the check — if tensor won't fit in VRAM, fall back to CPU:
```r
raster_to_tensor <- function(rast, device = gpu_device()) {
  vals <- terra::values(rast)
  if (is.null(vals)) return(NULL)
  n_cells <- NROW(vals)
  n_layers <- NCOL(vals)
  if (identical(device, "cuda") && !sdm_gpu_can_alloc(n_cells, n_layers)) {
    device <- "cpu"
  }
  torch::torch_tensor(vals, dtype = torch::torch_float(), device = device)
}
```

Modify `gpu_raster_app()` and `gpu_raster_app_batch()` similarly — call `sdm_gpu_can_alloc()` before `torch_tensor(..., device=dev)` and set `dev <- "cpu"` if insufficient VRAM.

---

### P0.2 — Rewrite `pinned_alloc.cpp` via dlsym

**File:** `sdmtorch/src/pinned_alloc.cpp`

Full rewrite following the `cuda_graph.cpp` pattern:
- Remove `#include <cuda_runtime.h>`, `#include <ATen/ATen.h>`, `#include <torch_types.h>`
- Add `#include <dlfcn.h>`, `#include <cstdint>`
- Add `std::once_flag` + `ensure_cudart()` that loads `cudaHostAlloc`, `cudaFreeHost`, `cudaMemcpy`, `cudaGetErrorString` from `libcudart.so` (with `"libcudart.so.13"` and `"libcudart.so"` fallbacks)
- All CUDA calls go through function pointers loaded via `dlsym`
- `pinned_to_gpu_tensor()` uses `dlsym`-loaded `cudaMemcpy`, returns raw `SEXP` external pointer to GPU tensor (not XPtrTorch)
- No ATen/torch header dependency

---

### P0.2 — Update Makefile

**File:** `sdmtorch/Makefile`

Change the pinned_alloc build rule to NOT include `$(CUDA_INC)`:
```
$(PINNEDALLOC_OUT): $(PINNEDALLOC_SRC)
	$(CXX) $(CFLAGS) $(INCLUDES) $(TORCH_LIB) \
		-o $@ $(PINNEDALLOC_SRC) $(TORCH_LIBS) $(RPATH) $(R_LIB) -lcudart
```
No `$(CUDA_INC)` needed — all CUDA calls go through dlsym at runtime. Also remove the dependency on `src/common.h` (no torch types used).

---

### P0.3 — Add multi-species GPU OOM → CPU fallback

**File:** `R/models/model_dnn_multispecies.R` (lines 149-172)

Wrap the `cito::dnn()` training call in the same GPU→CPU retry pattern as single-species:
```r
model <- tryCatch({
  cito::dnn(...device = dnn_device...)
}, error = function(e) {
  err_msg <- conditionMessage(e)
  if (identical(dnn_device, "cuda") && grepl("CUDA|out of memory|cuda|memory", err_msg, ignore.case = TRUE)) {
    log_message(log_fun, "    Seed ", s, " GPU failed (", err_msg, "). Retrying on CPU...")
    tryCatch({
      cito::dnn(...device = "cpu", epochs = min(epochs, floor(epochs * 0.7))...)
    }, error = function(e2) {
      log_message(log_fun, "    Seed ", s, " CPU fallback also failed: ", conditionMessage(e2))
      NULL
    })
  } else {
    log_message(log_fun, "    Seed ", s, " failed: ", err_msg)
    NULL
  }
})
```

Key difference: retry on CPU uses `dnn_device = "cpu"` and reduces max epochs by 30% (CPU is slower).

---

### P0.4 — Add `cuda_empty_cache()` between training epochs

**File:** `R/models/torch_fused_adam.R`

Add `torch::cuda_empty_cache()` at the end of each epoch in the training loop (after line 440, before NA check).

Insert after `# Clean up CUDA graph` block and before `# Check NA`:
```r
if (is_cuda && epoch %% 5 == 0) {
  tryCatch(torch::cuda_empty_cache(), error = function(e) NULL)
}
```
Runs every 5 epochs to prevent allocator fragmentation without the overhead of calling every epoch.

---

### P1.5 — Add `cuda_synchronize()` between graph replay batches

**File:** `R/models/torch_fused_adam.R` (line 421)

Add `torch::cuda_synchronize()` before graph replay on consumer GPUs:
```r
if (!is.null(cg_graph) && cg_batches_this_epoch > 2L) {
  if (.torch_consumer_gpu()) torch::cuda_synchronize()
  .Call("cuda_graph_replay", cg_graph)
}
```
Where `.torch_consumer_gpu()` checks if the GPU is a consumer (not Tesla/Quadro/data center) GPU that has TDR watchdog.

Simplify: always sync before CUDA Graph replay since it's per-batch anyway:
```r
if (!is.null(cg_graph) && cg_batches_this_epoch > 2L) {
  torch::cuda_synchronize()
  .Call("cuda_graph_replay", cg_graph)
}
```

---

### P1.6 — Narrow CUDA error classification

**File:** `plumber/R/error_codes.R` (line 163)

Change overly-broad regex to only match actual OOM:
```r
if (grepl("CUDA out of memory|out of memory|cannot allocate", err_msg, ignore.case = TRUE)) {
  return("OOM_PREDICTION")
}
# Separate CUDA error (driver/init/illegal memory/etc.)
if (grepl("CUDA error|cuBLAS error|cuDNN error", err_msg, ignore.case = TRUE)) {
  return("CUDA_ERROR")
}
```

---

### P1.7 — Add `non_blocking=TRUE` to prediction H2D

**File:** `R/models/model_dnn.R` (lines 572, 1117)

Add `non_blocking = TRUE` to tensor creation in prediction paths:
```r
# Line 572:
x_tensor <- torch::torch_tensor(batch_scaled, device = device, non_blocking = TRUE)

# Line 1117:
x_tensor <- torch::torch_tensor(batch_scaled, device = device, non_blocking = TRUE)
```

**File:** `R/models/model_dnn_multispecies.R` (line 529)

```r
logits <- all_models[[e]]$net(torch::torch_tensor(batch_scaled, device = dnn_device, non_blocking = TRUE))
```

---

### P2.8 — Fix `cuda_graph.cpp` hardcoded buffer

**File:** `sdmtorch/src/cuda_graph.cpp` (line 16, 210-211)

Replace `#define CUDAGRAPH_BUFFER_SIZE 2048` + `malloc` + placement-new with direct `new`:
```cpp
// Remove: #define CUDAGRAPH_BUFFER_SIZE 2048
// Remove: malloc + placement-new
// Add:
void* mem = nullptr;
try {
  auto* graph = new at::cuda::CUDAGraph(false);
  mem = static_cast<void*>(graph);
} catch (std::exception& e) {
  Rf_errorcall(R_NilValue, "CUDAGraph ctor: %s", e.what());
}
```

And update `cudagraph_finalizer`:
```cpp
static void cudagraph_finalizer(SEXP xp) {
  auto* graph = static_cast<at::cuda::CUDAGraph*>(R_ExternalPtrAddr(xp));
  if (graph) {
    delete graph;
    R_SetExternalPtrAddr(xp, NULL);
  }
}
```

---

### P2.9 — Fix `Sys.getenv("CUDA")`

**File:** `R/core/packages.R` (line 203)

```r
# Old:
cuda_ver <- Sys.getenv("CUDA", NA_character_)
# New:
cuda_ver <- Sys.getenv("CUDA_VERSION",
  Sys.which("nvidia-smi") != "" && nzchar(smi_path <- Sys.which("nvidia-smi"))
    && nzchar(tryCatch({
      cv <- system2(smi_path, "--version", stdout = TRUE, stderr = FALSE)
      cv_line <- grep("CUDA Version", cv, value = TRUE)[1]
      if (!is.na(cv_line)) sub(".*CUDA Version:\\s*", "", cv_line) else ""
    }, error = function(e) "")),
  NA_character_)
```

Simplify: just try `nvidia-smi --version`:
```r
if (has_cuda) {
  cuda_ver <- tryCatch({
    smi <- Sys.which("nvidia-smi")
    if (nzchar(smi)) {
      cv <- system2(smi, "--version", stdout = TRUE, stderr = FALSE)
      cv_line <- grep("CUDA Version", cv, value = TRUE)[1]
      if (!is.na(cv_line)) sub(".*CUDA Version:\\s*", "", cv_line) else ""
    } else ""
  }, error = function(e) "")
  if (nzchar(cuda_ver)) result$cuda_version <- cuda_ver
}
```

Same change in `R/models/model_dnn.R` (line 142).

---

### P2.10 — Fix pinned doc (sync not async)

**File:** `R/core/gpu_helpers.R` (lines 42-48)

Update comment block:
```r
# Pinned memory GPU transfer helper.
# Uses the pinned_alloc.so C extension for H2D copies (synchronous via cudaMemcpy).
# Falls back to standard raster_to_tensor() when unavailable.
# Steps: 1. allocate pinned CPU buffer (page-locked)
#        2. fill with R matrix values (double→float, column→row major)
#        3. synchronous cudaMemcpy to GPU
#        4. return GPU tensor
```

Also update `pinned_alloc.cpp` header comment to say "synchronous".

---

## Verification Steps

1. `cd sdmtorch && make clean && make pinned_alloc` — verify build succeeds
2. Parse check: `Rscript -e 'for (f in list.files(c("R","scripts","tests"), pattern="[.][Rr]$", recursive=TRUE, full.names=TRUE)) parse(f); parse("app.R"); parse("pipeline.R"); parse("launch_app.R")'`
3. Quick smoke test: `Rscript scripts/smoke_test.R`
4. Conditional: `Rscript -e 'library(torch); torch::cuda_is_available()'` — should still return TRUE
5. Conditional: `nvidia-smi` — check no runaway GPU processes
