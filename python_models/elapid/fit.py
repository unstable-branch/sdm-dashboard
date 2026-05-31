"""Elapid MaxEnt SDM fit script.

Usage: python fit.py <config_path>
"""

import json
import os
import sys
import warnings

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.io_helpers import read_config, read_training_data, write_results

warnings.filterwarnings("ignore")


def fit_elapid(X, y, n_estimators=100, max_iterations=500):
    """Fit an Elapid MaxEnt model."""
    try:
        import elapid
    except ImportError:
        print("ERROR: elapid package not installed. Run: pip install elapid")
        sys.exit(1)

    model = elapid.MaxentModel(
        n_estimators=n_estimators,
        max_iterations=max_iterations,
        verbose=False
    )
    model.fit(X, y)
    return model


def main():
    config_path = sys.argv[1]
    config = read_config(config_path)

    data_path = config["data_path"]
    output_dir = config["output_dir"]

    X, y = read_training_data(data_path)
    if y is None:
        print("ERROR: Training data must contain 'presence' column")
        sys.exit(1)

    n_estimators = config.get("n_estimators", 100)
    max_iterations = config.get("max_iterations", 500)

    model = fit_elapid(X, y, n_estimators=n_estimators, max_iterations=max_iterations)

    try:
        import joblib
        model_path = os.path.join(output_dir, "model.pkl")
        joblib.dump(model, model_path)
    except ImportError:
        import pickle
        model_path = os.path.join(output_dir, "model.pkl")
        with open(model_path, "wb") as f:
            pickle.dump(model, f)

    try:
        importance = model.coef_.flatten()
        feature_names = X.columns.tolist()
        imp_max = np.max(np.abs(importance))
        if imp_max > 0:
            importance = importance / imp_max
        imp_df = [{"variable": name, "importance": float(imp)} 
                  for name, imp in zip(feature_names, importance)]
    except Exception:
        imp_df = None

    write_results(
        output_dir=output_dir,
        feature_importance=imp_df
    )

    print(f"SUCCESS: model saved to {model_path}")


if __name__ == "__main__":
    main()
