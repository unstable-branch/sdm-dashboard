import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const USER = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const SAFE_PATH = "/app/data/uploads/boundaries/synthetic.geojson";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  postRaw: vi.fn(),
  resolve: vi.fn(),
  register: vi.fn(),
  updateState: vi.fn(),
  selectRows: [] as Record<string, unknown>[],
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set("user", { id: USER, role: "editor", email: "synthetic@example.invalid" });
    await next();
  },
}));

vi.mock("../services/plumber", () => ({
  plumberClient: {
    withUser: vi.fn(() => ({
      withRole: vi.fn(() => ({ post: mocks.post, postRaw: mocks.postRaw })),
    })),
  },
}));

vi.mock("../services/input-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/input-assets.js")>();
  return {
    ...actual,
    resolveInputAsset: mocks.resolve,
    registerInputAssetFromServerPath: mocks.register,
    updateInputAssetState: mocks.updateState,
  };
});

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => mocks.selectRows) })),
    })),
  },
}));

vi.mock("../services/audit", () => ({
  logAction: vi.fn(async () => undefined),
  extractClientInfo: vi.fn(() => ({})),
}));

import { boundaryRoutes } from "./boundary.js";

function app() {
  return new Hono().route("/api/v1/data", boundaryRoutes);
}

function readyResolution() {
  return {
    ok: true as const,
    asset: {
      id: ASSET,
      creatorUserId: USER,
      projectId: null,
      scope: "private",
      kind: "custom_boundary",
      storageLocator: "boundaries/synthetic.geojson",
      parentAssetId: null,
      state: "ready",
      contentSha256: "a".repeat(64),
      contentSize: 12,
      createdAt: new Date("2026-09-18T00:00:00Z"),
      updatedAt: new Date("2026-09-18T00:00:00Z"),
      deletedAt: null,
      quarantinedAt: null,
    },
    absolutePath: SAFE_PATH,
    adminAccess: false,
  };
}

describe("canonical boundary routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [];
    mocks.resolve.mockResolvedValue(readyResolution());
    mocks.register.mockResolvedValue(readyResolution().asset);
    mocks.updateState.mockResolvedValue(true);
    mocks.post.mockResolvedValue({ ok: true });
    mocks.postRaw.mockResolvedValue([200, { status: "success" }]);
  });

  it("rejects client paths before calling Plumber", async () => {
    for (const url of [
      "/api/v1/data/boundary/default?type=custom&file_path=/tmp/escape.geojson",
      "/api/v1/data/boundary/extent?type=custom&file_path=/tmp/escape.geojson",
    ]) {
      const res = await app().request(url);
      expect(res.status).toBe(400);
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("resolves an opaque ID immediately before custom extent use", async () => {
    mocks.post.mockResolvedValue({ xmin: 1, xmax: 2, ymin: 3, ymax: 4 });
    const res = await app().request(`/api/v1/data/boundary/extent?type=custom&asset_id=${ASSET}`);
    expect(res.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      assetId: ASSET,
      action: "use",
      expectedKind: "custom_boundary",
    }));
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/data/boundary/extent", expect.objectContaining({
      type: "custom",
      file_path: SAFE_PATH,
    }));
  });

  it.each(["not_authorized", "invalid_asset", "unsafe_storage", "not_found"])(
    "fails closed for %s assets",
    async (reason) => {
      mocks.resolve.mockResolvedValue({ ok: false, reason });
      const res = await app().request(`/api/v1/data/boundary/default?type=custom&asset_id=${ASSET}`);
      expect(res.status).toBe(404);
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it("registers upload output and returns no server path", async () => {
    mocks.post.mockResolvedValue({ file_path: SAFE_PATH, file_size: 12 });
    const form = new FormData();
    form.set("file", new File(["synthetic"], "boundary.geojson", { type: "application/geo+json" }));
    const res = await app().request("/api/v1/data/boundary/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      creatorUserId: USER,
      scope: "private",
      kind: "custom_boundary",
      absolutePath: SAFE_PATH,
    }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.asset_id).toBe(ASSET);
    expect(JSON.stringify(body)).not.toContain(SAFE_PATH);
  });

  it("lists only opaque canonical metadata", async () => {
    mocks.selectRows = [readyResolution().asset];
    const res = await app().request("/api/v1/data/boundary/list");
    expect(res.status).toBe(200);
    const body = await res.json() as { boundaries: Array<Record<string, unknown>> };
    expect(body.boundaries).toHaveLength(1);
    expect(body.boundaries[0]).toMatchObject({ asset_id: ASSET, file_name: "synthetic.geojson" });
    expect(JSON.stringify(body)).not.toContain(SAFE_PATH);
    expect(JSON.stringify(body)).not.toContain("storageLocator");
  });

  it("cleans up an unregistered producer file", async () => {
    mocks.post
      .mockResolvedValueOnce({ file_path: SAFE_PATH })
      .mockResolvedValueOnce({ ok: true });
    mocks.register.mockRejectedValue(new Error("registration unavailable"));
    const form = new FormData();
    form.set("file", new File(["synthetic"], "boundary.geojson"));
    const res = await app().request("/api/v1/data/boundary/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    expect(mocks.post).toHaveBeenLastCalledWith("/api/v1/data/boundary/delete", { file_path: SAFE_PATH });
  });

  it("quarantines before physical deletion and finalizes only after success", async () => {
    const res = await app().request(`/api/v1/data/boundary/delete/${ASSET}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(mocks.updateState.mock.invocationCallOrder[0]).toBeLessThan(mocks.post.mock.invocationCallOrder[0]);
    expect(mocks.updateState).toHaveBeenNthCalledWith(1, ASSET, "quarantined");
    expect(mocks.updateState).toHaveBeenNthCalledWith(2, ASSET, "deleted");
  });

  it("leaves a failed physical deletion quarantined", async () => {
    mocks.post.mockRejectedValue(new Error("storage unavailable"));
    const res = await app().request(`/api/v1/data/boundary/delete/${ASSET}`, { method: "DELETE" });
    expect(res.status).toBe(502);
    expect(mocks.updateState).toHaveBeenCalledTimes(1);
    expect(mocks.updateState).toHaveBeenCalledWith(ASSET, "quarantined");
  });
});
