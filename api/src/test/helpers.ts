import { vi } from "vitest";
import { Hono } from "hono";

export function mockDb() {
  const { db } = require("../db");
  return db;
}

export function chain<T>(result: T) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            offset: vi.fn(() => Promise.resolve(Array.isArray(result) ? result : [result])),
          })),
        })),
      })),
    })),
  };
}

export function countChain(count: number) {
  return {
    from: vi.fn(() => Promise.resolve([{ count }])),
  };
}

export function simpleSelect<T>(result: T[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(result)),
      })),
    })),
  };
}

export function singleResult<T>(result: T) {
  return simpleSelect([result]);
}

export function insertReturning<T>(result: T[]) {
  return vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(result)),
    })),
  }));
}

export function mockAuthMiddleware(role = "admin") {
  return {
    authMiddleware: vi.fn(async (c: any, next: any) => {
      c.set("user", {
        id: "user-1",
        email: "[EMAIL]",
        role,
      });
      await next();
    }),
    optionalAuth: vi.fn(async (c: any, next: any) => {
      c.set("user", {
        id: "user-1",
        email: "[EMAIL]",
        role,
      });
      await next();
    }),
    requireRole: (roles: string[]) => {
      return async (c: any, next: any) => {
        const user = c.get("user");
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        if (!roles.includes(user.role)) return c.json({ error: "Forbidden" }, 403);
        await next();
      };
    },
  };
}

export function createTestApp(routes: Hono, role = "admin") {
  vi.mock("../middleware/auth", () => mockAuthMiddleware(role));

  const app = new Hono();
  app.route("/", routes);
  return app;
}

export async function jsonBody(res: Response) {
  return res.json();
}