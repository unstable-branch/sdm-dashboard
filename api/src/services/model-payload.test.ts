import { describe, it, expect } from "vitest";
import { buildModelPayload } from "./model-payload.js";

describe("buildModelPayload", () => {
  it("maps contract keys for DNN and ensemble settings", () => {
    const payload = buildModelPayload({
      species: "Test species",
      modelId: "multi_ensemble",
      dnnArchitecture: "DNN_Medium",
      dnnL2Lambda: 0.001,
      dnnMultispeciesArchitecture: "DNN_Large",
      dnnMultispeciesNSeeds: 4,
      multiEnsembleBiomod2: ["Biomod2"],
      biomod2Models: ["Biomod2", "Biomod2_maxent"],
      xgbNrounds: 15,
      xgbNRounds: 22,
      biovars: [1, 4, 6, 12],
      projectionExtent: [-180, 180, -90, 90],
    }, "run-1");

    expect(payload).toMatchObject({
      dnn_model_type: "DNN_Medium",
      dnn_lambda: 0.001,
      dnn_multispecies_architecture: "DNN_Large",
      dnn_multispecies_n_seeds: 4,
      biomod2_models: ["Biomod2", "Biomod2_maxent"],
      xgb_nrounds: 22,
      biovars: "1,4,6,12",
      projection_extent: "-180,180,-90,90",
      output_dir: "outputs/jobs/run-1",
    });

    expect(payload).toHaveProperty("species", "Test species");
    expect(payload).toHaveProperty("model_id", "multi_ensemble");
  });

  it("normalizes Python manifest camelCase fields", () => {
    const payload = buildModelPayload({
      species: "Test species",
      modelId: "python_torch_dnn",
      hiddenLayers: [128, 64],
      batchSize: 32,
      predictBatchSize: 4096,
      learningRate: 0.002,
      pythonDevice: "rocm",
      earlyStoppingPatience: 8,
      validationFraction: 0.25,
    }, "run-python");

    expect(payload).toMatchObject({
      hidden_layers: [128, 64],
      batch_size: 32,
      predict_batch_size: 4096,
      learning_rate: 0.002,
      python_device: "rocm",
      early_stopping_patience: 8,
      validation_fraction: 0.25,
    });
  });

  it("keeps unknown keys as-is and preserves output_dir shape", () => {
    const payload = buildModelPayload({
      species: "Test species",
      modelId: "glm",
      analysisCrs: "EPSG:4326",
      biovars: [3, 6],
    }, "run-2");

    expect(payload.analysis_crs).toBe("EPSG:4326");
    expect(payload.biovars).toBe("3,6");
    expect(payload.output_dir).toBe("outputs/jobs/run-2");
  });
});
