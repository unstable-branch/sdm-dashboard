import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("bcrypt", () => ({
  hash: vi.fn(() => Promise.resolve("$2b$10$hashedpassword")),
  verify: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("hono/jwt", () => ({
  sign: vi.fn(async (_payload: unknown, _secret: string, _opts: { exp: number }) => "mock-jwt-token"),
  verify: vi.fn(async () => ({ sub: "user-1", email: "test@example.com", role: "viewer" })),
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{
          id: "user-1",
          email: "test@example.com",
          name: "Test User",
          role: "viewer",
          passwordHash: "$2b$10$hashedpassword",
          createdAt: new Date(),
        }])),
      })),
    })),
  },
}));

process.env.JWT_SECRET = "test-secret";

const { authRoutes } = await import("./auth");

describe("auth routes", () => {
  const app = new Hono();
  app.route("/api/v1/auth", authRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
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
});
