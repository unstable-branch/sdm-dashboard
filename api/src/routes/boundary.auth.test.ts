import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { boundaryRoutes } from "./boundary.js";

const mocks = vi.hoisted(() => ({
  plumberPost: vi.fn(),
  plumberPostRaw: vi.fn(),
  register: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  resolve: vi.fn(async () => ({ ok: true, absolutePath: "/safe/boundary.geojson", asset: {} })),
  update: vi.fn(async () => true),
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
vi.mock("../db/index.js", () => ({ db: { select: vi.fn() } }));
vi.mock("../db/schema.js", () => ({ inputAssets: { kind: "kind" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((left: unknown, right: unknown) => ({ left, right })) }));

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
  it("rejects extent file paths before calling Plumber", async () => {
    const res = await app().request("/api/v1/data/boundary/extent?file_path=/etc/passwd");
    expect(res.status).toBe(400);
    expect(mocks.plumberPost).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects path deletion before lifecycle mutation or file deletion", async () => {
    const res = await app().request("/api/v1/data/boundary/delete/not-a-canonical-id", { method: "POST" });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.plumberPost).not.toHaveBeenCalled();
  });

  it("returns an opaque ID after registering the server-produced path", async () => {
    mocks.plumberPost.mockResolvedValueOnce({ file_path: "/app/data/uploads/boundary.geojson" });
    const form = new FormData();
    form.append("file", new File(["{}"], "boundary.geojson", { type: "application/geo+json" }));
    const res = await app().request("/api/v1/data/boundary/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ boundaryAssetId: "11111111-1111-4111-8111-111111111111" });
    expect(body.file_path).toBeUndefined();
  });
});