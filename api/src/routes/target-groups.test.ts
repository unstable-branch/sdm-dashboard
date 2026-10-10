import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink } from "node:fs/promises";
import { targetGroupRoutes } from "./target-groups.js";
import { InputAssetRegistrationError } from "../services/input-assets.js";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  register: vi.fn(),
  resolve: vi.fn(),
  update: vi.fn(),
  authorize: vi.fn(),
  uploadRoot: vi.fn(),
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
  registerInputAssetFromServerPath: mocks.register, resolveInputAssetUploadRoot: mocks.uploadRoot,
  resolveInputAsset: mocks.resolve, updateInputAssetState: mocks.update,
}));
vi.mock("../db/index.js", () => ({ db: { select: vi.fn() } }));
vi.mock("../db/schema.js", () => ({ inputAssets: { kind: "kind" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

function app() { return new Hono().route("/api/v1/data", targetGroupRoutes); }
let base: string;
let uploadRoot: string;

describe("canonical target-group route input", () => {
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "sdm-target-group-route-"));
    uploadRoot = join(base, "uploads");
    await mkdir(uploadRoot);
    mocks.authenticated = true;
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ allowed: true });
    mocks.uploadRoot.mockImplementation(async () => uploadRoot);
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("rejects unauthenticated uploads before writing or registering a file", async () => {
    mocks.authenticated = false;
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(401);
    expect(await readdir(uploadRoot)).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects a target-group path alias without writing or registering a file", async () => {
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("target_group_file", "/project/foreign/groups.csv");
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await readdir(uploadRoot)).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects an invalid project before writing or registering a file", async () => {
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "not-an-opaque-id");
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await readdir(uploadRoot)).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("returns only the opaque target-group asset id for an authorized project upload", async () => {
    mocks.register.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111" });
    const projectId = "33333333-3333-4333-8333-333333333333";
    const contents = "species,target_group\nA,1";
    const form = new FormData();
    form.append("file", new File([contents], "groups.csv", { type: "text/csv" }));
    form.append("projectId", projectId);
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ targetGroupAssetId: "11111111-1111-4111-8111-111111111111" });
    expect(mocks.authorize).toHaveBeenCalledWith({
      principal: { id: "22222222-2222-4222-8222-222222222222", role: "editor" }, projectId,
    });
    const registration = mocks.register.mock.calls[0][0];
    expect(registration).toMatchObject({ scope: "project", projectId, kind: "target_group" });
    expect(registration.contentSha256).toBe(createHash("sha256").update(contents).digest("hex"));
    expect(await readFile(registration.absolutePath, "utf8")).toBe(contents);
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
    expect(await readdir(uploadRoot)).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("fails closed when the membership lookup is unavailable", async () => {
    mocks.authorize.mockResolvedValueOnce({ allowed: false, reason: "unavailable" });
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/target-group/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Target-group upload authorization is unavailable" });
    expect(await readdir(uploadRoot)).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("maps a project membership denial recorded by registration to a typed 403 instead of an upstream 502", async () => {
    mocks.register.mockRejectedValueOnce(new InputAssetRegistrationError("Asset creator cannot add project inputs", "not_authorized"));
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Project membership does not permit target-group upload" });
    // The pre-write authorization passed; failure at registration retains the
    // unregistered bytes rather than risking deletion of a raced replacement.
    const retained = await readdir(uploadRoot);
    expect(retained).toHaveLength(1);
    expect(await readFile(join(uploadRoot, retained[0]), "utf8")).toBe("species,target_group\nA,1");
  });

  it("keeps an unexpected registration failure an upstream 502", async () => {
    mocks.register.mockRejectedValueOnce(new Error("registration backend exploded"));
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    form.append("projectId", "33333333-3333-4333-8333-333333333333");
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Target-group registration failed" });
    const retained = await readdir(uploadRoot);
    expect(retained).toHaveLength(1);
    expect(await readFile(join(uploadRoot, retained[0]), "utf8")).toBe("species,target_group\nA,1");
  });

  it("fails closed on an invalid configured root without creating, writing or registering", async () => {
    mocks.uploadRoot.mockResolvedValue(null);
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(await readdir(uploadRoot)).toEqual([]);
  });

  it("never redirects upload bytes outside the root when its name is rebound", async () => {
    const moved = join(base, "original");
    const outside = join(base, "outside");
    await mkdir(outside);
    mocks.uploadRoot.mockImplementation(async () => {
      await rename(uploadRoot, moved);
      await symlink(outside, uploadRoot);
      return uploadRoot;
    });
    const form = new FormData();
    form.append("file", new File(["species,target_group\nA,1"], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(502);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(moved)).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("writes to the default data/uploads root when configured root is unset", async () => {
    uploadRoot = join(base, "data", "uploads");
    mocks.uploadRoot.mockResolvedValue(uploadRoot);
    mocks.register.mockImplementation(async ({ absolutePath }: { absolutePath: string }) => ({
      id: "11111111-1111-4111-8111-111111111111", absolutePath, bytes: await readFile(absolutePath),
    }));
    const contents = "species,target_group\nA,1";
    const form = new FormData();
    form.append("file", new File([contents], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const registered = await mocks.register.mock.results[0]?.value;
    expect(registered.absolutePath).toContain(uploadRoot);
    expect(registered.bytes.toString("utf8")).toBe(contents);
  });

  it("writes custom-root bytes and binds registration to their expected content hash", async () => {
    mocks.register.mockImplementation(async ({ absolutePath }: { absolutePath: string }) => ({
      id: "11111111-1111-4111-8111-111111111111", absolutePath, bytes: await readFile(absolutePath),
    }));
    const contents = "species,target_group\nA,1";
    const form = new FormData();
    form.append("file", new File([contents], "groups.csv", { type: "text/csv" }));
    const res = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const result = await mocks.register.mock.results[0]?.value;
    expect(result.absolutePath).toContain(uploadRoot);
    expect(result.bytes.toString("utf8")).toBe(contents);
    expect(mocks.register.mock.calls[0][0].contentSha256).toBe(createHash("sha256").update(contents).digest("hex"));
  });
});
