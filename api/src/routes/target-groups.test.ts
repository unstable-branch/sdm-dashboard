import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { targetGroupRoutes } from "./target-groups.js";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  mkdir: vi.fn(),
  writeAtomic: vi.fn(),
  register: vi.fn(),
  resolve: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    if (!mocks.authenticated) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", { id: "22222222-2222-4222-8222-222222222222", email: "test@example.com", role: "editor" });
    await next();
  }),
}));
vi.mock("../services/input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {},
  registerInputAssetFromServerPath: mocks.register, resolveInputAsset: mocks.resolve, updateInputAssetState: mocks.update,
}));
vi.mock("../services/storage.js", () => ({ writeAtomic: mocks.writeAtomic }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, unlink: vi.fn() }));
vi.mock("../db/index.js", () => ({ db: { select: vi.fn() } }));
vi.mock("../db/schema.js", () => ({ inputAssets: { kind: "kind" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

function app() { return new Hono().route("/api/v1/data", targetGroupRoutes); }

describe("canonical target-group route input", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    vi.clearAllMocks();
  });

  it("rejects unauthenticated uploads before writing or registering a file", async () => {
    mocks.authenticated = false;
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(401);
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeAtomic).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects a target-group path alias without writing or registering a file", async () => {
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("target_group_file", "/project/foreign/groups.csv");
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeAtomic).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects an invalid project before writing or registering a file", async () => {
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "not-an-opaque-id");
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(mocks.writeAtomic).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});