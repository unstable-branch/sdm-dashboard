import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerify = vi.hoisted(() => vi.fn());
const dbState = vi.hoisted(() => ({ rows: [] as unknown[][], error: null as Error | null }));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (dbState.error) throw dbState.error;
          return dbState.rows.shift() ?? [];
        }),
      })),
    })),
  })),
}));

vi.mock("hono/jwt", () => ({ verify: mockVerify }));
vi.mock("../db/index.js", () => ({ db: mockDb }));

const { AuthStorageUnavailable, verifyCurrentApiKey, verifyCurrentJwt } = await import("./auth-principal.js");

const userId = "11111111-1111-4111-8111-111111111111";
const validPayload = () => ({
  sub: userId,
  email: "token@example.com",
  role: "admin",
  av: 4,
  iss: "sdm-dashboard",
  exp: Math.floor(Date.now() / 1000) + 300,
});

describe("current principal verification", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_ISSUER = "sdm-dashboard";
    mockVerify.mockReset();
    mockDb.select.mockClear();
    dbState.rows = [];
    dbState.error = null;
  });

  it("uses current database email and role, not JWT claims", async () => {
    mockVerify.mockResolvedValue(validPayload());
    dbState.rows.push([{
      id: userId,
      email: "current@example.com",
      role: "viewer",
      authVersion: 4,
    }]);

    await expect(verifyCurrentJwt("token")).resolves.toEqual({
      id: userId,
      email: "current@example.com",
      role: "viewer",
      authVersion: 4,
      source: "jwt",
    });
  });

  it("rejects legacy, expired, and malformed-sub JWTs before trusting a user", async () => {
    for (const payload of [
      { ...validPayload(), av: undefined },
      { ...validPayload(), exp: undefined },
      { ...validPayload(), sub: [userId] },
    ]) {
      mockVerify.mockResolvedValueOnce(payload);
      await expect(verifyCurrentJwt("token")).resolves.toBeNull();
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("checks the current user before rejecting a stale auth version", async () => {
    mockVerify.mockResolvedValue({ ...validPayload(), av: 3 });
    dbState.rows.push([{ id: userId, email: "current@example.com", role: "viewer", authVersion: 4 }]);
    await expect(verifyCurrentJwt("token")).resolves.toBeNull();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing current user or invalid persisted role", async () => {
    mockVerify.mockResolvedValue(validPayload());
    dbState.rows.push([]);
    await expect(verifyCurrentJwt("token")).resolves.toBeNull();

    dbState.rows.push([{ id: userId, email: "x@example.com", role: "owner", authVersion: 4 }]);
    await expect(verifyCurrentJwt("token")).resolves.toBeNull();
  });

  it("surfaces database failure as authentication storage unavailable", async () => {
    mockVerify.mockResolvedValue(validPayload());
    dbState.error = new Error("connection refused");
    await expect(verifyCurrentJwt("token")).rejects.toBeInstanceOf(AuthStorageUnavailable);
  });

  it("resolves API keys against expiry and the current user row", async () => {
    dbState.rows.push([{ userId, expiresAt: null }]);
    dbState.rows.push([{ id: userId, email: "current@example.com", role: "editor", authVersion: 2 }]);
    await expect(verifyCurrentApiKey("api-key")).resolves.toMatchObject({
      id: userId,
      email: "current@example.com",
      role: "editor",
      authVersion: 2,
      source: "api-key",
    });
  });
});
