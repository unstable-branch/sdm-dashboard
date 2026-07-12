"""Device-neutral PyTorch DNN helpers for the SDM Python bridge."""

from __future__ import annotations

import random
from typing import Any, Mapping, Sequence

import numpy as np
import torch
from torch import nn


ARTIFACT_FORMAT_VERSION = 1
SUPPORTED_DEVICE_REQUESTS = ("auto", "cuda", "rocm", "mps", "cpu")


def _mps_available(torch_module: Any) -> bool:
    backends = getattr(torch_module, "backends", None)
    mps = getattr(backends, "mps", None)
    return bool(mps and mps.is_available())


def select_device(requested: str = "auto", torch_module: Any = torch) -> tuple[torch.device, str]:
    """Choose a usable backend without conflating CUDA and ROCm.

    PyTorch exposes ROCm through ``torch.cuda``. An explicitly requested backend
    never falls through to another backend; only ``auto`` is allowed to fall back.
    """
    request = str(requested or "auto").lower()
    if request not in SUPPORTED_DEVICE_REQUESTS:
        raise ValueError(
            f"Unsupported device request '{requested}'. Choose one of: "
            + ", ".join(SUPPORTED_DEVICE_REQUESTS)
        )

    cuda_available = bool(torch_module.cuda.is_available())
    is_rocm = getattr(torch_module.version, "hip", None) is not None
    mps_available = _mps_available(torch_module)

    if request == "auto":
        if cuda_available:
            return torch_module.device("cuda"), "rocm" if is_rocm else "cuda"
        if mps_available:
            return torch_module.device("mps"), "mps"
        return torch_module.device("cpu"), "cpu"

    if request == "cpu":
        return torch_module.device("cpu"), "cpu"
    if request == "mps":
        if not mps_available:
            raise RuntimeError("Requested MPS backend is unavailable in this PyTorch build.")
        return torch_module.device("mps"), "mps"
    if request == "rocm":
        if not cuda_available or not is_rocm:
            raise RuntimeError("Requested ROCm backend is unavailable in this PyTorch build.")
        return torch_module.device("cuda"), "rocm"
    if not cuda_available or is_rocm:
        raise RuntimeError("Requested CUDA backend is unavailable in this PyTorch build.")
    return torch_module.device("cuda"), "cuda"


def set_deterministic_seed(seed: int) -> None:
    """Seed practical PyTorch/Numpy/Python RNGs for repeatable training."""
    seed = int(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    if hasattr(torch, "use_deterministic_algorithms"):
        torch.use_deterministic_algorithms(True, warn_only=True)
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True


def validate_binary_inputs(
    values: Any, targets: Any | None = None, feature_names: Sequence[str] | None = None
) -> tuple[np.ndarray, np.ndarray | None]:
    """Return finite float32 features and a validated binary target, when provided."""
    features = np.asarray(values, dtype=np.float32)
    if features.ndim != 2 or features.shape[0] == 0 or features.shape[1] == 0:
        raise ValueError("Features must be a non-empty two-dimensional matrix.")
    if not np.isfinite(features).all():
        raise ValueError("Features contain non-finite values.")
    if feature_names is not None and len(feature_names) != features.shape[1]:
        raise ValueError("Feature name count does not match feature columns.")

    if targets is None:
        return features, None
    response = np.asarray(targets, dtype=np.float32).reshape(-1)
    if response.shape[0] != features.shape[0]:
        raise ValueError("Feature and target row counts differ.")
    if not np.isfinite(response).all() or not np.isin(response, (0.0, 1.0)).all():
        raise ValueError("Binary targets must contain only finite 0 and 1 values.")
    if np.unique(response).size < 2:
        raise ValueError("Training requires both binary classes (0 and 1).")
    return features, response


class TorchDNN(nn.Module):
    """Small configurable feed-forward binary classifier."""

    def __init__(self, input_dim: int, hidden_layers: Sequence[int], dropout: float = 0.0):
        super().__init__()
        if input_dim < 1:
            raise ValueError("input_dim must be positive.")
        if not hidden_layers or any(int(width) < 1 for width in hidden_layers):
            raise ValueError("hidden_layers must contain one or more positive widths.")
        if not 0.0 <= float(dropout) < 1.0:
            raise ValueError("dropout must be in [0, 1).")

        layers: list[nn.Module] = []
        previous = int(input_dim)
        for width in hidden_layers:
            layers.extend((nn.Linear(previous, int(width)), nn.ReLU()))
            if dropout:
                layers.append(nn.Dropout(float(dropout)))
            previous = int(width)
        layers.append(nn.Linear(previous, 1))
        self.network = nn.Sequential(*layers)

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.network(values).squeeze(-1)


def build_model_from_metadata(metadata: Mapping[str, Any]) -> TorchDNN:
    """Rebuild an architecture stored in a device-independent artifact."""
    return TorchDNN(
        input_dim=int(metadata["input_dim"]),
        hidden_layers=[int(width) for width in metadata["hidden_layers"]],
        dropout=float(metadata.get("dropout", 0.0)),
    )
