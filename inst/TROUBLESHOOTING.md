# Troubleshooting

## torch R package / sdmtorch ABI mismatch

**Symptom**: `sdm_check_so_abi` calls `stop()` with a message like "ABI version mismatch" when loading `train_step_adam.so` or `train_step_libtorch.so`.

**Cause**: The sdmtorch C++ extensions are compiled against a specific torch R package version (captured at build time in `.sdmtorch-abi.json`). If the torch R package is upgraded after the `.so` is built, the two ABIs may no longer match.

**Fix**:
```bash
cd sdm-dashboard
make -C sdmtorch clean all   # rebuild against current torch version
```

This is required after:
- `renv::restore()` updating the torch R package
- A system-wide R package update
- Upgrading the Docker Plumber image

## XPtrTorch tensor layout coupling

**Symptom**: Crashes, segfaults, or garbage tensor data when using DNN models on GPU.

**Cause**: The sdmtorch C++ bridge in `sdmtorch/src/common.h` assumes the torch R package stores `at::Tensor*` at a specific offset inside `XPtrTorchTensor*`. This is an internal, undocumented layout that can change between torch R package versions.

**Mitigation**: The build manifest (`.sdmtorch-abi.json`) captures the torch version at compile time. Rebuild the extensions after any torch upgrade:
```bash
make -C sdmtorch clean all
```

If you observe tensor-related crashes after a torch upgrade, this is the first thing to check.

## Blackwell GPU NaN with libtorch fused Adam

**Symptom**: DNN training produces NaN loss and NaN parameters on NVIDIA RTX 5060 Ti (Blackwell, compute 12.0) even with clean data.

**Cause**: The libtorch `_fused_adam_` CUDA kernel has a known issue on Blackwell GPUs. This kernel is in `train_step_libtorch.so`.

**Fix**: The default build only ships `train_step_adam.so`, which uses standard ATen ops and works correctly on all GPUs including Blackwell. If you have `SDMTORCH_ENABLE_LIBTORCH_KERNEL=1` set, unset it:
```bash
unset SDMTORCH_ENABLE_LIBTORCH_KERNEL
```

If you need the fused Adam kernel (for CUDA GPUs older than Blackwell), set the variable explicitly:
```bash
SDMTORCH_ENABLE_LIBTORCH_KERNEL=1 make -C sdmtorch
```

## CUDA Graph capture failures

**Symptom**: Error like "could not find symbol cudaGraphInstantiate" or "CUDA error: 704" during DNN training with `use_cuda_graph = TRUE`.

**Cause**: The CUDA Graph extension (`cuda_graph.so`) uses `dlsym(RTLD_DEFAULT, ...)` to dynamically resolve CUDA Graph symbols. On some systems, the symbol is only available via `RTLD_LAZY`.

**Fix**: The code now falls back to `RTLD_LAZY` automatically. If you still see errors, CUDA Graphs may not be supported on your CUDA version. Disable CUDA Graphs:
```R
run_sdm(..., dnn_options = list(use_cuda_graph = FALSE))
```

## dl_iterate_phdr not found

**Symptom**: Warning on startup: "dl_iterate_phdr not found in default symbol table — using RTLD_LAZY fallback."

**Cause**: The `dl_iterate_phdr` symbol is not exported from the default dynamic symbol table on this system.

**Fix**: This is benign. The RTLD_LAZY fallback is used automatically. No action required.

## GPU not detected on NVIDIA system

**Symptom**: `sdm_accelerator_capabilities()` returns `cuda = FALSE` on a system with an NVIDIA GPU.

**Cause**: Usually a missing or incompatible NVIDIA driver, or torch was not compiled with CUDA support.

**Fix**:
1. Verify CUDA is available: `python -c "import torch; print(torch.cuda.is_available())"`
2. Verify torch has CUDA: `Rscript -e "torch::cuda_is_available()"`
3. Check NVIDIA driver: `nvidia-smi`
