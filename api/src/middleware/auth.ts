import { createMiddleware } from "hono/factory";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { apiKeys, projectMembers, projects } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { checkRateLimit } from "./rate-limit.js";
import { getClientIp } from "./client-ip.js";
import { AuthStorageUnavailable, verifyCurrentApiKey, verifyCurrentJwt } from "../services/auth-principal.js";

// Batch lastUsedAt updates — flush every 30s or after 100 queued writes
const lastUsedBatch = new Map<string, number>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_INTERVAL = 30_000;
const BATCH_MAX = 100;

async function flushLastUsedBatch() {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (lastUsedBatch.size === 0) return;
  const keys = Array.from(lastUsedBatch.keys());
  lastUsedBatch.clear();
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

export type AppEnv = {
  Variables: {
    user: {
      id: string;
      email: string;
      role: string;
      authVersion?: number;
      source?: "jwt" | "api-key";
    };
    requestId: string;
  };
};

function getCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("sdm_token=") || part.startsWith("__Host-sdm_token="));
  if (!match) return null;
  const value = match.startsWith("__Host-sdm_token=")
    ? match.slice("__Host-sdm_token=".length)
    : match.slice("sdm_token=".length);
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader) {
    try {
const ip = getClientIp(c);

      if (apiKeyHeader.length < 8) {
        console.warn(`[auth] Rejected short API key (len=${apiKeyHeader.length}) from ${ip}`);
        return c.json({ error: "Invalid API key format" }, 401);
      }

      const allowed = await checkRateLimit(`auth:${ip}`, 60_000, 20);
      if (!allowed) {
        return c.json({ error: "Too many failed authentication attempts" }, 429);
      }

      const keyHash = createHash("sha256").update(apiKeyHeader).digest("hex");
      const user = await verifyCurrentApiKey(apiKeyHeader);
      if (!user) {
        console.warn(`[audit] API key auth FAILED (expired/missing) from ${ip}`);
        return c.json({ error: "Invalid API key" }, 401);
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
    return c.json({ error: "Authentication unavailable (server not configured)" }, 503);
  }

  try {
    const user = await verifyCurrentJwt(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const ip = getClientIp(c);
    console.info(`[audit] JWT auth OK: user=${user.id} role=${user.role} from ${ip}`);
    c.set("user", user);
    await next();
  } catch (err) {
    if (err instanceof AuthStorageUnavailable) return c.json({ error: "Authentication service unavailable" }, 503);
    const ip = getClientIp(c);
    console.warn(`[audit] JWT auth FAILED from ${ip}: ${err instanceof Error ? err.message : "token verification error"}`);
    return c.json({ error: "Invalid token" }, 401);
  }
});

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader) {
    try {
      const user = await verifyCurrentApiKey(apiKeyHeader);
      if (user) c.set("user", user);
    } catch (error) {
      if (error instanceof AuthStorageUnavailable) return c.json({ error: "Authentication service unavailable" }, 503);
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
        const user = await verifyCurrentJwt(token);
        if (user) c.set("user", user);
      }
    } catch (error) {
      if (error instanceof AuthStorageUnavailable) return c.json({ error: "Authentication service unavailable" }, 503);
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
