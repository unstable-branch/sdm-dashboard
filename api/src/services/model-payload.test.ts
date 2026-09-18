import { describe, it, expect } from "vitest";
import { buildModelPayload, buildTargetsConfig } from "./model-payload.js";

const RESOLVED = "/srv/sdm-inputs/owned/occurrences.csv";

describe("buildModelPayload", () => {
  it("maps contract keys and uses only the server-resolved occurrence path", () => {
    const payload = buildModelPayload({
      species: "Test species",
      modelId: "multi_ensemble",
      occurrenceAssetId: "11111111-1111-1111-1111-111111111111",
      dnnArchitecture: "DNN_Medium",
      dnnL2Lambda: 0.001,
      dnnMultispeciesArchitecture: "DNN_Large",
      dnnMultispeciesNSeeds: 4,
      multiEnsembleBiomod2: ["Biomod2"],
      biomod2Models: ["Biomod2", "Biomod2_maxent"],
      xgbNrounds: 15,
      xgbNRounds: 50,
      biovars: [1, 4, 6, 12],
      projectionExtent: [-180, 180, -90, 90],
    }, "run-1", RESOLVED);

    expect(payload).toMatchObject({
      species: "Test species",
      model_id: "multi_ensemble",
      occurrence_file: RESOLVED,
      dnn_model_type: "DNN_Medium",
      dnn_lambda: 0.001,
      dnn_multispecies_architecture: "DNN_Large",
      dnn_multispecies_n_seeds: 4,
      biomod2_models: ["Biomod2", "Biomod2_maxent"],
      xgb_nrounds: 50,
      biovars: "1,4,6,12",
      projection_extent: "-180,180,-90,90",
      output_dir: "outputs/jobs/run-1",
    });
    expect(payload).not.toHaveProperty("occurrenceAssetId");
    expect(payload).not.toHaveProperty("cleaned_file_id");
  });

  it("normalizes Python manifest camelCase fields", () => {
    const payload = buildModelPayload({
      species: "Test species", modelId: "python_torch_dnn",
      hiddenLayers: [128, 64], batchSize: 32, predictBatchSize: 4096,
      learningRate: 0.002, pythonDevice: "rocm", earlyStoppingPatience: 8,
      validationFraction: 0.25,
    }, "run-python", RESOLVED);
    expect(payload).toMatchObject({
      hidden_layers: [128, 64], batch_size: 32, predict_batch_size: 4096,
      learning_rate: 0.002, python_device: "rocm", early_stopping_patience: 8,
      validation_fraction: 0.25,
    });
  });

  it("drops unknown keys and preserves server-derived output_dir", () => {
    const payload = buildModelPayload({
      species: "Test species", modelId: "glm", analysisCrs: "EPSG:4326",
      untrustedOption: "synthetic-sentinel", biovars: [3, 6],
    }, "run-2", RESOLVED);
    expect(payload.analysis_crs).toBe("EPSG:4326");
    expect(payload.untrustedOption).toBeUndefined();
    expect(payload.biovars).toBe("3,6");
    expect(payload.output_dir).toBe("outputs/jobs/run-2");
  });

  it("forwards only the resolved custom-boundary path", () => {
    const boundaryPath = "/srv/sdm-inputs/owned/boundary.geojson";
    const payload = buildModelPayload({
      species: "Test species",
      modelId: "glm",
      boundaryAssetId: "11111111-1111-4111-8111-111111111112",
      maskType: "landmass",
      maskBoundaryType: "custom",
    }, "run-boundary", RESOLVED, boundaryPath);
    expect(payload.mask_file).toBe(boundaryPath);
    expect(payload).not.toHaveProperty("boundaryAssetId");
    expect(payload).not.toHaveProperty("boundary_asset_id");
  });

  it("materializes targets configs without exposing canonical IDs", () => {
    const config = buildTargetsConfig({
      species: "Test species", modelId: "glm",
      occurrenceAssetId: "11111111-1111-1111-1111-111111111111",
    }, RESOLVED);
    expect(config.occurrenceFile).toBe(RESOLVED);
    expect(config.occurrenceAssetId).toBeUndefined();
  });
});

describe("secret-free model payloads", () => {
  it("rejects every OpenTopography alias before payload construction", () => {
    for (const key of ["opentopoApiKey", "opentopo_api_key", "open_topography_api_key", "opentopographyApiKey"]) {
      expect(() => buildModelPayload({ species: "Test", modelId: "glm", [key]: "synthetic-sentinel" }, "run-secret", RESOLVED)).toThrow();
    }
  });

  it("does not forward credential aliases hidden in nested unknown objects", () => {
    expect(() => buildModelPayload({
      species: "Test", modelId: "glm", nested: { api_key: "synthetic-sentinel" },
    }, "run-nested-secret", RESOLVED)).toThrow();
  });

  it("rejects client-controlled boundary path aliases", () => {
    for (const key of ["maskFile", "mask_file"]) {
      expect(() => buildModelPayload({ species: "Test", modelId: "glm", [key]: "/tmp/escape.geojson" }, "run-path", RESOLVED)).toThrow();
    }
  });
});
