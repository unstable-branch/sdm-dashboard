# sdmtorch — C++ extensions for SDM DNN training

## What works

| Extension | File | Status | Speedup |
|-----------|------|--------|---------|
| Fused Adam (CPU) | `train_step_libtorch.cpp` | ✅ Works on CPU | 2.9x vs standard Adam |
| Fused Adam (GPU) | `train_step_libtorch.cpp` | ❌ NaN on Blackwell (compute 12.0) | N/A |
| AMP (GPU) | (R-level) | ✅ Works | 0.7x (model too small) |
| CUDA Graphs | `cuda_graph.cpp` | ⏳ Needs non-default stream (requires CUDA headers) | N/A |

## Known limitations

- **`_fused_adam_` CUDA kernel broken on Blackwell GPUs** (RTX 5060 Ti, compute 12.0). The kernel produces NaN parameter updates. CPU fused Adam works correctly. Tracked against future torch R package updates.
- **NVRTC not found** — `jit_trace_module` fails on systems without `libnvrtc.so`. We gracefully fall back to direct model execution.
- **CUDA Graphs** requires `cuda-cudart-dev` headers for full ATen CUDAGraph integration. Install with: `sudo apt-get install cuda-cudart-dev-13-0`

## Build

```bash
cd sdmtorch
make           # builds both extensions
make libtorch  # build only fused_adam_step_direct (the working one)
make clean     # remove build artifacts
```

## Files

| File | Purpose |
|------|---------|
| `src/train_step_libtorch.cpp` | C++ fused Adam step. Calls `at::_ops::_fused_adam_::call` directly. Links libtorch. |
| `src/cuda_graph.cpp` | CUDA Graph capture/replay via ATen CUDAGraph API (dlsym). Blocked by stream requirement. |
| `train_step_libtorch.so` | Compiled shared library. Auto-loaded by `model_dnn_multispecies.R`. |
| `test/bench_fused_adam.R` | Microbenchmark for individual fused_adam_step calls. |
| `test/bench_e2e.R` | End-to-end multi-species DNN benchmark. |
| `test/test_libtorch.R` | Smoke test for the C++ extension. |

## Integration with R

The `.so` is loaded via `dyn.load()` in `R/models/model_dnn_multispecies.R` and `R/models/model_dnn.R` when `use_fused_adam=TRUE`. The `.Call("fused_adam_step_direct", ...)` function is called from `R/models/torch_fused_adam.R` in `fused_adam_step()`.
