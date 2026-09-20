import { describe, expect, it } from "vitest";
import { buildCanonicalModelSubmission, selectClimateCollectionIds } from "./climate-selection";

const scenarios = [
  { id: "current", type: "current" as const, source: "worldclim" as const, resolution: 10, climateCollectionId: "11111111-1111-4111-8111-111111111111", file_count: 19, size_bytes: 1 },
  { id: "future", type: "future" as const, gcm: "ACCESS-CM2", ssp: "SSP2-4.5", period: "2041-2060", climateCollectionId: "22222222-2222-4222-8222-222222222222", file_count: 19, size_bytes: 1 },
];

describe("selectClimateCollectionIds", () => {
  it("selects current and requested future collections without exposing paths", () => {
    expect(selectClimateCollectionIds(scenarios, {
      source: "worldclim",
      worldclimRes: 10,
      futureProjection: true,
      futureGcm: "ACCESS-CM2",
      futureSsp: "SSP2-4.5",
      futurePeriod: "2041-2060",
    })).toEqual({
      currentClimateAssetId: "11111111-1111-4111-8111-111111111111",
      futureClimateAssetId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("fails closed when a requested collection is unavailable", () => {
    expect(() => selectClimateCollectionIds([], { source: "worldclim", worldclimRes: 10 }))
      .toThrow("Current climate collection is unavailable");
    expect(() => selectClimateCollectionIds(scenarios.slice(0, 1), {
      source: "worldclim", worldclimRes: 10, futureProjection: true,
      futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
    })).toThrow("Future climate collection is unavailable");
  });

  it("removes every legacy path alias before model submission", () => {
    const submitted = buildCanonicalModelSubmission({
      source: "worldclim",
      worldclimRes: 10,
      maskFile: undefined,
      targetGroupFile: "/client/target.csv",
      futureWorldclimDir: undefined,
      futureWorldclimDir2: "/client/future",
    }, scenarios);

    expect(submitted).toMatchObject({
      currentClimateAssetId: "11111111-1111-4111-8111-111111111111",
    });
    for (const key of ["maskFile", "targetGroupFile", "futureWorldclimDir", "futureWorldclimDir2"]) {
      expect(submitted).not.toHaveProperty(key);
    }
  });
});
