import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCurrentPrincipal: vi.fn(),
  resolveModelPayload: vi.fn(),
  updateWhere: vi.fn(async () => []),
  updateSet: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    update: vi.fn(() => ({ set: mocks.updateSet })),
    select: vi.fn(),
  },
}));
vi.mock("./auth-principal.js", () => ({ resolveCurrentPrincipal: mocks.resolveCurrentPrincipal }));
vi.mock("./model-payload.js", () => ({ resolveModelPayload: mocks.resolveModelPayload }));
vi.mock("./job-events.js", () => ({ jobEventBus: { emitJobStatus: mocks.emit } }));
vi.mock("./storage.js", () => ({ syncOutputsToS3: vi.fn() }));
vi.mock("./completed-run.js", () => ({ completedRunFields: vi.fn() }));
vi.mock("./queue.js", () => ({ MODEL_RUN_POLL_INTERVAL_MS: 1, MODEL_RUN_MAX_ATTEMPTS: 1 }));

import { db } from "../db/index.js";
import { handleModelJob } from "./queue-model-worker.js";

const assetId = "11111111-1111-1111-1111-111111111111";
const boundaryAssetId = "55555555-5555-4555-8555-555555555555";
const config = {
  species: "Test",
  modelId: "glm",
  occurrenceAssetId: assetId,
  boundaryAssetId,
  maskType: "landmass",
  maskBoundaryType: "custom",
};
const job = () => ({
  id: "bull-1",
  data: { type: "model", userId: "22222222-2222-2222-2222-222222222222", payload: {
    runId: "33333333-3333-3333-3333-333333333333",
    projectId: "44444444-4444-4444-4444-444444444444",
    config,
  } },
  updateProgress: vi.fn(async () => undefined),
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  mocks.resolveCurrentPrincipal.mockResolvedValue({
    id: "22222222-2222-2222-2222-222222222222", role: "editor", email: "test@example.com", source: "jwt",
  });
});

describe("queued model canonical asset dispatch", () => {
  it("re-resolves the current principal and opaque asset before Plumber dispatch", async () => {
    mocks.resolveModelPayload.mockResolvedValue({
      species: "Test", model_id: "glm", occurrence_file: "/srv/inputs/authorized.csv",
      mask_file: "/srv/inputs/authorized.geojson",
      output_dir: "outputs/jobs/33333333-3333-3333-3333-333333333333",
    });
    const client = { runModel: vi.fn(async () => ({})) } as any;

    await handleModelJob(job(), client, undefined, undefined);

    expect(mocks.resolveCurrentPrincipal).toHaveBeenCalledWith("22222222-2222-2222-2222-222222222222");
    expect(mocks.resolveModelPayload).toHaveBeenCalledWith(
      config,
      "33333333-3333-3333-3333-333333333333",
      expect.objectContaining({ id: "22222222-2222-2222-2222-222222222222", role: "editor" }),
      "44444444-4444-4444-4444-444444444444",
    );
    expect(client.runModel).toHaveBeenCalledWith(expect.objectContaining({
      occurrence_file: "/srv/inputs/authorized.csv",
      runId: "33333333-3333-3333-3333-333333333333",
    }));
    expect(client.runModel.mock.calls[0][0]).not.toHaveProperty("occurrenceAssetId");
    expect(client.runModel.mock.calls[0][0]).not.toHaveProperty("boundaryAssetId");
  });

  it.each(["foreign", "viewer", "revoked", "deleted", "quarantined", "unsafe", "database unavailable"])(
    "denies %s assets without dispatch and records a generic terminal failure",
    async () => {
      mocks.resolveModelPayload.mockRejectedValueOnce(new Error("synthetic internal denial detail"));
      const client = { runModel: vi.fn() } as any;

      await expect(handleModelJob(job(), client, undefined, undefined)).rejects.toThrow("Model input asset is unavailable");

      expect(client.runModel).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed", error: "Model input asset is unavailable",
      }));
      expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({
        state: "failed", failedReason: "Model input asset is unavailable",
      }));
    },
  );

  it("denies a deleted or demoted queued principal before resolving the asset", async () => {
    mocks.resolveCurrentPrincipal.mockResolvedValueOnce(null);
    const client = { runModel: vi.fn() } as any;

    await expect(handleModelJob(job(), client, undefined, undefined)).rejects.toThrow("Model input asset is unavailable");

    expect(mocks.resolveModelPayload).not.toHaveBeenCalled();
    expect(client.runModel).not.toHaveBeenCalled();
  });
});
