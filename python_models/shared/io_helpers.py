"""Shared I/O helpers for Python SDM model wrappers."""

import json
import os
import sys

import numpy as np
import pandas as pd


def read_config(config_path):
    """Read model configuration from JSON file."""
    with open(config_path) as f:
        return json.load(f)


def read_training_data(data_path):
    """Read training data from feather file.

    Returns (X, y) where X is feature matrix and y is response vector.
    """
    df = pd.read_feather(data_path)
    if "presence" in df.columns:
        y = df["presence"].values
        X = df.drop(columns=["presence", ".x", ".y"], errors="ignore")
    else:
        y = None
        X = df
    return X, y


def write_results(output_dir, predictions=None, cv_metrics=None, feature_importance=None):
    """Write model results to output directory."""
    os.makedirs(output_dir, exist_ok=True)

    if predictions is not None:
        pred_df = pd.DataFrame({"prediction": predictions})
        pred_df.to_feather(os.path.join(output_dir, "predictions.feather"))

    if cv_metrics is not None:
        with open(os.path.join(output_dir, "cv_results.json"), "w") as f:
            json.dump(cv_metrics, f)

    if feature_importance is not None:
        imp_df = pd.DataFrame(feature_importance)
        imp_df.to_feather(os.path.join(output_dir, "importance.feather"))


def read_environment_data(data_path):
    """Read environmental raster data for prediction."""
    df = pd.read_feather(data_path)
    return df
