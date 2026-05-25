import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  insertReturnRows: [] as unknown[][],
  insertedValues: [] as unknown[],
  updatedValues: [] as unknown[],
  deleteCalls: 0,
  db: null as unknown,
}));

vi.mock("bcrypt", () => ({
  hash: vi.fn(() => Promise.resolve("$2b$10$hashedpassword")),
  compare: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("hono/jwt", () => ({
  sign: vi.fn(async () => "mock-jwt-token"),
  verify: vi.fn(async () => ({ sub: "user-1", email: "test@example.com", role: "viewer" })),
}));

function nextSelectRows() {
  return mocks.selectRows.shift() ?? [];
}

function selectChain() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = nextSelectRows();
        const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
        result.limit = () => Promise.resolve(rows);
        return result;
      }),
      limit: vi.fn(() => Promise.resolve(nextSelectRows())),
    })),
  };
}

function insertChain() {
  return {
    values: vi.fn((value: unknown) => {
      mocks.insertedValues.push(value);
      const rows = mocks.insertReturnRows.shift() ?? [];
      const result = Promise.resolve(rows) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
      result.returning = () => Promise.resolve(rows);
      return result;
    }),
  };
}

function updateChain() {
  return {
    set: vi.fn((value: unknown) => {
      mocks.updatedValues.push(value);
      return {
        where: vi.fn(() => Promise.resolve([])),
      };
    }),
  };
}

function deleteChain() {
  return {
    where: vi.fn(() => {
      mocks.deleteCalls += 1;
      return Promise.resolve([]);
    }),
  };
}

function makeDbMock() {
  return {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => updateChain()),
    delete: vi.fn(() => deleteChain()),
  };
}

mocks.db = makeDbMock();

vi.mock("../db/index.js", () => ({ db: mocks.db }));
vi.mock("../db/index", () => ({ db: mocks.db }));

vi.mock("../db", () => ({ db: mocks.db }));

vi.mock("../middleware/rate-limit.js", () => ({
  rateLimit: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
  checkRateLimit: vi.fn(async () => true),
}));

process.env.JWT_SECRET = "test-secret";

const { authRoutes } = await import("./auth");

describe("auth routes", () => {
  const app = new Hono();
  app.route("/api/v1/auth", authRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [];
    mocks.insertReturnRows = [];
    mocks.insertedValues = [];
    mocks.updatedValues = [];
    mocks.deleteCalls = 0;
  });

  describe("POST /register", () => {
    it("rejects missing email", async () => {
      const res = await app.request("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "password123" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects missing password", async () => {
      const res = await app.request("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /login", () => {
    it("rejects missing email", async () => {
      const res = await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "password123" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects missing password", async () => {
      const res = await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("API key lifecycle scopes", () => {
    it("lets JWT callers create scoped API keys and records audit", async () => {
      const createdAt = new Date("2026-05-26T00:00:00Z");
      mocks.insertReturnRows.push([{
        id: "key-created",
        name: "Notebook",
        scopes: ["read", "run"],
        projectId: "project-1",
        createdAt,
        expiresAt: null,
      }]);

      const res = await app.request("/api/v1/auth/api-keys", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-token", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Notebook", scopes: ["read", "run"], projectId: "project-1" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expect.objectContaining({
        id: "key-created",
        name: "Notebook",
        scopes: ["read", "run"],
        projectId: "project-1",
      }));
      expect(mocks.insertedValues[0]).toEqual(expect.objectContaining({
        name: "Notebook",
        userId: "user-1",
        scopes: ["read", "run"],
        projectId: "project-1",
        createdByKeyId: null,
      }));
      expect(mocks.insertedValues[1]).toEqual(expect.objectContaining({
        actorUserId: "user-1",
        action: "api_key_created",
        targetId: "key-created",
      }));
    });

    it("rejects revoked API keys before route handling", async () => {
      mocks.selectRows.push([{
        id: "key-revoked",
        userId: "user-1",
        scopes: ["admin"],
        projectId: null,
        expiresAt: null,
        revokedAt: new Date("2026-05-26T00:00:00Z"),
      }]);

      const res = await app.request("/api/v1/auth/api-keys", {
        headers: { "X-API-Key": "revoked-key" },
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid API key" });
      expect(mocks.insertedValues).toEqual([]);
    });

    it("denies API-key callers without the required lifecycle scope", async () => {
      mocks.selectRows.push(
        [{
          id: "key-read",
          userId: "user-1",
          scopes: ["read"],
          projectId: null,
          expiresAt: null,
          revokedAt: null,
        }],
        [{ id: "user-1", email: "test@example.com", role: "viewer" }]
      );

      const res = await app.request("/api/v1/auth/api-keys", {
        method: "POST",
        headers: { "X-API-Key": "read-key", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Blocked" }),
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "API key scope required", required_scope: "admin" });
      expect(mocks.insertedValues[0]).toEqual(expect.objectContaining({
        actorUserId: "user-1",
        actorApiKeyId: "key-read",
        action: "api_key_scope_denied",
        statusCode: 403,
      }));
    });

    it("allows read-scoped API keys to list keys with additive scope fields", async () => {
      const createdAt = new Date("2026-05-26T00:00:00Z");
      mocks.selectRows.push(
        [{
          id: "key-read",
          userId: "user-1",
          scopes: ["read"],
          projectId: null,
          expiresAt: null,
          revokedAt: null,
        }],
        [{ id: "user-1", email: "test@example.com", role: "viewer" }],
        [{
          id: "key-read",
          name: "Reader",
          scopes: ["read"],
          projectId: null,
          createdAt,
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
        }]
      );

      const res = await app.request("/api/v1/auth/api-keys", {
        headers: { "X-API-Key": "read-key" },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{
        id: "key-read",
        name: "Reader",
        scopes: ["read"],
        projectId: null,
        createdAt: createdAt.toISOString(),
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      }]);
      expect(mocks.updatedValues[0]).toEqual(expect.objectContaining({ lastUsedAt: expect.any(Date) }));
    });
  });
});
