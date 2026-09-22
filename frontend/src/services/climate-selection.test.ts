import { describe, expect, it } from "vitest";
import { modelConfigDraftSchema, modelConfigSchema } from "@sdm/shared";
import { buildCanonicalModelSubmission, selectClimateCollectionIds } from "./climate-selection";

const scenarios = [
  { id: "current", type: "current" as const, source: "worldclim" as const, resolution: 10, climateCollectionId: "11111111-1111-4111-8111-111111111111", file_count: 19, size_bytes: 1 },
  { id: "chelsa-current", type: "current" as const, source: "chelsa" as const, resolution: 0.5, climateCollectionId: "33333333-3333-4333-8333-333333333333", file_count: 19, size_bytes: 1 },
  { id: "future", type: "future" as const, source: "worldclim" as const, resolution: 10, gcm: "ACCESS-CM2", ssp: "SSP2-4.5", period: "2041-2060", climateCollectionId: "22222222-2222-4222-8222-222222222222", file_count: 19, size_bytes: 1 },
  { id: "future-2", type: "future" as const, source: "worldclim" as const, resolution: 10, gcm: "MPI-ESM1-2-HR", ssp: "SSP3-7.0", period: "2061-2080", climateCollectionId: "44444444-4444-4444-8444-444444444444", file_count: 19, size_bytes: 1 },
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

  it("fails closed when future selectors match multiple opaque collections", () => {
    const duplicateFuture = [
      ...scenarios,
      {
        ...scenarios[2],
        id: "future-duplicate",
        resolution: 10,
        climateCollectionId: "66666666-6666-4666-8666-666666666666",
      },
    ];
    expect(() => selectClimateCollectionIds(duplicateFuture, {
      source: "worldclim", worldclimRes: 10, futureProjection: true,
      futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
    })).toThrow("Future climate collection is ambiguous");
  });

  it("fails closed when future collection resolution is unknown", () => {
    const unknownResolution = scenarios.map((scenario) =>
      scenario.id === "future" ? { ...scenario, resolution: undefined } : scenario
    );
    expect(() => selectClimateCollectionIds(unknownResolution, {
      source: "worldclim", worldclimRes: 10, futureProjection: true,
      futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
    })).toThrow("Future climate collection is ambiguous");
  });

  it("fails closed when only a wrong-source future collection matches", () => {
    const wrongSource = scenarios.map((scenario) =>
      scenario.id === "future" ? { ...scenario, source: "chelsa" as const } : scenario
    );
    expect(() => selectClimateCollectionIds(wrongSource, {
      source: "worldclim", worldclimRes: 10, futureProjection: true,
      futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
    })).toThrow("Future climate collection is unavailable");
  });

  it("fails closed when current metadata matches multiple opaque collections", () => {
    const duplicateCurrent = [
      ...scenarios,
      {
        ...scenarios[0],
        id: "current-duplicate",
        climateCollectionId: "77777777-7777-4777-8777-777777777777",
      },
    ];
    expect(() => selectClimateCollectionIds(duplicateCurrent, {
      source: "worldclim", worldclimRes: 10,
    })).toThrow("Current climate collection is ambiguous");
  });

  it("uses exact future resolution metadata to reject a wrong-resolution duplicate", () => {
    const resolvedFuture = [
      ...scenarios.filter((scenario) => scenario.id !== "future"),
      { ...scenarios[2], resolution: 10, climateCollectionId: "88888888-8888-4888-8888-888888888888" },
      { ...scenarios[2], id: "future-wrong-resolution", resolution: 5, climateCollectionId: "99999999-9999-4999-8999-999999999999" },
    ];
    expect(selectClimateCollectionIds(resolvedFuture, {
      source: "worldclim", worldclimRes: 10, futureProjection: true,
      futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
    }).futureClimateAssetId).toBe("88888888-8888-4888-8888-888888888888");
  });

  it("selects the native CHELSA collection when model-time aggregation is explicit", () => {
    expect(selectClimateCollectionIds(scenarios, {
      source: "chelsa", worldclimRes: 10, aggregationFactor: 20,
    })).toEqual({ currentClimateAssetId: "33333333-3333-4333-8333-333333333333" });
  });

  it("allows a coarser WorldClim target only with explicit aggregation", () => {
    const nativeWorldclim = [
      { ...scenarios[0], resolution: 5 },
    ];
    expect(selectClimateCollectionIds(nativeWorldclim, {
      source: "worldclim", worldclimRes: 10, aggregationFactor: 2,
    })).toEqual({ currentClimateAssetId: "11111111-1111-4111-8111-111111111111" });
    expect(() => selectClimateCollectionIds(nativeWorldclim, {
      source: "worldclim", worldclimRes: 10, aggregationFactor: 1,
    })).toThrow("Current climate collection is unavailable");
  });

  it("resolves both selected future scenarios", () => {
    expect(selectClimateCollectionIds(scenarios, {
      source: "worldclim", worldclimRes: 10,
      futureProjection: true, futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
      futureProjection2: true, futureGcm2: "MPI-ESM1-2-HR", futureSsp2: "SSP3-7.0", futurePeriod2: "2061-2080",
    })).toEqual({
      currentClimateAssetId: "11111111-1111-4111-8111-111111111111",
      futureClimateAssetId: "22222222-2222-4222-8222-222222222222",
      futureClimateAssetId2: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("rejects the all-country sentinel for a custom boundary", () => {
    expect(() => buildCanonicalModelSubmission({
      source: "worldclim", worldclimRes: 10, maskBoundaryType: "custom", maskAssetId: "all",
    }, scenarios)).toThrow("Custom boundary selection is unavailable");
  });

  it("preserves a selected opaque custom boundary asset ID", () => {
    const submitted = buildCanonicalModelSubmission({
      source: "worldclim", worldclimRes: 10, maskBoundaryType: "custom",
      maskAssetId: "55555555-5555-4555-8555-555555555555",
    }, scenarios);
    expect(submitted.maskAssetId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("keeps both future scenario selectors alongside resolved collection IDs", () => {
    const submitted = buildCanonicalModelSubmission({
      source: "worldclim", worldclimRes: 10,
      futureProjection: true, futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
      futureProjection2: true, futureGcm2: "MPI-ESM1-2-HR", futureSsp2: "SSP3-7.0", futurePeriod2: "2061-2080",
    }, scenarios);
    expect(submitted).toMatchObject({
      futureGcm: "ACCESS-CM2", futureSsp: "SSP2-4.5", futurePeriod: "2041-2060",
      futureGcm2: "MPI-ESM1-2-HR", futureSsp2: "SSP3-7.0", futurePeriod2: "2061-2080",
      futureClimateAssetId: "22222222-2222-4222-8222-222222222222",
      futureClimateAssetId2: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("transitions a deferred form draft into an executable opaque-ID payload", () => {
    const draft = {
      species: "Test species",
      modelId: "glm",
      biovars: [1, 4, 6],
      occurrenceAssetId: "88888888-8888-4888-8888-888888888888",
      source: "worldclim" as const,
      worldclimRes: 10,
      maskBoundaryType: "custom" as const,
      biasMethod: "target_group" as const,
      futureProjection: true,
      futureGcm: "ACCESS-CM2",
      futureSsp: "SSP2-4.5",
      futurePeriod: "2041-2060",
      futureProjection2: true,
      futureGcm2: "MPI-ESM1-2-HR",
      futureSsp2: "SSP3-7.0",
      futurePeriod2: "2061-2080",
    };
    expect(modelConfigDraftSchema.safeParse(draft).success).toBe(true);

    const submitted = buildCanonicalModelSubmission({
      ...draft,
      maskAssetId: "99999999-9999-4999-8999-999999999999",
      targetGroupAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }, scenarios);
    const executable = modelConfigSchema.safeParse(submitted);
    expect(executable.success).toBe(true);
    if (executable.success) {
      expect(executable.data).toMatchObject({
        currentClimateAssetId: "11111111-1111-4111-8111-111111111111",
        maskAssetId: "99999999-9999-4999-8999-999999999999",
        targetGroupAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        futureClimateAssetId: "22222222-2222-4222-8222-222222222222",
        futureClimateAssetId2: "44444444-4444-4444-8444-444444444444",
      });
    }
  });

  it("strips a stale custom-boundary ID when the boundary mode is not custom", () => {
    const submitted = buildCanonicalModelSubmission({
      source: "worldclim", worldclimRes: 10, maskBoundaryType: "admin0",
      maskAssetId: "99999999-9999-4999-8999-999999999999",
    }, scenarios);
    expect(submitted).not.toHaveProperty("maskAssetId");
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
