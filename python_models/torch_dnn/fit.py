"""Train the experimental device-neutral PyTorch DNN SDM backend.

Usage: python fit.py <config_path>
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import numpy as np
import torch
from torch import nn

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.io_helpers import read_config, read_training_data, write_results
from torch_dnn.model import (
    ARTIFACT_FORMAT_VERSION,
    TorchDNN,
    select_device,
    set_deterministic_seed,
    validate_binary_inputs,
)


DEFAULTS = {
    "hidden_layers": [64, 32],
    "epochs": 100,
    "batch_size": 64,
    "learning_rate": 0.001,
    "dropout": 0.1,
    "device": "auto",
    "early_stopping_patience": 12,
    "validation_fraction": 0.2,
}


def _config_value(config: dict[str, Any], key: str) -> Any:
    return config.get(key, DEFAULTS[key])


def _validated_options(config: dict[str, Any]) -> dict[str, Any]:
    hidden_layers = [int(width) for width in _config_value(config, "hidden_layers")]
    options = {
        "hidden_layers": hidden_layers,
        "epochs": int(_config_value(config, "epochs")),
        "batch_size": int(_config_value(config, "batch_size")),
        "learning_rate": float(_config_value(config, "learning_rate")),
        "dropout": float(_config_value(config, "dropout")),
        "device": str(_config_value(config, "device")),
        "early_stopping_patience": int(_config_value(config, "early_stopping_patience")),
        "validation_fraction": float(_config_value(config, "validation_fraction")),
    }
    if not options["hidden_layers"] or any(width < 1 for width in options["hidden_layers"]):
        raise ValueError("hidden_layers must contain positive integer widths.")
    if options["epochs"] < 1 or options["batch_size"] < 1:
        raise ValueError("epochs and batch_size must be positive.")
    if options["learning_rate"] <= 0:
        raise ValueError("learning_rate must be positive.")
    if not 0 <= options["dropout"] < 1:
        raise ValueError("dropout must be in [0, 1).")
    if options["early_stopping_patience"] < 1:
        raise ValueError("early_stopping_patience must be positive.")
    if not 0 < options["validation_fraction"] < 0.5:
        raise ValueError("validation_fraction must be in (0, 0.5).")
    return options


def _stratified_split(y: np.ndarray, seed: int, validation_fraction: float) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    train_indices: list[int] = []
    validation_indices: list[int] = []
    for label in (0.0, 1.0):
        indices = np.flatnonzero(y == label)
        rng.shuffle(indices)
        n_validation = max(1, int(round(len(indices) * validation_fraction)))
        n_validation = min(n_validation, len(indices) - 1)
        if n_validation < 1:
            raise ValueError("Each class needs at least two records for deterministic validation.")
        validation_indices.extend(indices[:n_validation])
        train_indices.extend(indices[n_validation:])
    return np.asarray(train_indices), np.asarray(validation_indices)


def _scale_fit(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = values.mean(axis=0, dtype=np.float64).astype(np.float32)
    scale = values.std(axis=0, dtype=np.float64).astype(np.float32)
    scale[scale == 0] = 1.0
    return (values - mean) / scale, mean, scale


def _binary_auc(y: np.ndarray, probabilities: np.ndarray) -> float:
    positives = y == 1
    negatives = y == 0
    n_positive = int(positives.sum())
    n_negative = int(negatives.sum())
    if n_positive == 0 or n_negative == 0:
        return float("nan")
    order = np.argsort(probabilities, kind="mergesort")
    ranks = np.empty(len(probabilities), dtype=float)
    ranks[order] = np.arange(1, len(probabilities) + 1, dtype=float)
    for probability in np.unique(probabilities):
        tied = probabilities == probability
        ranks[tied] = ranks[tied].mean()
    return float((ranks[positives].sum() - n_positive * (n_positive + 1) / 2) / (n_positive * n_negative))


def _tss(y: np.ndarray, probabilities: np.ndarray, threshold: float = 0.5) -> float:
    predicted = probabilities >= threshold
    positives = y == 1
    negatives = ~positives
    sensitivity = float(predicted[positives].mean()) if positives.any() else float("nan")
    specificity = float((~predicted[negatives]).mean()) if negatives.any() else float("nan")
    return sensitivity + specificity - 1.0


def _resolve_threshold(y: np.ndarray, probabilities: np.ndarray, requested: Any = 0.5) -> float:
    if isinstance(requested, str) and requested.lower() == "max_tss":
        candidates = np.unique(np.concatenate(([0.0], probabilities, [1.0])))
        scores = np.asarray([_tss(y, probabilities, float(value)) for value in candidates])
        return float(candidates[int(np.nanargmax(scores))])
    threshold = float(requested)
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("threshold must be between 0 and 1 or 'max_tss'.")
    return threshold


def _predict_probabilities(model: TorchDNN, values: np.ndarray, device: torch.device) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        logits = model(torch.as_tensor(values, dtype=torch.float32, device=device))
        return torch.sigmoid(logits).detach().cpu().numpy()


def _permutation_importance(
    model: TorchDNN, values: np.ndarray, targets: np.ndarray, feature_names: list[str], device: torch.device, seed: int
) -> list[dict[str, float]]:
    loss_function = nn.BCEWithLogitsLoss()
    model.eval()
    x_tensor = torch.as_tensor(values, dtype=torch.float32, device=device)
    y_tensor = torch.as_tensor(targets, dtype=torch.float32, device=device)
    with torch.no_grad():
        baseline = float(loss_function(model(x_tensor), y_tensor).detach().cpu())
    rng = np.random.default_rng(seed)
    raw_importance: list[float] = []
    for column in range(values.shape[1]):
        shuffled = values.copy()
        shuffled[:, column] = rng.permutation(shuffled[:, column])
        with torch.no_grad():
            loss = float(loss_function(model(torch.as_tensor(shuffled, dtype=torch.float32, device=device)), y_tensor).detach().cpu())
        raw_importance.append(max(0.0, loss - baseline))
    maximum = max(raw_importance, default=0.0)
    return [
        {"variable": name, "importance": float(value / maximum) if maximum > 0 else 0.0}
        for name, value in zip(feature_names, raw_importance)
    ]


def train_artifact(values: Any, targets: Any, feature_names: list[str], config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, float]]]:
    """Train a DNN and return a portable artifact, metrics, and importance table."""
    options = _validated_options(config)
    seed = int(config.get("seed", 42))
    set_deterministic_seed(seed)
    X, y = validate_binary_inputs(values, targets, feature_names)
    if len(X) < 8:
        raise ValueError("Training requires at least eight rows.")
    train_idx, validation_idx = _stratified_split(y, seed, options["validation_fraction"])
    _, mean, scale = _scale_fit(X[train_idx])
    X_scaled = (X - mean) / scale
    device, device_kind = select_device(options["device"])

    model = TorchDNN(X.shape[1], options["hidden_layers"], options["dropout"]).to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=options["learning_rate"])
    loss_function = nn.BCEWithLogitsLoss()
    train_x = torch.as_tensor(X_scaled[train_idx], dtype=torch.float32)
    train_y = torch.as_tensor(y[train_idx], dtype=torch.float32)
    validation_x = torch.as_tensor(X_scaled[validation_idx], dtype=torch.float32, device=device)
    validation_y = torch.as_tensor(y[validation_idx], dtype=torch.float32, device=device)
    generator = torch.Generator(device="cpu").manual_seed(seed)

    best_state: dict[str, torch.Tensor] | None = None
    best_loss = float("inf")
    epochs_without_improvement = 0
    epochs_completed = 0
    for epoch in range(options["epochs"]):
        model.train()
        permutation = torch.randperm(len(train_x), generator=generator)
        for start in range(0, len(permutation), options["batch_size"]):
            batch = permutation[start : start + options["batch_size"]]
            logits = model(train_x[batch].to(device))
            loss = loss_function(logits, train_y[batch].to(device))
            optimiser.zero_grad()
            loss.backward()
            optimiser.step()
        model.eval()
        with torch.no_grad():
            validation_loss = float(loss_function(model(validation_x), validation_y).detach().cpu())
        epochs_completed = epoch + 1
        if validation_loss < best_loss - 1e-8:
            best_loss = validation_loss
            best_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= options["early_stopping_patience"]:
                break

    assert best_state is not None
    model.load_state_dict(best_state)
    validation_probabilities = np.clip(_predict_probabilities(model, X_scaled[validation_idx], device), 0.0, 1.0)
    threshold = _resolve_threshold(y[validation_idx], validation_probabilities, config.get("threshold", 0.5))
    importance = _permutation_importance(model, X_scaled[validation_idx], y[validation_idx], feature_names, device, seed)
    artifact = {
        "format_version": ARTIFACT_FORMAT_VERSION,
        "model_state_dict": {name: tensor.detach().cpu() for name, tensor in model.state_dict().items()},
        "metadata": {
            "input_dim": int(X.shape[1]),
            "feature_names": list(feature_names),
            "hidden_layers": options["hidden_layers"],
            "dropout": options["dropout"],
            "scaling": {"mean": mean.tolist(), "scale": scale.tolist()},
            "seed": seed,
            "training_device": device_kind,
            "epochs_requested": options["epochs"],
            "epochs_completed": epochs_completed,
            "early_stopping_patience": options["early_stopping_patience"],
        },
    }
    metrics = {
        "strategy": "stratified_holdout",
        "folds": 1,
        "seed": seed,
        "validation_rows": int(len(validation_idx)),
        "validation_loss": best_loss,
        "auc": _binary_auc(y[validation_idx], validation_probabilities),
        "tss": _tss(y[validation_idx], validation_probabilities, threshold),
        "threshold": threshold,
        "device": device_kind,
        "epochs_completed": epochs_completed,
    }
    return artifact, metrics, importance


def main() -> None:
    config = read_config(sys.argv[1])
    values, targets = read_training_data(config["data_path"])
    if targets is None:
        raise ValueError("Training data must contain a 'presence' column.")
    feature_names = values.columns.tolist()
    artifact, metrics, importance = train_artifact(values.to_numpy(), targets, feature_names, config)
    output_dir = config["output_dir"]
    os.makedirs(output_dir, exist_ok=True)
    model_path = os.path.join(output_dir, "model.pkl")
    torch.save(artifact, model_path)
    write_results(output_dir=output_dir, cv_metrics=metrics, feature_importance=importance)
    print("METADATA: " + json.dumps({"device": metrics["device"], "epochs_completed": metrics["epochs_completed"], "model_path": model_path}))
    print(f"SUCCESS: model saved to {model_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
