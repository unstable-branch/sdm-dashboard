import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { targetGroupRoutes } from "./target-groups.js";
import { InputAssetRegistrationError } from "../services/input-assets.js";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  mkdir: vi.fn(),
  writeAtomic: vi.fn(),
  unlink: vi.fn(),
  register: vi.fn(),
  resolve: vi.fn(),
  update: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    if (!mocks.authenticated) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", { id: "22222222-2222-4222-8222-222222222222", email: "test@example.com", role: "editor" });
    await next();
  }),
}));
vi.mock("../services/input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {
    constructor(message: string, public readonly reason: string = "invalid") { super(message); }
  },
  authorizeProjectInputWrite: mocks.authorize,
  registerInputAssetFromServerPath: mocks.register, resolveInputAsset: mocks.resolve, updateInputAssetState: mocks.update,
}));
vi.mock("../services/storage.js", () => ({ writeAtomic: mocks.writeAtomic }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, unlink: mocks.unlink }));
vi.mock("../db/index.js", () => ({ db: { select: vi.fn() } }));
vi.mock("../db/schema.js", () => ({ inputAssets: { kind: "kind" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

function app() { return new Hono().route("/api/v1/data", targetGroupRoutes); }

describe("canonical target-group route input", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    vi.clearAllMocks();
    // A current editor membership is the default so project-upload tests
    // exercise the positive path; denial tests override it per case.
    mocks.authorize.mockResolvedValue({ allowed: true });
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

  it("returns only the opaque target-group asset id for an authorized project upload", async () => {
    mocks.register.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111" });
    const projectId = "33333333-3333-4333-8333-333333333333";
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", projectId);
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ targetGroupAssetId: "11111111-1111-4111-8111-111111111111" });
    // The current membership is checked before the write, and the registration
    // path keeps its own final recheck.
    expect(mocks.authorize).toHaveBeenCalledWith({
      principal: { id: "22222222-2222-4222-8222-222222222222", role: "editor" },
      projectId,
    });
    expect(mocks.mkdir).toHaveBeenCalledTimes(1);
    expect(mocks.writeAtomic).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      scope: "project",
      projectId,
      kind: "target_group",
    }));
  });

  it("does not consult project membership for a private upload", async () => {
    mocks.register.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111" });
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ scope: "private", projectId: null }));
  });

  it("denies a viewer membership before writing or registering anything", async () => {
    mocks.authorize.mockResolvedValueOnce({ allowed: false, reason: "not_authorized" });
    const projectId = "33333333-3333-4333-8333-333333333333";
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", projectId);
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Project membership does not permit target-group upload" });
    // The denial happens before the shared-storage write, so there is nothing
    // to clean up and the registration is never reached.
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeAtomic).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("fails closed when the membership lookup is unavailable", async () => {
    mocks.authorize.mockResolvedValueOnce({ allowed: false, reason: "unavailable" });
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Target-group upload authorization is unavailable" });
    expect(mocks.writeAtomic).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("maps a project membership denial recorded by registration to a typed 403 instead of an upstream 502", async () => {
    mocks.register.mockRejectedValueOnce(
      new InputAssetRegistrationError("Asset creator cannot add project inputs", "not_authorized"),
    );
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Project membership does not permit target-group upload" });
    // The request file written before registration is cleaned up on denial.
    expect(mocks.unlink).toHaveBeenCalledTimes(1);
  });

  it("keeps an unexpected registration failure an upstream 502", async () => {
    mocks.register.mockRejectedValueOnce(new Error("registration backend exploded"));
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Target-group registration failed" });
  });
});