#!/usr/bin/env python3
"""Repeatable synthetic benchmark for the portable torch_dnn backend."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from torch_dnn.fit import train_artifact
from torch_dnn.model import select_device
from torch_dnn.predict import predict_artifact


def synchronize(device: torch.device) -> None:
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elif device.type == "mps":
        torch.mps.synchronize()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="auto", choices=("auto", "cuda", "rocm", "mps", "cpu"))
    parser.add_argument("--train-rows", type=int, default=10000)
    parser.add_argument("--predict-rows", type=int, default=250000)
    parser.add_argument("--features", type=int, default=12)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--predict-batch-size", type=int, default=65536)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if min(args.train_rows, args.predict_rows, args.features, args.epochs, args.batch_size, args.predict_batch_size) < 1:
        parser.error("row, feature, epoch, and batch values must be positive")

    rng = np.random.default_rng(args.seed)
    feature_names = [f"feature_{index + 1}" for index in range(args.features)]
    train_values = rng.normal(size=(args.train_rows, args.features)).astype(np.float32)
    weights = np.linspace(1.5, -0.5, args.features, dtype=np.float32)
    logits = train_values @ weights + rng.normal(scale=0.5, size=args.train_rows)
    targets = (logits > np.median(logits)).astype(np.float32)
    predict_values = rng.normal(size=(args.predict_rows, args.features)).astype(np.float32)

    device, device_kind = select_device(args.device)
    # Exclude one-time context initialization from model throughput timings.
    warmup = torch.ones((128, 128), dtype=torch.float32, device=device)
    _ = warmup @ warmup
    synchronize(device)
    del warmup

    config = {
        "seed": args.seed,
        "device": args.device,
        "hidden_layers": [64, 32],
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": 0.001,
        "dropout": 0.1,
        "early_stopping_patience": args.epochs + 1,
        "validation_fraction": 0.2,
    }

    started = time.perf_counter()
    artifact, metrics, _ = train_artifact(train_values, targets, feature_names, config)
    synchronize(device)
    train_seconds = time.perf_counter() - started

    started = time.perf_counter()
    probabilities, prediction_device = predict_artifact(
        artifact,
        predict_values,
        feature_names,
        args.device,
        batch_size=args.predict_batch_size,
    )
    synchronize(device)
    predict_seconds = time.perf_counter() - started

    result = {
        "backend": device_kind,
        "prediction_backend": prediction_device,
        "device_name": torch.cuda.get_device_name(device) if device.type == "cuda" else str(device),
        "torch_version": torch.__version__,
        "hip_version": torch.version.hip,
        "cuda_version": torch.version.cuda,
        "train_rows": args.train_rows,
        "predict_rows": args.predict_rows,
        "features": args.features,
        "epochs_completed": metrics["epochs_completed"],
        "batch_size": args.batch_size,
        "predict_batch_size": args.predict_batch_size,
        "train_seconds": round(train_seconds, 6),
        "train_rows_per_second": round(args.train_rows * metrics["epochs_completed"] / train_seconds, 2),
        "predict_seconds": round(predict_seconds, 6),
        "predict_rows_per_second": round(args.predict_rows / predict_seconds, 2),
        "probability_mean": round(float(probabilities.mean()), 8),
    }
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
