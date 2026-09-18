import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";

const ROOT = "/tmp/opencode/sdm-target-group-route-tests";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "11111111-1111-4111-8111-111111111112";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const FOREIGN_PROJECT = "22222222-2222-4222-8222-222222222223";
const ASSET = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => {
  process.env.SDM_INPUT_ASSET_TARGET_GROUP_ROOT = "/tmp/opencode/sdm-target-group-route-tests";
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    globalRole: "editor",
    membershipRole: "editor" as string | undefined,
    projectId: "22222222-2222-4222-8222-222222222222",
    projectOwnerId: "11111111-1111-4111-8111-111111111111",
    listRows: [] as Record<string, unknown>[],
    assetRows: [] as Record<string, unknown>[],
    reserveResults: [true] as boolean[],
    reserveError: false,
    finalizationFailure: null as null | "state" | "accounting",
    resolve: vi.fn(),
    register: vi.fn(),
    updateState: vi.fn(),
    ensureDefaultProject: vi.fn(),
    reserveCalls: vi.fn(),
    finalizeStateCalls: vi.fn(),
    accountingCalls: vi.fn(),
    transactionCalls: vi.fn(),
  };
});

vi.mock("../middleware/auth", () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set("user", { id: mocks.userId, role: mocks.globalRole, email: "synthetic@example.invalid" });
    await next();
  },
}));

vi.mock("../services/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/access.js")>()),
  ensureDefaultProject: mocks.ensureDefaultProject,
}));

vi.mock("../db", async () => {
  const schema = await import("../db/schema.js");

  const update = (table: unknown, inTransaction = false) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          if (!inTransaction && table === schema.users) {
            mocks.reserveCalls({ values, condition });
            if (mocks.reserveError) throw new Error("accounting unavailable");
            return (mocks.reserveResults.shift() ?? false) ? [{ id: mocks.userId }] : [];
          }
          if (inTransaction && table === schema.inputAssets) {
            mocks.finalizeStateCalls({ values, condition });
            if (mocks.finalizationFailure === "state") throw new Error("state unavailable");
            return [{ id: ASSET }];
          }
          if (inTransaction && table === schema.users) {
            mocks.accountingCalls({ values, condition });
            if (mocks.finalizationFailure === "accounting") throw new Error("accounting unavailable");
            return [{ id: OTHER_USER }];
          }
          return [];
        },
      }),
    }),
  });

  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          const result = table === schema.projectMembers
            ? (mocks.membershipRole ? [{ role: mocks.membershipRole }] : [])
            : table === schema.projects
              ? [{ ownerId: mocks.projectOwnerId }]
              : mocks.assetRows;
          return {
            limit: vi.fn(async () => result),
            then: (resolve: (rows: Record<string, unknown>[]) => unknown) =>
              resolve(selection === undefined && table === schema.inputAssets ? mocks.listRows : result),
          };
        }),
      })),
    })),
    update: vi.fn((table: unknown) => update(table)),
    transaction: vi.fn(async (callback: (tx: { update: (table: unknown) => unknown }) => Promise<void>) => {
      mocks.transactionCalls();
      await callback({ update: (table: unknown) => update(table, true) });
    }),
  };
  return { db };
});

vi.mock("../services/input-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/input-assets.js")>();
  return {
    ...actual,
    registerInputAssetFromServerPath: mocks.register,
    resolveInputAsset: mocks.resolve,
    updateInputAssetState: mocks.updateState,
  };
});

import { targetGroupRoutes } from "./target-groups.js";

function app() {
  return new Hono().route("/api/v1/data", targetGroupRoutes);
}

function canonicalAsset(path = join(ROOT, "synthetic.csv"), overrides: Record<string, unknown> = {}) {
  const asset = {
    id: ASSET,
    creatorUserId: USER,
    projectId: PROJECT,
    scope: "project",
    kind: "target_group",
    storageLocator: "target_groups/synthetic.csv",
    parentAssetId: null,
    state: "ready",
    contentSha256: "a".repeat(64),
    contentSize: 42,
    createdAt: new Date("2026-09-18T00:00:00Z"),
    updatedAt: new Date("2026-09-18T00:00:00Z"),
    deletedAt: null,
    quarantinedAt: null,
    ...overrides,
  } as const;
  return { asset, resolution: { ok: true as const, asset, absolutePath: path, adminAccess: false } };
}

function uploadForm(name = "target.csv") {
  const form = new FormData();
  form.set("file", new File(["longitude,latitude\n1,2\n"], name, { type: "text/csv" }));
  return form;
}

async function prepareDeletion(asset = canonicalAsset().asset) {
  await mkdir(ROOT, { recursive: true });
  const path = join(ROOT, "synthetic.csv");
  await writeFile(path, "longitude,latitude\n1,2\n");
  mocks.assetRows = [asset];
  mocks.resolve.mockResolvedValue({ ...canonicalAsset(path).resolution, asset });
  return path;
}

function objectContains(value: unknown, expected: unknown, seen = new Set<unknown>()): boolean {
  if (value === expected) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => objectContains(child, expected, seen));
}

describe("canonical target-group routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(ROOT, { recursive: true, force: true });
    mocks.userId = USER;
    mocks.globalRole = "editor";
    mocks.membershipRole = "editor";
    mocks.projectId = PROJECT;
    mocks.projectOwnerId = USER;
    mocks.listRows = [];
    mocks.assetRows = [];
    mocks.reserveResults = [true];
    mocks.reserveError = false;
    mocks.finalizationFailure = null;
    mocks.ensureDefaultProject.mockResolvedValue(PROJECT);
    mocks.register.mockResolvedValue(canonicalAsset().asset);
    mocks.resolve.mockResolvedValue(canonicalAsset().resolution);
    mocks.updateState.mockResolvedValue(true);
  });

  afterEach(async () => {
    await rm(ROOT, { recursive: true, force: true });
  });

  it("uses the same default-project-only context as model execution", async () => {
    const response = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm() });
    expect(response.status).toBe(200);
    expect(mocks.ensureDefaultProject).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, scope: "project" }));
  });

  it("rejects unsupported explicit project overrides instead of silently attaching them", async () => {
    const form = uploadForm();
    form.set("projectId", FOREIGN_PROJECT);
    const upload = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: form });
    const list = await app().request(`/api/v1/data/target-groups?projectId=${FOREIGN_PROJECT}`);
    const deletion = await app().request(`/api/v1/data/target-groups/${ASSET}?project_id=${FOREIGN_PROJECT}`, { method: "DELETE" });
    expect([upload.status, list.status, deletion.status]).toEqual([400, 400, 400]);
    expect(mocks.ensureDefaultProject).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.updateState).not.toHaveBeenCalled();
    expect(mocks.transactionCalls).not.toHaveBeenCalled();
  });

  it("registers a canonical asset, atomically reserves exact quota, and returns safe metadata", async () => {
    const response = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm("related species.csv") });
    expect(response.status).toBe(200);
    expect(mocks.reserveCalls).toHaveBeenCalledTimes(1);
    expect(objectContains(mocks.reserveCalls.mock.calls[0][0].condition, USER)).toBe(true);
    expect(objectContains(mocks.reserveCalls.mock.calls[0][0].condition, 42)).toBe(true);
    const body = await response.json() as Record<string, unknown>;
    expect(body.targetGroupAssetId).toBe(ASSET);
    expect(JSON.stringify(body)).not.toContain(ROOT);
    expect(JSON.stringify(body)).not.toContain("storageLocator");
  });

  it("denies viewers before registration or storage creation", async () => {
    mocks.membershipRole = "viewer";
    const response = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm() });
    expect(response.status).toBe(403);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.reserveCalls).not.toHaveBeenCalled();
    await expect(readdir(ROOT)).rejects.toThrow();
  });

  it("rejects over-quota reservation and removes the registered file without charging", async () => {
    mocks.reserveResults = [false];
    const response = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm() });
    expect(response.status).toBe(413);
    expect(mocks.reserveCalls).toHaveBeenCalledTimes(1);
    expect(mocks.updateState).toHaveBeenCalledWith(ASSET, "quarantined");
    await expect(readdir(ROOT)).resolves.toEqual([]);
  });

  it("uses one conditional reservation per concurrent upload so only proven capacity succeeds", async () => {
    mocks.reserveResults = [true, false];
    const [first, second] = await Promise.all([
      app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm("one.csv") }),
      app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm("two.csv") }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 413]);
    expect(mocks.reserveCalls).toHaveBeenCalledTimes(2);
  });

  it("cleans the staged file on registration or accounting failure", async () => {
    mocks.register.mockRejectedValueOnce(new Error("database unavailable"));
    const registration = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm() });
    expect(registration.status).toBe(503);
    expect(mocks.reserveCalls).not.toHaveBeenCalled();
    await expect(readdir(ROOT)).resolves.toEqual([]);

    mocks.register.mockResolvedValue(canonicalAsset().asset);
    mocks.reserveError = true;
    const accounting = await app().request("/api/v1/data/target-groups/upload", { method: "POST", body: uploadForm() });
    expect(accounting.status).toBe(503);
    expect(mocks.updateState).toHaveBeenCalledWith(ASSET, "quarantined");
    await expect(readdir(ROOT)).resolves.toEqual([]);
  });

  it("lists IDs and safe metadata without exposing a resolved path", async () => {
    mocks.listRows = [canonicalAsset().asset];
    const response = await app().request("/api/v1/data/target-groups");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain(ASSET);
    expect(text).not.toContain(ROOT);
    expect(text).not.toContain("storageLocator");
  });

  it.each([
    ["creator", USER, "editor", OTHER_USER, "editor", true],
    ["another editor", OTHER_USER, "editor", USER, "editor", false],
    ["project admin", OTHER_USER, "admin", USER, "editor", true],
    ["project owner", OTHER_USER, "editor", OTHER_USER, "editor", true],
    ["viewer", USER, "viewer", USER, "viewer", false],
    ["removed member", USER, undefined, USER, "editor", false],
    ["global admin without project authority", OTHER_USER, undefined, USER, "admin", false],
  ] as const)("applies management authority for %s deletion", async (_label, actorId, membershipRole, ownerId, globalRole, allowed) => {
    mocks.userId = actorId;
    mocks.membershipRole = membershipRole;
    mocks.projectOwnerId = ownerId;
    mocks.globalRole = globalRole;
    await prepareDeletion();

    const response = await app().request(`/api/v1/data/target-groups/${ASSET}`, { method: "DELETE" });
    expect(response.status).toBe(allowed ? 200 : (membershipRole ? 404 : 403));
    if (allowed) {
      expect(mocks.updateState).toHaveBeenCalledWith(ASSET, "quarantined");
      expect(mocks.transactionCalls).toHaveBeenCalledTimes(1);
      expect(mocks.accountingCalls).toHaveBeenCalledTimes(1);
      await expect(stat(join(ROOT, "synthetic.csv"))).rejects.toThrow();
    } else {
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.updateState).not.toHaveBeenCalled();
      expect(mocks.transactionCalls).not.toHaveBeenCalled();
      expect(mocks.accountingCalls).not.toHaveBeenCalled();
      await expect(stat(join(ROOT, "synthetic.csv"))).resolves.toBeDefined();
    }
  });

  it("denies deletion of a foreign-project asset with no side effects", async () => {
    await prepareDeletion(canonicalAsset(undefined, { projectId: FOREIGN_PROJECT }).asset);
    const response = await app().request(`/api/v1/data/target-groups/${ASSET}`, { method: "DELETE" });
    expect(response.status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.updateState).not.toHaveBeenCalled();
    expect(mocks.transactionCalls).not.toHaveBeenCalled();
    await expect(stat(join(ROOT, "synthetic.csv"))).resolves.toBeDefined();
  });

  it("leaves a quarantined recoverable asset when physical deletion fails", async () => {
    const path = await prepareDeletion();
    await rm(path);
    await mkdir(path);
    const response = await app().request(`/api/v1/data/target-groups/${ASSET}`, { method: "DELETE" });
    expect(response.status).toBe(503);
    expect(mocks.updateState).toHaveBeenCalledWith(ASSET, "quarantined");
    expect(mocks.transactionCalls).not.toHaveBeenCalled();
    expect(mocks.accountingCalls).not.toHaveBeenCalled();
  });

  it.each(["state", "accounting"] as const)("keeps deletion recoverable when %s finalization fails", async (stage) => {
    await prepareDeletion();
    mocks.finalizationFailure = stage;
    const response = await app().request(`/api/v1/data/target-groups/${ASSET}`, { method: "DELETE" });
    expect(response.status).toBe(503);
    expect(mocks.updateState).toHaveBeenCalledWith(ASSET, "quarantined");
    expect(mocks.transactionCalls).toHaveBeenCalledTimes(1);

    mocks.finalizationFailure = null;
    mocks.assetRows = [canonicalAsset(undefined, { state: "quarantined" }).asset];
    const retry = await app().request(`/api/v1/data/target-groups/${ASSET}`, { method: "DELETE" });
    expect(retry.status).toBe(200);
    expect(mocks.transactionCalls).toHaveBeenCalledTimes(2);
  });

  it("decrements the creator account transactionally and uses a non-negative SQL update", async () => {
    mocks.userId = OTHER_USER;
    mocks.membershipRole = "admin";
    mocks.projectOwnerId = USER;
    await prepareDeletion();
    const response = await app().request(`/api/v1/data/target-groups/${ASSET}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(mocks.accountingCalls).toHaveBeenCalledTimes(1);
    const accounting = mocks.accountingCalls.mock.calls[0][0];
    expect(objectContains(accounting.condition, USER)).toBe(true);
    expect(objectContains(accounting.condition, OTHER_USER)).toBe(false);
    expect(accounting.values.storageUsedBytes).toBeDefined();
    expect(mocks.transactionCalls).toHaveBeenCalledTimes(1);
  });
});
