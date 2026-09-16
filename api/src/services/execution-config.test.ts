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
});
