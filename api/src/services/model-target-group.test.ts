import { beforeEach, describe, expect, it, vi } from "vitest";

const OCCURRENCE = "11111111-1111-4111-8111-111111111111";
const TARGET_GROUP = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("./input-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./input-assets.js")>();
  return { ...actual, resolveInputAsset: mocks.resolve };
});

import { ModelInputAssetError, resolveModelInputAsset, resolveModelPayload, resolveTargetsConfigs } from "./model-payload.js";

const config = {
  species: "Synthetic species",
  modelId: "glm",
  occurrenceAssetId: OCCURRENCE,
  biasMethod: "target_group",
  targetGroupAssetId: TARGET_GROUP,
};

describe("canonical target-group dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve
      .mockResolvedValueOnce({ ok: true, asset: { kind: "raw_occurrence" }, absolutePath: "/safe/occ.csv" })
      .mockResolvedValueOnce({ ok: true, asset: { kind: "target_group" }, absolutePath: "/safe/target.csv" });
  });

  it("re-resolves authority, kind, project, and content immediately before synchronous use", async () => {
    const resolved = await resolveModelInputAsset(config, { id: OCCURRENCE, role: "editor" }, PROJECT);
    expect(resolved.targetGroupPath).toBe("/safe/target.csv");
    expect(mocks.resolve).toHaveBeenNthCalledWith(2, expect.objectContaining({
      assetId: TARGET_GROUP,
      action: "use",
      expectedKind: "target_group",
      destinationProjectId: PROJECT,
    }), {});
  });

  it.each(["not_authorized", "invalid_asset", "not_found", "unsafe_storage", "unavailable"] as const)(
    "dispatches no payload when target-group resolution returns %s",
    async (reason) => {
      mocks.resolve.mockReset();
      mocks.resolve
        .mockResolvedValueOnce({ ok: true, asset: { kind: "raw_occurrence" }, absolutePath: "/safe/occ.csv" })
        .mockResolvedValueOnce({ ok: false, reason });
      await expect(resolveModelPayload(config, "run-1", { id: OCCURRENCE, role: "editor" }, PROJECT))
        .rejects.toMatchObject({ reason });
    },
  );

  it("resolves every target-group asset again for Targets dispatch", async () => {
    const rows = await resolveTargetsConfigs([config], { id: OCCURRENCE, role: "editor" }, PROJECT);
    expect(rows[0]).toMatchObject({ targetGroupFile: "/safe/target.csv" });
    expect(rows[0]).not.toHaveProperty("targetGroupAssetId");
  });

  it("rejects missing IDs and IDs on non-target-group configs", async () => {
    mocks.resolve.mockReset().mockResolvedValue({ ok: true, asset: { kind: "raw_occurrence" }, absolutePath: "/safe/occ.csv" });
    await expect(resolveModelInputAsset({ ...config, targetGroupAssetId: undefined }, { id: OCCURRENCE, role: "editor" }, PROJECT))
      .rejects.toBeInstanceOf(ModelInputAssetError);
    await expect(resolveModelInputAsset({ ...config, biasMethod: "uniform" }, { id: OCCURRENCE, role: "editor" }, PROJECT))
      .rejects.toBeInstanceOf(ModelInputAssetError);
  });
});
