import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { users, apiKeys, projectMembers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export type AppEnv = {
  Variables: {
    user: {
      id: string;
      email: string;
      role: string;
    };
  };
};

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader) {
    try {
      const keyHash = createHash("sha256").update(apiKeyHeader).digest("hex");
      const [key] = await db
        .select({ userId: apiKeys.userId })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash)))
        .limit(1);

      if (!key) {
        return c.json({ error: "Invalid API key" }, 401);
      }

      const [user] = await db
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, key.userId))
        .limit(1);

      if (!user) {
        return c.json({ error: "User not found" }, 401);
      }

      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.keyHash, keyHash));

      c.set("user", user);
      await next();
      return;
    } catch {
      return c.json({ error: "Authentication service unavailable" }, 503);
    }
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn("[auth] JWT_SECRET not configured");
    return c.json({ error: "Authentication unavailable (server not configured)" }, 401);
  }

  try {
    const payload = await verify(token, secret, "HS256");
    c.set("user", {
      id: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
    });
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader) {
    try {
      const keyHash = createHash("sha256").update(apiKeyHeader).digest("hex");
      const [key] = await db
        .select({ userId: apiKeys.userId })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);

      if (key) {
        const [user] = await db
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(eq(users.id, key.userId))
          .limit(1);

        if (user) {
          c.set("user", user);
        }
      }
    } catch {
      // Silently fail for optional auth
    }
  } else if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const secret = process.env.JWT_SECRET;
      if (secret) {
    const payload = await verify(token, secret, "HS256");
        c.set("user", {
          id: payload.sub as string,
          email: payload.email as string,
          role: payload.role as string,
        });
      }
    } catch {
      // Silently fail for optional auth
    }
  }

  await next();
});

export const requireRole = (roles: string[]) => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });
};

export const requireProjectAccess = (role: "owner" | "member" = "member") => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    const projectId = c.req.param("id") || c.req.query("project_id");

    if (!user || !projectId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (user.role === "admin") {
      await next();
      return;
    }

    try {
      const [member] = await db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.userId, user.id), eq(projectMembers.projectId, projectId)))
        .limit(1);

      if (!member) {
        return c.json({ error: "Access denied" }, 403);
      }
    } catch {
      return c.json({ error: "Authorization service unavailable" }, 503);
    }

    await next();
  });
};
