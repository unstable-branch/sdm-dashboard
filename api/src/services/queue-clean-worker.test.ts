import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RAW = "11111111-1111-4111-8111-111111111111";
const CLEANED = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  registerDerived: vi.fn(),
  resolveAsset: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("./input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {},
  registerDerivedInputAssetFromServerPath: mocks.registerDerived,
  resolveInputAsset: mocks.resolveAsset,
}));
vi.mock("./job-events.js", () => ({ jobEventBus: { emitJobStatus: mocks.emit } }));
vi.mock("./queue.js", () => ({ CLIMATE_DOWNLOAD_POLL_INTERVAL_MS: 0, CLIMATE_DOWNLOAD_MAX_ATTEMPTS: 2 }));
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ role: "editor" }]) })) })) })),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import { handleCleanJob } from "./queue-clean-worker.js";

const uploadRoot = resolve(process.cwd(), "../data/uploads");
const cleanedPath = resolve(uploadRoot, "queue-clean-worker-result.csv");

function job() {
  return {
    id: "clean-job-1",
    data: { payload: { rawAssetId: RAW } },
    updateProgress: vi.fn(async () => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mkdirSync(uploadRoot, { recursive: true });
  writeFileSync(cleanedPath, "longitude,latitude\n1,2\n");
  mocks.resolveAsset.mockResolvedValue({
    ok: true,
    asset: { id: RAW, scope: "private", projectId: null },
    absolutePath: resolve(uploadRoot, "raw.csv"),
  });
  mocks.registerDerived.mockResolvedValue({ id: CLEANED });
});

afterEach(() => rmSync(cleanedPath, { force: true }));

describe("queue clean worker canonical finalization", () => {
  it("returns and emits the canonical cleaned asset ID without a storage path", async () => {
    const client = {
      cleanOccurrences: vi.fn(async () => ({ job_id: "plumber-clean-1" })),
      getJobStatus: vi.fn(async () => ({ status: "completed", result: { cleaned_file_id: cleanedPath, valid_records: 1 } })),
    } as any;
    const result = await handleCleanJob(job(), client, "33333333-3333-4333-8333-333333333333");
    expect(result).toMatchObject({ status: "success", data: { rawAssetId: RAW, cleanedAssetId: CLEANED } });
    expect(result.data).not.toHaveProperty("cleaned_file_id");
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ cleanedAssetId: CLEANED }) }));
  });

  it("removes the cleaner output and fails when canonical registration fails", async () => {
    mocks.registerDerived.mockRejectedValueOnce(new Error("database unavailable"));
    const client = {
      cleanOccurrences: vi.fn(async () => ({ job_id: "plumber-clean-2" })),
      getJobStatus: vi.fn(async () => ({ status: "completed", result: { cleaned_file_id: cleanedPath } })),
    } as any;
    await expect(handleCleanJob(job(), client, "33333333-3333-4333-8333-333333333333")).resolves.toEqual({
      status: "error",
      error: "Job processing failed",
    });
    expect(existsSync(cleanedPath)).toBe(false);
  });
});
