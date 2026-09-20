import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveInputAsset: vi.fn(),
  resolveClimateCollectionDirectory: vi.fn(),
}));

vi.mock("./input-assets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./input-assets.js")>();
  return {
    ...actual,
    resolveInputAsset: mocks.resolveInputAsset,
    resolveClimateCollectionDirectory: mocks.resolveClimateCollectionDirectory,
  };
});

import { resolveModelPayload } from "./model-payload.js";

const principal = { id: "11111111-1111-4111-8111-111111111111", role: "editor" };
const projectId = "22222222-2222-4222-8222-222222222222";
const ids = {
  occurrenceAssetId: "00000000-0000-4000-8000-000000000001",
  maskAssetId: "00000000-0000-4000-8000-000000000002",
  targetGroupAssetId: "00000000-0000-4000-8000-000000000003",
  currentClimateAssetId: "00000000-0000-4000-8000-000000000004",
  futureClimateAssetId: "00000000-0000-4000-8000-000000000005",
  futureClimateAssetId2: "00000000-0000-4000-8000-000000000006",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveInputAsset.mockImplementation(async ({ assetId, expectedKind, allowedKinds }: Record<string, unknown>) => ({
    ok: true,
    absolutePath: `/safe/${String(assetId)}.${expectedKind === "climate_collection" ? "json" : "dat"}`,
    asset: { id: assetId, kind: expectedKind ?? (allowedKinds as string[])[0] },
  }));
  mocks.resolveClimateCollectionDirectory.mockImplementation(async (manifestPath: string) => manifestPath.replace(/\.json$/, ""));
});

describe("canonical model input resolution", () => {
  it("resolves every opaque input immediately before building the Plumber payload", async () => {
    const payload = await resolveModelPayload({
      ...ids,
      species: "Test species",
      modelId: "glm",
      biovars: [1, 12],
      projectionExtent: [110, 155, -45, -10],
      maskBoundaryType: "custom",
      biasMethod: "target_group",
      futureProjection: true,
      futureProjection2: true,
    }, "run-1", principal, projectId);

    expect(payload).toMatchObject({
      occurrence_file: `/safe/${ids.occurrenceAssetId}.dat`,
      mask_file: `/safe/${ids.maskAssetId}.dat`,
      target_group_file: `/safe/${ids.targetGroupAssetId}.dat`,
      worldclim_dir: `/safe/${ids.currentClimateAssetId}`,
      future_worldclim_dir: `/safe/${ids.futureClimateAssetId}`,
      future_worldclim_dir2: `/safe/${ids.futureClimateAssetId2}`,
    });
    for (const key of Object.keys(ids)) expect(payload).not.toHaveProperty(key);
    expect(mocks.resolveInputAsset).toHaveBeenCalledTimes(6);
  });

  it("requires a canonical current climate collection", async () => {
    await expect(resolveModelPayload({
      occurrenceAssetId: ids.occurrenceAssetId,
      species: "Test species",
      modelId: "glm",
    }, "run-1", principal, projectId)).rejects.toMatchObject({ reason: "invalid_request" });
  });

  it("requires canonical assets for selected custom mask, target-group, and future modes", async () => {
    for (const config of [
      { maskBoundaryType: "custom" },
      { biasMethod: "target_group" },
      { futureProjection: true },
      { futureProjection2: true },
    ]) {
      await expect(resolveModelPayload({
        occurrenceAssetId: ids.occurrenceAssetId,
        currentClimateAssetId: ids.currentClimateAssetId,
        species: "Test species",
        modelId: "glm",
        ...config,
      }, "run-1", principal, projectId)).rejects.toMatchObject({ reason: "invalid_request" });
    }
  });
});
