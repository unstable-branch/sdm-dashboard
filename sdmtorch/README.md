# sdmtorch — C++ extensions for SDM DNN training

## What works

| Extension | File | Default | Blackwell-safe |
|----------|------|---------|----------------|
| ATen-op Adam (CPU/CUDA/MPS) | `train_step_adam.cpp` | ✅ Built by default | ✅ Yes |
| libtorch fused Adam (CPU) | `train_step_libtorch.cpp` | Opt-in only (`SDMTORCH_ENABLE_LIBTORCH_KERNEL=1`) | N/A |
| libtorch fused Adam (CUDA) | `train_step_libtorch.cpp` | **NOT built** | ❌ NaN on Blackwell |
| CUDA Graphs | `cuda_graph.cpp` | Built if CUDA libs detected | ✅ Yes |
| Pinned memory H2D | `pinned_alloc.cpp` | Opt-in (`SDMTORCH_ENABLE_PINNED_ALLOC=1`) | ✅ Yes |

## Known limitations

- **`_fused_adam_` CUDA kernel broken on Blackwell GPUs** (RTX 5060 Ti, compute 12.0).
  The libtorch `_fused_adam_` CUDA kernel produces NaN parameter updates on Blackwell.
  The default build uses `train_step_adam.so` (ATen-op Adam) which works on all GPUs.
  Only enable the libtorch kernel with `SDMTORCH_ENABLE_LIBTORCH_KERNEL=1` on CUDA < 12.0.
- **XPtrTorch layout coupling**: `common.h` assumes `at::Tensor*` is at offset 0 inside
  `XPtrTorchTensor*` (a `shared_ptr<void>`). This is internal torch R API that can
  change between versions. The `sdmtorch_xptr_layout_check()` probe catches this
  on first load and stops with a clear rebuild message.
- **NVRTC not found**: `jit_trace_module` fails without `libnvrtc.so`. We fall back
  to direct model execution.
- **CUDA Graphs** requires `cuda-cudart-dev` headers. Install with:
  `sudo apt-get install cuda-cudart-dev-13-0`

## Build

```bash
cd sdmtorch

make                    # ATen-op Adam + TensorView + CUDA Graphs (if CUDA detected)
make adam               # ATen-op Adam only
make tensor_view        # TensorView only
make cuda_graph         # CUDA Graphs only (requires CUDA headers)

# Opt-in: libtorch fused Adam (CPU only; CUDA path produces NaN on Blackwell)
SDMTORCH_ENABLE_LIBTORCH_KERNEL=1 make libtorch

# Opt-in: pinned memory H2D (experimental)
SDMTORCH_ENABLE_PINNED_ALLOC=1 make pinned_alloc

make clean              # remove build artifacts
```

## Files

| File | Purpose |
|------|---------|
| `src/common.h` | Shared XPtrTorch tensor extraction utilities. Coupling risk — see above. |
| `src/train_step_adam.cpp` | Custom Adam/AdamW via standard ATen ops. Blackwell-safe. |
| `src/train_step_libtorch.cpp` | libtorch `_fused_adam_::call`. Blackwell-unsafe on CUDA. |
| `src/cuda_graph.cpp` | CUDA Graph capture/replay via ATen CUDAGraph API (dlsym). |
| `src/tensor_view.cpp` | Zero-copy R matrix → torch tensor view + device transfer. |
| `src/pinned_alloc.cpp` | Pinned memory allocator + H2D transfer. |
| `train_step_adam.so` | Default optimizer kernel. |
| `train_step_libtorch.so` | Opt-in only (`SDMTORCH_ENABLE_LIBTORCH_KERNEL=1`). |

## XPtrTorch layout check

On first `train_model_fused` invocation, the code calls `sdmtorch_xptr_layout_check()`
to probe a live torch tensor and verify the memory layout assumption. If the torch R
package was upgraded since the last build, the probe fails and training stops with:

```
XPtrTorch tensor layout mismatch detected.
  torch version: 0.17.0
  Error: sentinel found at offset 0 — shared_ptr::_M_ptr is NOT at offset 0 in this torch R package version.
  Fix: make -C sdmtorch clean all
```

## Integration with R

The `.so` is loaded via `dyn.load()` in `R/models/model_dnn.R` and
`R/models/model_dnn_multispecies.R`. The `.Call("adam_step_direct", ...)` function is
called from `R/models/torch_fused_adam.R` in `fused_adam_step()`.

The XPtrTorch layout check is called automatically at the start of
`train_model_fused()` before any GPU operations.
