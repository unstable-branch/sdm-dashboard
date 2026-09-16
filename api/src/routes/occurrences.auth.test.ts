import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataRoutes } from "./occurrences.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RAW = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "11111111-1111-4111-8111-111111111111", email: "test@example.com", role: "viewer" },
  updateInputAssetState: vi.fn(async () => true),
  registerDerivedInputAssetFromServerPath: vi.fn(async (input: { parentAssetId: string }) => ({ id: "44444444-4444-4444-8444-444444444444", parentAssetId: input.parentAssetId, creatorUserId: "11111111-1111-4111-8111-111111111111", projectId: null, scope: "private", kind: "cleaned_occurrence", state: "ready" })),
  cleanOccurrences: vi.fn(async () => ({ status: "completed", result: { cleaned_file_id: "/safe/cleaned.csv", valid_records: 2, original_rows: 3 } })),
  resolveInputAsset: vi.fn(async (options: { assetId: string; principal: { id: string } }) => {
    if (options.assetId === "33333333-3333-4333-8333-333333333333" && options.principal.id === "11111111-1111-4111-8111-111111111111") {
      return { ok: true, asset: { id: options.assetId, creatorUserId: options.principal.id, scope: "private", kind: "raw_occurrence", state: "ready", projectId: null, parentAssetId: null, contentSize: 0 }, absolutePath: "/safe/raw.csv", adminAccess: false };
    }
    return { ok: false, reason: "not_authorized" };
  }),
}));

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => { c.set("user", mocks.currentUser); await next(); }),
}));
vi.mock("../services/access.js", () => ({ getUserProjectIds: vi.fn(async () => []) }));
vi.mock("../services/input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {},
  resolveInputAsset: mocks.resolveInputAsset,
  registerDerivedInputAssetFromServerPath: mocks.registerDerivedInputAssetFromServerPath,
  updateInputAssetState: mocks.updateInputAssetState,
}));
vi.mock("../services/upload-utils.js", () => ({ setUploadDir: vi.fn(), decryptToUploads: vi.fn(), pollPlumberJob: vi.fn() }));
vi.mock("../services/encryption.js", () => ({ decrypt: vi.fn() }));
vi.mock("../services/plumber.js", () => ({
  plumberClient: { withUser: vi.fn(() => ({ withRole: vi.fn(() => ({ getUploads: vi.fn(async () => ({ uploads: [] })), cleanOccurrences: mocks.cleanOccurrences })) })) },
}));
vi.mock("../services/audit.js", () => ({ logAction: vi.fn(), extractClientInfo: vi.fn(() => ({})) }));
vi.mock("../middleware/rate-limit.js", () => ({ defaultRateLimit: vi.fn(async (_c: any, next: any) => next()) }));
vi.mock("../db/schema.js", () => {
  const table = (name: string) => ({ _name: name, name });
  return { species: table("species"), occurrences: table("occurrences"), users: table("users"), uploads: table("uploads"), inputAssets: table("input_assets"), occurrenceCleanJobs: table("occurrence_clean_jobs") };
});
vi.mock("../db/index.js", () => {
  const whereResult = (rows: unknown[] = []) => ({
    limit: async () => rows,
    returning: async () => [{ id: "33333333-3333-4333-8333-333333333333" }],
    then: (resolvePromise: (value: unknown[]) => void) => resolvePromise(rows),
  });
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => whereResult()) })) }));
  const tx = {
    update,
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };
  return { db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => whereResult()) })) })),
    update,
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
  } };
});

function app() {
  return new Hono().route("/api/v1/data", dataRoutes);
}

describe("canonical occurrence asset authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = { id: USER, email: "test@example.com", role: "viewer" };
  });

  it("rejects path-based PATCH metadata mutation", async () => {
    const res = await app().request("/api/v1/data/uploads/legacy.csv", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cleaned: true }) });
    expect(res.status).toBe(400);
  });

  it("rejects path-based deletion and never calls lifecycle mutation", async () => {
    const res = await app().request("/api/v1/data/uploads/legacy.csv", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(mocks.updateInputAssetState).not.toHaveBeenCalled();
  });

  it("rejects path-based clean-result lookups", async () => {
    const res = await app().request("/api/v1/data/occurrences/clean/result?file_id=legacy.csv");
    expect(res.status).toBe(400);
  });

  it("allows the private owner to delete only by canonical raw asset ID", async () => {
    const uploadRoot = resolve(process.cwd(), "../data/uploads");
    const rawPath = resolve(uploadRoot, "auth-delete-raw.csv");
    mkdirSync(uploadRoot, { recursive: true });
    writeFileSync(rawPath, "longitude,latitude\n1,2\n");
    mocks.resolveInputAsset.mockResolvedValueOnce({
      ok: true,
      asset: { id: RAW, creatorUserId: USER, scope: "private", kind: "raw_occurrence", state: "ready", projectId: null, parentAssetId: null, contentSize: 23 },
      absolutePath: rawPath,
      adminAccess: false,
    });
    try {
      const res = await app().request("/api/v1/data/uploads/" + RAW, { method: "DELETE" });
      expect(res.status, await res.clone().text()).toBe(200);
    } finally {
      rmSync(rawPath, { force: true });
    }
  });

  it("fails closed for a foreign canonical asset", async () => {
    const res = await app().request("/api/v1/data/uploads/" + OTHER, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(mocks.updateInputAssetState).not.toHaveBeenCalled();
  });

  it("requires a current owner for clean-result reads", async () => {
    const res = await app().request("/api/v1/data/occurrences/clean/result?raw_asset_id=" + OTHER);
    expect(res.status).toBe(404);
  });

  it("passes only the resolved raw path to the cleaner and registers a verified child", async () => {
    const res = await app().request("/api/v1/data/occurrences/clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawAssetId: RAW, species: "Test species", async: false }),
    });
    expect(res.status).toBe(200);
    expect(mocks.cleanOccurrences).toHaveBeenCalledWith(expect.objectContaining({ file_id: "/safe/raw.csv" }));
    expect((mocks.cleanOccurrences.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).not.toHaveProperty("rawAssetId");
    expect(mocks.registerDerivedInputAssetFromServerPath).toHaveBeenCalledWith(expect.objectContaining({ parentAssetId: RAW, absolutePath: "/safe/cleaned.csv" }));
    const data = await res.json();
    expect(data.cleanedAssetId).toBe("44444444-4444-4444-8444-444444444444");
    expect(data.rawAssetId).toBe(RAW);
  });

  it("returns no cleaned ID when durable derivative registration fails", async () => {
    mocks.registerDerivedInputAssetFromServerPath.mockRejectedValueOnce(new Error("registration unavailable"));
    const res = await app().request("/api/v1/data/occurrences/clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawAssetId: RAW, async: false }),
    });
    expect([502, 503]).toContain(res.status);
    expect(await res.text()).not.toContain("cleanedAssetId");
  });

  it("rejects client cleaned pointers and legacy file claims", async () => {
    const res = await app().request("/api/v1/data/occurrences/clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawAssetId: RAW, cleaned_file_id: "/safe/foreign.csv" }),
    });
    expect(res.status).toBe(400);
    expect(mocks.cleanOccurrences).not.toHaveBeenCalled();
  });
});
