"""Predict with the experimental device-neutral PyTorch DNN SDM backend.

Usage: python predict.py <config_path>
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import numpy as np
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.io_helpers import read_config, read_environment_data, write_results
from torch_dnn.model import ARTIFACT_FORMAT_VERSION, build_model_from_metadata, select_device, validate_binary_inputs


def load_artifact(model_path: str) -> dict[str, Any]:
    artifact = torch.load(model_path, map_location="cpu", weights_only=True)
    if not isinstance(artifact, dict) or artifact.get("format_version") != ARTIFACT_FORMAT_VERSION:
        raise ValueError("Unsupported or invalid torch_dnn model artifact.")
    if "metadata" not in artifact or "model_state_dict" not in artifact:
        raise ValueError("Torch DNN artifact is missing required metadata or model state.")
    return artifact


def predict_artifact(artifact: dict[str, Any], values: Any, columns: list[str], device_request: str = "auto") -> tuple[np.ndarray, str]:
    """Return ordered, bounded probabilities using portable CPU-stored model state."""
    metadata = artifact["metadata"]
    feature_names = list(metadata["feature_names"])
    missing = [name for name in feature_names if name not in columns]
    if missing:
        raise ValueError("Prediction data is missing required features: " + ", ".join(missing))
    index = [columns.index(name) for name in feature_names]
    X, _ = validate_binary_inputs(np.asarray(values)[:, index], feature_names=feature_names)
    scaling = metadata["scaling"]
    mean = np.asarray(scaling["mean"], dtype=np.float32)
    scale = np.asarray(scaling["scale"], dtype=np.float32)
    if mean.shape[0] != X.shape[1] or scale.shape[0] != X.shape[1] or np.any(scale == 0):
        raise ValueError("Torch DNN artifact has invalid scaling metadata.")
    device, device_kind = select_device(device_request)
    model = build_model_from_metadata(metadata)
    model.load_state_dict(artifact["model_state_dict"])
    model.to(device).eval()
    with torch.no_grad():
        tensor = torch.as_tensor((X - mean) / scale, dtype=torch.float32, device=device)
        probabilities = torch.sigmoid(model(tensor)).detach().cpu().numpy()
    return np.clip(probabilities, 0.0, 1.0), device_kind


def main() -> None:
    config = read_config(sys.argv[1])
    environment = read_environment_data(config["data_path"])
    artifact = load_artifact(config["model_path"])
    probabilities, device_kind = predict_artifact(
        artifact,
        environment.to_numpy(),
        environment.columns.tolist(),
        str(config.get("device", "auto")),
    )
    write_results(output_dir=config["output_dir"], predictions=probabilities)
    print("METADATA: " + json.dumps({"device": device_kind, "rows": int(len(probabilities))}))
    print(f"SUCCESS: predicted {len(probabilities)} values")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
