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

  it("passes raw .enc cleaned file path through to occurrence_file and cleaned_file_id", () => {
    const payload = buildModelPayload({
      species: "Bison bison",
      modelId: "glm",
      cleanedFilePath: "/data/occurrences/abc123.enc",
    }, "run-001");
    expect(payload.occurrence_file).toBe("/data/occurrences/abc123.enc");
    expect(payload.cleaned_file_id).toBe("/data/occurrences/abc123.enc");
  });

  it("prefers cleanedFilePath over occurrenceFile for the raw path", () => {
    const payload = buildModelPayload({
      species: "Bison bison",
      modelId: "glm",
      cleanedFilePath: "/data/cleaned/xyz789.enc",
      occurrenceFile: "/data/raw/raw456.csv",
    }, "run-002");
    expect(payload.cleaned_file_id).toBe("/data/cleaned/xyz789.enc");
    expect(payload.occurrence_file).toBe("/data/cleaned/xyz789.enc");
  });

  it("falls back to occurrenceFile when no cleanedFilePath", () => {
    const payload = buildModelPayload({
      species: "Bison bison",
      modelId: "glm",
      occurrenceFile: "/data/raw/raw456.enc",
    }, "run-003");
    expect(payload.occurrence_file).toBe("/data/raw/raw456.enc");
    expect(payload.cleaned_file_id).toBe("/data/raw/raw456.enc");
  });

  it("sets occurrence_file and cleaned_file_id only when a rawPath is available", () => {
    const payload = buildModelPayload({
      species: "Bison bison",
      modelId: "glm",
    }, "run-004");
    expect(payload.occurrence_file).toBeNull();
    expect(payload.cleaned_file_id).toBeUndefined();
  });
});
