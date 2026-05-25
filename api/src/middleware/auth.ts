import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { users, apiKeys, projectMembers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { checkRateLimit } from "./rate-limit.js";
import { recordAuditEventBestEffort } from "../services/audit.js";

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
    auth: AuthContext;
  };
};

export type ApiKeyScope = "read" | "write" | "run" | "batch" | "admin";

export type AuthContext =
  | { method: "jwt" }
  | { method: "api_key"; apiKeyId: string; scopes: ApiKeyScope[]; projectId: string | null };

export const LEGACY_API_KEY_SCOPES: ApiKeyScope[] = ["read", "write", "run", "batch", "admin"];

const VALID_API_KEY_SCOPES = new Set<ApiKeyScope>(LEGACY_API_KEY_SCOPES);

function normalizeScopes(scopes: unknown): ApiKeyScope[] {
  if (!Array.isArray(scopes)) return LEGACY_API_KEY_SCOPES;
  const valid = scopes.filter((scope): scope is ApiKeyScope =>
    typeof scope === "string" && VALID_API_KEY_SCOPES.has(scope as ApiKeyScope)
  );
  return valid.length > 0 ? Array.from(new Set(valid)) : LEGACY_API_KEY_SCOPES;
}

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
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader) {
    try {
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
      const allowed = await checkRateLimit(`auth:${ip}`, 60_000, 20);
      if (!allowed) {
        return c.json({ error: "Too many failed authentication attempts" }, 429);
      }

      const keyHash = createHash("sha256").update(apiKeyHeader).digest("hex");
      const [key] = await db
        .select({
          id: apiKeys.id,
          userId: apiKeys.userId,
          scopes: apiKeys.scopes,
          projectId: apiKeys.projectId,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash)))
        .limit(1);

      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) {
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
      c.set("auth", {
        method: "api_key",
        apiKeyId: key.id,
        scopes: normalizeScopes(key.scopes),
        projectId: key.projectId ?? null,
      });
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
    c.set("auth", { method: "jwt" });
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
        .select({
          id: apiKeys.id,
          userId: apiKeys.userId,
          scopes: apiKeys.scopes,
          projectId: apiKeys.projectId,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);

      if (key && !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date())) {
        const [user] = await db
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(eq(users.id, key.userId))
          .limit(1);

        if (user) {
          c.set("user", user);
          c.set("auth", {
            method: "api_key",
            apiKeyId: key.id,
            scopes: normalizeScopes(key.scopes),
            projectId: key.projectId ?? null,
          });
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
        c.set("user", {
          id: payload.sub as string,
          email: payload.email as string,
          role: payload.role as string,
        });
        c.set("auth", { method: "jwt" });
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

export const requireApiKeyScope = (scope: ApiKeyScope) => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get("auth");
    if (auth?.method === "api_key" && !auth.scopes.includes(scope) && !auth.scopes.includes("admin")) {
      const user = c.get("user");
      await recordAuditEventBestEffort({
        actorUserId: user?.id ?? null,
        actorApiKeyId: auth.apiKeyId,
        action: "api_key_scope_denied",
        method: c.req.method,
        route: c.req.path,
        statusCode: 403,
        metadata: { required_scope: scope },
      });
      return c.json({ error: "API key scope required", required_scope: scope }, 403);
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
