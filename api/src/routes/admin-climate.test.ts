import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  currentRole: "admin" as "admin" | "editor" | "viewer" | null,
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  publishCollection: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    if (!mocks.currentRole) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.invalid", role: mocks.currentRole });
    await next();
  }),
  requireRole: (roles: string[]) => vi.fn(async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) return c.json({ error: "Forbidden" }, 403);
    await next();
  }),
}));

vi.mock("../middleware/rate-limit", () => ({
  rateLimit: () => vi.fn(async (_c, next) => next()),
}));

vi.mock("../services/audit", () => ({
  extractClientInfo: vi.fn(() => ({ ipAddress: "127.0.0.1", userAgent: "test" })),
  logAction: mocks.logAction,
}));

vi.mock("../services/climate-collections", async () => {
  const actual = await vi.importActual<typeof import("../services/climate-collections")>("../services/climate-collections");
  return {
    ClimateCollectionError: actual.ClimateCollectionError,
    MAX_CLIMATE_COLLECTION_PAGE: actual.MAX_CLIMATE_COLLECTION_PAGE,
    listAdminClimateCollections: mocks.listCollections,
    getAdminClimateCollection: mocks.getCollection,
    publishClimateCollection: mocks.publishCollection,
  };
});

async function app() {
  const { adminClimateRoutes } = await import("./admin-climate.js");
  const instance = new Hono();
  instance.route("/api/v1/admin/climate", adminClimateRoutes);
  return instance;
}

describe("admin climate collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentRole = "admin";
    mocks.listCollections.mockResolvedValue({ collections: [], total: 0, page: 1, limit: 25 });
    mocks.getCollection.mockResolvedValue(null);
    mocks.publishCollection.mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000001",
      state: "ready",
      manifestSha256: "a".repeat(64),
      publishedAt: new Date("2026-09-18T00:00:00Z"),
    });
    mocks.logAction.mockResolvedValue(undefined);
  });

  it.each(["editor", "viewer"] as const)("denies the %s role", async (role) => {
    mocks.currentRole = role;
    const response = await (await app()).request("/api/v1/admin/climate/collections");
    expect(response.status).toBe(403);
    expect(mocks.listCollections).not.toHaveBeenCalled();
  });

  it("denies unauthenticated requests", async () => {
    mocks.currentRole = null;
    const response = await (await app()).request("/api/v1/admin/climate/collections");
    expect(response.status).toBe(401);
  });

  it("lists only the safe collection projection", async () => {
    mocks.listCollections.mockResolvedValue({
      collections: [{
        id: "30000000-0000-4000-8000-000000000001",
        kind: "current_baseline",
        state: "ready",
        manifestSha256: "a".repeat(64),
      }],
      total: 1,
      page: 1,
      limit: 25,
    });
    const response = await (await app()).request("/api/v1/admin/climate/collections?state=ready&kind=current_baseline");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/storageLocator|absolutePath|validationEvidence|"manifest"/);
    expect(mocks.listCollections).toHaveBeenCalledWith({ state: "ready", kind: "current_baseline", page: 1, limit: 25 });
  });

  it("rejects invalid list filters before service access", async () => {
    const response = await (await app()).request("/api/v1/admin/climate/collections?state=unknown&limit=0");
    expect(response.status).toBe(400);
    expect(mocks.listCollections).not.toHaveBeenCalled();
  });

  it.each(["page=101", "page=9007199254740992", "limit=9007199254740992"])(
    "rejects unsafe or unbounded pagination: %s",
    async (query) => {
      const response = await (await app()).request(`/api/v1/admin/climate/collections?${query}`);
      expect(response.status).toBe(400);
      expect(mocks.listCollections).not.toHaveBeenCalled();
    },
  );

  it("denies non-admin publication before service or audit access", async () => {
    mocks.currentRole = "editor";
    const response = await (await app()).request(
      "/api/v1/admin/climate/collections/30000000-0000-4000-8000-000000000001/publish",
      { method: "POST" },
    );
    expect(response.status).toBe(403);
    expect(mocks.publishCollection).not.toHaveBeenCalled();
    expect(mocks.logAction).not.toHaveBeenCalled();
  });

  it("does not accept publication authority or manifest fields from the body", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    const response = await (await app()).request(`/api/v1/admin/climate/collections/${id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorUserId: "attacker", role: "admin", manifest: { forged: true }, storageLocator: "/etc/passwd" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.publishCollection).toHaveBeenCalledWith(id, "00000000-0000-4000-8000-000000000001");
    expect(mocks.logAction).toHaveBeenCalledWith(expect.objectContaining({
      userId: "00000000-0000-4000-8000-000000000001",
      entityId: id,
      details: { state: "ready", manifestSha256: "a".repeat(64) },
    }));
    expect(JSON.stringify(mocks.logAction.mock.calls[0])).not.toMatch(/passwd|storageLocator|forged|attacker/);
  });

  it("maps service failures without returning database details", async () => {
    const { ClimateCollectionError } = await import("../services/climate-collections.js");
    mocks.publishCollection.mockRejectedValue(new ClimateCollectionError("conflict", "Climate collection is not publishable"));
    const response = await (await app()).request("/api/v1/admin/climate/collections/30000000-0000-4000-8000-000000000001/publish", { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Climate collection is not publishable",
      code: "CLIMATE_COLLECTION_CONFLICT",
    });
  });
});
