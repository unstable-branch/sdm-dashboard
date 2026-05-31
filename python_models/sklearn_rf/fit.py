"""sklearn Random Forest fit script."""

import json
import os
import sys
import warnings

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.io_helpers import read_config, read_training_data, write_results

warnings.filterwarnings("ignore")


def main():
    config_path = sys.argv[1]
    config = read_config(config_path)

    data_path = config["data_path"]
    output_dir = config["output_dir"]

    X, y = read_training_data(data_path)
    if y is None:
        print("ERROR: Training data must contain 'presence' column")
        sys.exit(1)

    n_estimators = config.get("n_estimators", 500)
    max_depth = config.get("max_depth", None)

    from sklearn.ensemble import RandomForestClassifier
    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        n_jobs=1,
        random_state=42,
        verbose=0
    )
    model.fit(X, y)

    import joblib
    model_path = os.path.join(output_dir, "model.pkl")
    joblib.dump(model, model_path)

    importance = model.feature_importances_
    imp_max = importance.max()
    if imp_max > 0:
        importance = importance / imp_max
    imp_df = [{"variable": name, "importance": float(imp)} 
              for name, imp in zip(X.columns.tolist(), importance)]

    write_results(
        output_dir=output_dir,
        feature_importance=imp_df
    )
    print(f"SUCCESS: model saved to {model_path}")


if __name__ == "__main__":
    main()
