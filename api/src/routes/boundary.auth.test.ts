import { describe, expect, it, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { boundaryRoutes } from "./boundary.js";

const mocks = vi.hoisted(() => ({
  plumberPost: vi.fn(),
  plumberPostRaw: vi.fn(),
  register: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  resolve: vi.fn(async () => ({ ok: true, absolutePath: "/safe/boundary.geojson", asset: {} })),
  update: vi.fn(async () => true),
  dbSelect: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "22222222-2222-4222-8222-222222222222", email: "test@example.com", role: "editor" });
    await next();
  }),
}));
vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    withUser: vi.fn(() => ({ withRole: vi.fn(() => ({ post: mocks.plumberPost, postRaw: mocks.plumberPostRaw })) })),
  },
}));
vi.mock("../services/input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {},
  registerInputAssetFromServerPath: mocks.register,
  resolveInputAsset: mocks.resolve,
  updateInputAssetState: mocks.update,
}));
vi.mock("../services/audit.js", () => ({ logAction: vi.fn(), extractClientInfo: vi.fn(() => ({})) }));
vi.mock("../db/index.js", () => ({ db: { select: mocks.dbSelect } }));
vi.mock("../db/schema.js", () => ({ inputAssets: { kind: "kind" }, projectMembers: { projectId: "projectId", userId: "userId", role: "role" } }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function app() { return new Hono().route("/api/v1/data", boundaryRoutes); }

describe("canonical boundary route input", () => {
  it("rejects a multipart path alias before calling Plumber", async () => {
    const form = new FormData();
    form.append("file", new File(["{}"], "boundary.geojson", { type: "application/geo+json" }));
    form.append("file_path", "/etc/passwd");
    const res = await app().request("/api/v1/data/boundary/upload", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects custom default path aliases before calling Plumber", async () => {
    const res = await app().request("/api/v1/data/boundary/default?type=custom&country=/etc/passwd");
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("requires an opaque asset ID for custom defaults", async () => {
    const res = await app().request("/api/v1/data/boundary/default?type=custom");
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("translates a resolved custom default asset to a producer-owned file path", async () => {
    mocks.plumberPost.mockResolvedValueOnce({ type: "FeatureCollection" });
    const res = await app().request("/api/v1/data/boundary/default?type=custom&boundaryAssetId=11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(200);
    expect(mocks.plumberPost).toHaveBeenCalledWith("/api/v1/data/boundary/default", {
      type: "custom",
      file_path: "/safe/boundary.geojson",
    });
  });
  it("passes the destination project to current-membership asset authorization", async () => {
    mocks.plumberPost.mockResolvedValueOnce({ type: "FeatureCollection" });
    const projectId = "33333333-3333-4333-8333-333333333333";
    const res = await app().request(`/api/v1/data/boundary/default?type=custom&boundaryAssetId=11111111-1111-4111-8111-111111111111&projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ destinationProjectId: projectId }));
  });

  it("rejects project upload before invoking the producer when membership is unavailable", async () => {
    const form = new FormData();
    form.append("file", new File(["{}"], "boundary.geojson", { type: "application/geo+json" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/boundary/upload", { method: "POST", body: form });
    expect(res.status).toBe(403);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects project download before invoking the producer when membership is unavailable", async () => {
    const res = await app().request("/api/v1/data/boundary/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "33333333-3333-4333-8333-333333333333" }),
    });
    expect(res.status).toBe(403);
    expect(mocks.plumberPostRaw).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects extent file paths before calling Plumber", async () => {
    const res = await app().request("/api/v1/data/boundary/extent?file_path=/etc/passwd");
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects alternate extent path aliases before calling Plumber", async () => {
    const res = await app().request("/api/v1/data/boundary/extent?path=/etc/passwd");
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
  });

  it("requires an opaque asset ID for custom extents", async () => {
    const res = await app().request("/api/v1/data/boundary/extent?type=custom&country=/tmp/local.geojson");
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("registers a downloaded boundary and returns only its opaque ID", async () => {
    mocks.plumberPostRaw.mockResolvedValueOnce([200, {
      status: "success",
      message: "Downloaded boundary",
      file: { file_path: "/app/data/boundaries/custom/ne_110m_admin0_all.geojson" },
    }]);
    const res = await app().request("/api/v1/data/boundary/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "admin0", resolution: "110m", country: "all" }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "success",
      message: "Downloaded boundary",
      boundaryAssetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      kind: "custom_boundary",
      absolutePath: "/app/data/boundaries/custom/ne_110m_admin0_all.geojson",
    }));
  });

  it("lists a registered boundary by opaque ID and resolves that ID for extent", async () => {
    mocks.dbSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{
          id: "11111111-1111-4111-8111-111111111111",
          creatorUserId: "22222222-2222-4222-8222-222222222222",
          scope: "private",
          projectId: null,
          kind: "custom_boundary",
          contentSize: 2,
          createdAt: "2026-09-20T00:00:00.000Z",
        }]),
      })),
    });
    const listed = await app().request("/api/v1/data/boundary/list");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ boundaries: [{
      boundaryAssetId: "11111111-1111-4111-8111-111111111111",
      contentSize: 2,
      createdAt: "2026-09-20T00:00:00.000Z",
    }] });

    mocks.plumberPost.mockResolvedValueOnce({ xmin: 1, xmax: 2, ymin: 3, ymax: 4 });
    const extent = await app().request("/api/v1/data/boundary/extent?boundaryAssetId=11111111-1111-4111-8111-111111111111");
    expect(extent.status).toBe(200);
    expect(mocks.plumberPost).toHaveBeenCalledWith("/api/v1/data/boundary/extent", expect.objectContaining({
      file_path: "/safe/boundary.geojson",
    }));
  });

  it("rejects path deletion before lifecycle mutation or file deletion", async () => {
    const res = await app().request("/api/v1/data/boundary/delete/not-a-canonical-id", { method: "POST" });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.plumberPost).not.toHaveBeenCalled();
  });

  it("returns an opaque ID after registering the server-produced path", async () => {
    mocks.plumberPost.mockResolvedValueOnce({ file_path: "/app/data/boundaries/custom/boundary.geojson" });
    const form = new FormData();
    form.append("file", new File(["{}"], "boundary.geojson", { type: "application/geo+json" }));
    const res = await app().request("/api/v1/data/boundary/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ boundaryAssetId: "11111111-1111-4111-8111-111111111111" });
    expect(body.file_path).toBeUndefined();
  });
});