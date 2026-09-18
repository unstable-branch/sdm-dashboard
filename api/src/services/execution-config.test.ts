import { describe, expect, it } from "vitest";
import {
  canonicalizeExecutionConfig,
  projectSafeScienceConfig,
  revalidateHistoricalConfig,
  sanitizeStoredConfig,
} from "./execution-config.js";

const valid = {
  species: "Test species",
  modelId: "glm",
  biovars: [1, 4, 6],
  threshold: 0.65,
  seed: 7,
  enmevalTuneArgs: { fc: ["L", "LQ"], rm: [0.5, 1] },
};

describe("execution config boundary", () => {
  it("projects only explicitly allowlisted science fields", () => {
    const projected = projectSafeScienceConfig({
      ...valid,
      unknownOption: "synthetic-sentinel",
      nested: { arbitrary: true },
    });
    expect(projected).toMatchObject({ species: "Test species", modelId: "glm", threshold: 0.65, seed: 7 });
    expect(projected).not.toHaveProperty("unknownOption");
    expect(projected).not.toHaveProperty("nested");
  });

  it("rejects credential aliases at any nesting depth without retaining their values", () => {
    expect(() => projectSafeScienceConfig({ ...valid, target: [{ open_topography_api_key: "synthetic-sentinel" }] }))
      .toThrow();
    expect(() => projectSafeScienceConfig({ ...valid, opentopo_api_key: "synthetic-sentinel" }))
      .toThrow();
    expect(sanitizeStoredConfig({ ...valid, opentopoApiKey: "synthetic-sentinel" })).toBeNull();
  });

  it("canonicalizes legacy science spellings but rejects conflicting aliases", () => {
    expect(canonicalizeExecutionConfig({ model_id: "glm", threshold: 0.5 })).toEqual({ modelId: "glm", threshold: 0.5 });
    expect(() => canonicalizeExecutionConfig({ modelId: "glm", model_id: "rf" })).toThrow();
  });

  it("revalidates historical configs before retry and preserves bounded tuning", () => {
    expect(revalidateHistoricalConfig({
      species: "Test species", model_id: "glm", biovars: "1,4,6", occurrence_asset_id: "00000000-0000-0000-0000-000000000101", threshold: 0.5,
      enmeval_tune_args: { fc: ["L"], rm: [1] },
    })).toMatchObject({ modelId: "glm", biovars: [1, 4, 6], enmevalTuneArgs: { fc: ["L"], rm: [1] } });
    expect(() => revalidateHistoricalConfig({
      species: "Test species", model_id: "glm", biovars: [1, 4, 6], occurrence_asset_id: "00000000-0000-0000-0000-000000000101",
      enmeval_tune_args: { api_key: "synthetic-sentinel" },
    })).toThrow();
  });

  it("keeps canonical boundary identity on retry and rejects historical boundary paths", () => {
    expect(revalidateHistoricalConfig({
      species: "Test species",
      model_id: "glm",
      biovars: [1, 4, 6],
      occurrence_asset_id: "00000000-0000-0000-0000-000000000101",
      boundary_asset_id: "00000000-0000-0000-0000-000000000102",
      mask_type: "landmass",
      mask_boundary_type: "custom",
    })).toMatchObject({ boundaryAssetId: "00000000-0000-0000-0000-000000000102" });
    expect(() => revalidateHistoricalConfig({
      species: "Test species",
      model_id: "glm",
      biovars: [1, 4, 6],
      occurrence_asset_id: "00000000-0000-0000-0000-000000000101",
      mask_file: "/tmp/legacy-boundary.geojson",
    })).toThrow();
  });

  it("keeps canonical target-group identity and rejects historical target-group paths", () => {
    expect(revalidateHistoricalConfig({
      species: "Test species",
      model_id: "glm",
      biovars: [1, 4, 6],
      occurrence_asset_id: "00000000-0000-0000-0000-000000000101",
      bias_method: "target_group",
      target_group_asset_id: "00000000-0000-0000-0000-000000000103",
    })).toMatchObject({ targetGroupAssetId: "00000000-0000-0000-0000-000000000103" });
    expect(() => revalidateHistoricalConfig({
      species: "Test species",
      model_id: "glm",
      biovars: [1, 4, 6],
      occurrence_asset_id: "00000000-0000-0000-0000-000000000101",
      target_group_file: "/tmp/legacy-target-group.csv",
    })).toThrow();
  });
});
