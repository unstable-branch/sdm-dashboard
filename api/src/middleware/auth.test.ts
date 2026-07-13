import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const { mockVerify, nextDbResult } = vi.hoisted(() => {
  const mockVerify = vi.fn<any>();
  const results: any[][] = [];
  let idx = 0;
  return {
    mockVerify,
    nextDbResult: {
      push: (r: any[]) => { results.push(r); },
      next: () => results[idx++] ?? [],
      reset: () => { results.length = 0; idx = 0; },
    },
  };
});

vi.mock("hono/jwt", () => ({
  verify: mockVerify,
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(nextDbResult.next())),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock("./rate-limit.js", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("./csrf", () => ({}));

process.env.JWT_SECRET = "test-secret";
process.env.JWT_ISSUER = "sdm-dashboard";

const { authMiddleware, optionalAuth, requireRole, requireProjectAccess } = await import("./auth");

describe("authMiddleware", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    nextDbResult.reset();
    app = new Hono();
    app.use("*", authMiddleware);
    app.get("/test", (c) => c.json({ ok: true }));
  });

  describe("JWT Bearer auth", () => {
    it("passes with valid JWT in Authorization header", async () => {
      mockVerify.mockResolvedValueOnce({
        sub: "user-1",
        email: "user@test.com",
        role: "admin",
        iat: 1000000,
        exp: 9999999999,
        iss: "sdm-dashboard",
      });
      const res = await app.request("/test", {
        headers: { Authorization: "Bearer valid.jwt.token" },
      });
      expect(res.status).toBe(200);
    });

    it("returns 401 with invalid JWT", async () => {
      mockVerify.mockRejectedValueOnce(new Error("Invalid token"));
      const res = await app.request("/test", {
        headers: { Authorization: "Bearer invalid.jwt.token" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with expired JWT", async () => {
      mockVerify.mockRejectedValueOnce(new Error("jwt expired"));
      const res = await app.request("/test", {
        headers: { Authorization: "Bearer expired.jwt.token" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when JWT_SECRET is not configured", async () => {
      delete process.env.JWT_SECRET;
      const res = await app.request("/test", {
        headers: { Authorization: "Bearer some.jwt.token" },
      });
      expect(res.status).toBe(401);
      process.env.JWT_SECRET = "test-secret";
    });

    it("returns 401 when JWT issuer does not match", async () => {
      mockVerify.mockResolvedValueOnce({
        sub: "user-1",
        email: "user@test.com",
        role: "admin",
        iat: 1000000,
        exp: 9999999999,
        iss: "wrong-issuer",
      });
      const res = await app.request("/test", {
        headers: { Authorization: "Bearer valid.jwt.token" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when no Authorization header or cookie is present", async () => {
      const res = await app.request("/test");
      expect(res.status).toBe(401);
    });
  });

  describe("API key auth", () => {
    it("passes with valid API key", async () => {
      nextDbResult.push([{ userId: "user-1", expiresAt: null }]);
      nextDbResult.push([{ id: "user-1", email: "user@test.com", role: "admin" }]);
      const res = await app.request("/test", {
        headers: { "X-API-Key": "valid-api-key-12345" },
      });
      expect(res.status).toBe(200);
    });

    it("returns 401 with API key shorter than 8 characters", async () => {
      const res = await app.request("/test", {
        headers: { "X-API-Key": "short" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid API key (not found in DB)", async () => {
      nextDbResult.push([]);
      const res = await app.request("/test", {
        headers: { "X-API-Key": "invalid-api-key" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with expired API key", async () => {
      nextDbResult.push([{ userId: "user-1", expiresAt: new Date("2020-01-01") }]);
      const res = await app.request("/test", {
        headers: { "X-API-Key": "expired-api-key" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with orphaned API key (user deleted)", async () => {
      nextDbResult.push([{ userId: "deleted-user-id", expiresAt: null }]);
      nextDbResult.push([]);
      const res = await app.request("/test", {
        headers: { "X-API-Key": "orphaned-key-12345" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Cookie auth", () => {
    it("passes with valid sdm_token cookie", async () => {
      mockVerify.mockResolvedValueOnce({
        sub: "user-1",
        email: "user@test.com",
        role: "admin",
        iat: 1000000,
        exp: 9999999999,
        iss: "sdm-dashboard",
      });
      const res = await app.request("/test", {
        headers: { Cookie: "sdm_token=valid.cookie.token" },
      });
      expect(res.status).toBe(200);
    });

    it("returns 401 with invalid cookie token", async () => {
      mockVerify.mockRejectedValueOnce(new Error("Invalid token"));
      const res = await app.request("/test", {
        headers: { Cookie: "sdm_token=invalid.cookie.token" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when cookie does not contain sdm_token", async () => {
      const res = await app.request("/test", {
        headers: { Cookie: "other_cookie=value" },
      });
      expect(res.status).toBe(401);
    });
  });
});

describe("optionalAuth", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    nextDbResult.reset();
    app = new Hono();
    app.use("*", optionalAuth as any);
    app.get("/test", (c) => {
      const user = (c as any).get("user");
      return c.json({ user: user ?? null });
    });
  });

  it("continues without user when no token is provided", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user).toBeNull();
  });

  it("sets user with valid JWT Bearer token", async () => {
    mockVerify.mockResolvedValueOnce({
      sub: "user-1",
      email: "user@test.com",
      role: "viewer",
      iat: 1000000,
      exp: 9999999999,
      iss: "sdm-dashboard",
    });
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user).toEqual({ id: "user-1", email: "user@test.com", role: "viewer" });
  });

  it("sets user with valid API key", async () => {
    nextDbResult.push([{ userId: "user-1", expiresAt: null }]);
    nextDbResult.push([{ id: "user-1", email: "user@test.com", role: "viewer" }]);
    const res = await app.request("/test", {
      headers: { "X-API-Key": "valid-api-key-12345" },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user).toEqual({ id: "user-1", email: "user@test.com", role: "viewer" });
  });

  it("does not fail with an invalid JWT", async () => {
    mockVerify.mockRejectedValueOnce(new Error("Invalid token"));
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user).toBeNull();
  });
});

describe("requireRole", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    nextDbResult.reset();
    app = new Hono();
    app.use("*", authMiddleware);
    app.get("/admin", requireRole(["admin"]), (c) => c.json({ ok: true }));
  });

  it("allows admin role", async () => {
    mockVerify.mockResolvedValueOnce({
      sub: "admin-1",
      email: "admin@test.com",
      role: "admin",
      iat: 1000000,
      exp: 9999999999,
      iss: "sdm-dashboard",
    });
    const res = await app.request("/admin", {
      headers: { Authorization: "Bearer admin.jwt" },
    });
    expect(res.status).toBe(200);
  });

  it("blocks viewer role", async () => {
    mockVerify.mockResolvedValueOnce({
      sub: "user-1",
      email: "user@test.com",
      role: "viewer",
      iat: 1000000,
      exp: 9999999999,
      iss: "sdm-dashboard",
    });
    const res = await app.request("/admin", {
      headers: { Authorization: "Bearer user.jwt" },
    });
    expect(res.status).toBe(403);
  });

  it("blocks unauthenticated requests (no middleware sets user)", async () => {
    const res = await app.request("/admin");
    expect(res.status).toBe(401);
  });
});

describe("requireProjectAccess", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    nextDbResult.reset();
    app = new Hono();
    app.use("*", authMiddleware);
    app.get("/projects/:id", requireProjectAccess(), (c) => c.json({ ok: true }));
  });

  it("allows project member", async () => {
    mockVerify.mockResolvedValueOnce({
      sub: "user-1",
      email: "user@test.com",
      role: "viewer",
      iat: 1000000,
      exp: 9999999999,
      iss: "sdm-dashboard",
    });
    nextDbResult.push([{ id: "membership-1", projectId: "project-1", userId: "user-1" }]);
    const res = await app.request("/projects/project-1", {
      headers: { Authorization: "Bearer user.jwt" },
    });
    expect(res.status).toBe(200);
  });

  it("blocks non-member", async () => {
    mockVerify.mockResolvedValueOnce({
      sub: "user-1",
      email: "user@test.com",
      role: "viewer",
      iat: 1000000,
      exp: 9999999999,
      iss: "sdm-dashboard",
    });
    nextDbResult.push([]);
    const res = await app.request("/projects/project-1", {
      headers: { Authorization: "Bearer user.jwt" },
    });
    expect(res.status).toBe(403);
  });

  it("allows admin even without project membership", async () => {
    mockVerify.mockResolvedValueOnce({
      sub: "admin-1",
      email: "admin@test.com",
      role: "admin",
      iat: 1000000,
      exp: 9999999999,
      iss: "sdm-dashboard",
    });
    const res = await app.request("/projects/project-1", {
      headers: { Authorization: "Bearer admin.jwt" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when user is not authenticated", async () => {
    const res = await app.request("/projects/project-1");
    expect(res.status).toBe(401);
  });
});
