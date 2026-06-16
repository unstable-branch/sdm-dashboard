import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { users, apiKeys, projectMembers, projects } from "../db/schema.js";
import { eq, and, or, inArray } from "drizzle-orm";
import { checkRateLimit } from "./rate-limit.js";

// Batch lastUsedAt updates — flush every 30s or after 100 queued writes
const lastUsedBatch = new Map<string, number>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_INTERVAL = 30_000;
const BATCH_MAX = 100;

async function flushLastUsedBatch() {
  if (lastUsedBatch.size === 0) return;
  const keys = Array.from(lastUsedBatch.keys());
  lastUsedBatch.clear();
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  try {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(inArray(apiKeys.keyHash, keys));
  } catch (err) {
    console.warn("[auth] lastUsedBatch flush failed:", err instanceof Error ? err.message : String(err));
  }
}

function queueLastUsedUpdate(keyHash: string) {
  lastUsedBatch.set(keyHash, Date.now());
  if (lastUsedBatch.size >= BATCH_MAX) {
    flushLastUsedBatch();
  } else if (!batchTimer) {
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flushLastUsedBatch();
    }, BATCH_INTERVAL);
  }
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  iss: string;
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

function getCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("sdm_token="));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice("sdm_token=".length));
  } catch {
    return null;
  }
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // If optionalAuth already verified identity, skip re-verification
  const existingUser = c.get("user");
  if (existingUser?.id) {
    await next();
    return;
  }

  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader) {
    try {
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

      if (apiKeyHeader.length < 8) {
        console.warn(`[auth] Rejected short API key (len=${apiKeyHeader.length}) from ${ip}`);
        return c.json({ error: "Invalid API key format" }, 401);
      }

      const allowed = await checkRateLimit(`auth:${ip}`, 60_000, 20);
      if (!allowed) {
        return c.json({ error: "Too many failed authentication attempts" }, 429);
      }

      const keyHash = createHash("sha256").update(apiKeyHeader).digest("hex");
      const [key] = await db
        .select({ userId: apiKeys.userId, expiresAt: apiKeys.expiresAt })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash)))
        .limit(1);

      if (!key || (key.expiresAt && key.expiresAt <= new Date())) {
        console.warn(`[audit] API key auth FAILED (expired/missing) from ${ip}`);
        return c.json({ error: "Invalid API key" }, 401);
      }

      const [user] = await db
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, key.userId))
        .limit(1);

      if (!user) {
        console.warn(`[audit] API key auth FAILED (orphaned key userId=${key.userId}) from ${ip}`);
        return c.json({ error: "User not found" }, 401);
      }

      console.info(`[audit] API key auth OK: user=${user.id} role=${user.role} from ${ip}`);
      queueLastUsedUpdate(keyHash);

      c.set("user", user);
      await next();
      return;
    } catch {
      return c.json({ error: "Authentication service unavailable" }, 503);
    }
  }

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : getCookieToken(c.req.header("Cookie"));

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    console.warn("[audit] JWT_SECRET not configured");
    return c.json({ error: "Authentication unavailable (server not configured)" }, 401);
  }

  try {
    const payload = await verify(token, secret, "HS256");
    const expectedIss = process.env.JWT_ISSUER || "sdm-dashboard";
    if (payload.iss !== expectedIss) {
      console.warn(`[audit] JWT issuer mismatch: expected ${expectedIss}, got ${payload.iss} for sub=${payload.sub}`);
      return c.json({ error: "Invalid token issuer" }, 401);
    }
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    console.info(`[audit] JWT auth OK: user=${payload.sub} role=${payload.role} from ${ip}`);
    c.set("user", {
      id: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
    });
    await next();
  } catch (err) {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    console.warn(`[audit] JWT auth FAILED from ${ip}: ${err instanceof Error ? err.message : "token verification error"}`);
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
        .select({ userId: apiKeys.userId, expiresAt: apiKeys.expiresAt })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);

      if (key && (!key.expiresAt || key.expiresAt > new Date())) {
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
  } else {
    try {
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : getCookieToken(c.req.header("Cookie"));
      if (!token) {
        await next();
        return;
      }
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const payload = await verify(token, secret, "HS256");
        const expectedIss = process.env.JWT_ISSUER || "sdm-dashboard";
        if (payload.iss === expectedIss) {
          c.set("user", {
            id: payload.sub as string,
            email: payload.email as string,
            role: payload.role as string,
          });
        }
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
      // Check project membership OR project ownership
      const [ownerCheck] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)))
        .limit(1);

      if (!ownerCheck) {
        const [member] = await db
          .select()
          .from(projectMembers)
          .where(and(eq(projectMembers.userId, user.id), eq(projectMembers.projectId, projectId)))
          .limit(1);

        if (!member) {
          return c.json({ error: "Access denied" }, 403);
        }
      }
    } catch {
      return c.json({ error: "Authorization service unavailable" }, 503);
    }

    await next();
  });
};
