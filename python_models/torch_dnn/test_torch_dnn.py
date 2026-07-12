"""Focused CPU tests for the portable torch_dnn backend.

Run from the repository root:
  python3 -m pytest python_models/torch_dnn/test_torch_dnn.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from torch_dnn.fit import train_artifact
from torch_dnn.model import select_device
from torch_dnn.predict import load_artifact, predict_artifact


class FakeTorch:
    def __init__(self, cuda: bool, hip: str | None, mps: bool):
        self.cuda = type("Cuda", (), {"is_available": staticmethod(lambda: cuda)})()
        self.version = type("Version", (), {"hip": hip})()
        self.backends = type("Backends", (), {"mps": type("Mps", (), {"is_available": staticmethod(lambda: mps)})()})()
        self.device = lambda name: name


def synthetic_data() -> tuple[np.ndarray, np.ndarray, list[str]]:
    rng = np.random.default_rng(9)
    values = rng.normal(size=(40, 3)).astype(np.float32)
    targets = (values[:, 0] * 1.5 - values[:, 1] > 0).astype(np.float32)
    return values, targets, ["bio1", "bio12", "elevation"]


def fast_config() -> dict[str, object]:
    return {
        "seed": 21,
        "device": "cpu",
        "hidden_layers": [8, 4],
        "epochs": 20,
        "batch_size": 8,
        "learning_rate": 0.02,
        "dropout": 0.0,
        "early_stopping_patience": 6,
        "validation_fraction": 0.25,
    }


def test_backend_selection_distinguishes_rocm_cuda_mps_and_cpu():
    assert select_device("auto", FakeTorch(cuda=True, hip="6.2", mps=False)) == ("cuda", "rocm")
    assert select_device("auto", FakeTorch(cuda=True, hip=None, mps=False)) == ("cuda", "cuda")
    assert select_device("auto", FakeTorch(cuda=False, hip=None, mps=True)) == ("mps", "mps")
    assert select_device("auto", FakeTorch(cuda=False, hip=None, mps=False)) == ("cpu", "cpu")


def test_explicit_unavailable_backend_is_an_error():
    with pytest.raises(RuntimeError, match="ROCm backend is unavailable"):
        select_device("rocm", FakeTorch(cuda=False, hip=None, mps=False))


def test_cpu_roundtrip_preserves_order_bounds_and_metadata(tmp_path):
    values, targets, names = synthetic_data()
    artifact, metrics, importance = train_artifact(values, targets, names, fast_config())
    artifact_path = tmp_path / "model.pkl"
    torch.save(artifact, artifact_path)
    loaded = load_artifact(str(artifact_path))
    probabilities, device = predict_artifact(loaded, values[:, [2, 0, 1]], [names[2], names[0], names[1]], "cpu")

    assert device == "cpu"
    assert probabilities.shape == (len(values),)
    assert np.all((0.0 <= probabilities) & (probabilities <= 1.0))
    assert artifact["metadata"]["feature_names"] == names
    assert artifact["metadata"]["scaling"]["mean"]
    assert artifact["metadata"]["training_device"] == "cpu"
    assert metrics["strategy"] == "stratified_holdout"
    assert metrics["folds"] == 1
    assert len(importance) == len(names)


def test_cpu_training_is_deterministic_for_fixed_seed():
    values, targets, names = synthetic_data()
    first, _, _ = train_artifact(values, targets, names, fast_config())
    second, _, _ = train_artifact(values, targets, names, fast_config())
    first_probabilities, _ = predict_artifact(first, values, names, "cpu")
    second_probabilities, _ = predict_artifact(second, values, names, "cpu")
    np.testing.assert_allclose(first_probabilities, second_probabilities, rtol=0, atol=1e-7)


def test_max_tss_threshold_is_supported():
    values, targets, names = synthetic_data()
    artifact, metrics, _ = train_artifact(values, targets, names, {**fast_config(), "threshold": "max_tss"})

    assert artifact["metadata"]["training_device"] == "cpu"
    assert 0.0 <= metrics["threshold"] <= 1.0
    assert -1.0 <= metrics["tss"] <= 1.0


def test_nonfinite_input_is_rejected():
    values, targets, names = synthetic_data()
    values[0, 0] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        train_artifact(values, targets, names, fast_config())


@pytest.mark.skipif(
    not torch.cuda.is_available() or torch.version.hip is None,
    reason="requires a ROCm-enabled PyTorch build and AMD GPU",
)
def test_rocm_hardware_training_and_prediction_roundtrip():
    values, targets, names = synthetic_data()
    config = fast_config()
    config.update({"device": "rocm", "epochs": 8, "early_stopping_patience": 3})

    artifact, metrics, _ = train_artifact(values, targets, names, config)
    probabilities, device = predict_artifact(artifact, values, names, "rocm")

    assert device == "rocm"
    assert metrics["device"] == "rocm"
    assert artifact["metadata"]["training_device"] == "rocm"
    assert probabilities.shape == (len(values),)
    assert np.isfinite(probabilities).all()
    assert np.all((0.0 <= probabilities) & (probabilities <= 1.0))
