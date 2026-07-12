# Experimental cross-vendor PyTorch DNN

`torch_dnn` is SDM Dashboard's first experimental Python DNN backend intended to use the PyTorch build already installed on the machine. It trains a binary presence/background classifier, records feature order and standardisation in `model.pkl`, emits holdout metrics in `cv_results.json`, and writes permutation importance plus bounded prediction probabilities.

## Backends

`device: "auto"` selects CUDA when `torch.cuda.is_available()`; PyTorch reports that backend as **ROCm** when `torch.version.hip` is non-null, otherwise **CUDA**. It then tries MPS and finally CPU. Explicit `cuda`, `rocm`, or `mps` requests fail if unavailable rather than silently falling back. Support is therefore determined by the installed Python PyTorch build: CUDA, ROCm, MPS, and CPU are all supported where that build exposes them.

On AMD, install a ROCm-enabled PyTorch build, set `device` to `rocm` for a strict check (or keep `auto`), and run the ordinary fit/predict bridge. The focused test suite includes a hardware roundtrip that runs automatically when a ROCm build and AMD GPU are available, and otherwise skips cleanly.

This is the first AMD path. Existing native R `torch` CUDA extensions and the current GPU Docker override remain NVIDIA-only.

## Parameters

Manifest defaults are `hidden_layers=[64, 32]`, `epochs=100`, `batch_size=64`, `learning_rate=0.001`, `dropout=0.1`, `device="auto"`, `early_stopping_patience=12`, and `validation_fraction=0.2`. The R bridge passes those defaults and only matching named model overrides to the Python JSON config.

Install dependencies from `requirements.txt` only after choosing the PyTorch wheel/channel for the target accelerator. Do not treat this experimental backend as a scientific validation claim without hardware- and data-specific evaluation.
