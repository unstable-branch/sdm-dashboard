"""sklearn Random Forest predict script."""

import json
import os
import sys
import warnings

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.io_helpers import read_config, read_environment_data, write_results

warnings.filterwarnings("ignore")


def main():
    config_path = sys.argv[1]
    config = read_config(config_path)

    data_path = config["data_path"]
    model_path = config["model_path"]
    output_dir = config["output_dir"]

    import joblib
    model = joblib.load(model_path)

    X = read_environment_data(data_path)
    predictions = model.predict_proba(X)[:, 1]
    predictions = np.clip(predictions, 0, 1)

    write_results(output_dir=output_dir, predictions=predictions)
    print(f"SUCCESS: predicted {len(predictions)} values")


if __name__ == "__main__":
    main()
