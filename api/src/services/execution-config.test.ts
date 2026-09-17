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

  it("projects opaque input IDs and rejects path aliases", () => {
    const projected = projectSafeScienceConfig({
      ...valid,
      maskAssetId: "11111111-1111-4111-8111-111111111111",
      targetGroupAssetId: "22222222-2222-4222-8222-222222222222",
      currentClimateAssetId: "33333333-3333-4333-8333-333333333333",
      futureClimateAssetId: "44444444-4444-4444-8444-444444444444",
      futureClimateAssetId2: "55555555-5555-4555-8555-555555555555",
    });
    expect(projected).toMatchObject({ maskAssetId: "11111111-1111-4111-8111-111111111111", currentClimateAssetId: "33333333-3333-4333-8333-333333333333" });
    for (const key of ["maskFile", "targetGroupFile", "worldclimDir", "futureWorldclimDir", "futureWorldclimDir2", "occurrenceFile"]) {
      expect(() => projectSafeScienceConfig({ ...valid, [key]: "/client/path" })).toThrow();
    }
  });

  it("revalidates historical configs before retry and preserves bounded tuning", () => {
    expect(revalidateHistoricalConfig({
      species: "Test species", model_id: "glm", biovars: "1,4,6", occurrence_asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", threshold: 0.5,
      enmeval_tune_args: { fc: ["L"], rm: [1] },
    })).toMatchObject({ modelId: "glm", biovars: [1, 4, 6], enmevalTuneArgs: { fc: ["L"], rm: [1] } });
    expect(() => revalidateHistoricalConfig({
      species: "Test species", model_id: "glm", biovars: [1, 4, 6], occurrence_asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      enmeval_tune_args: { api_key: "synthetic-sentinel" },
    })).toThrow();
  });
});
