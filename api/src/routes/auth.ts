import { Hono } from "hono";
import { sign } from "hono/jwt";
import { hash, compare } from "bcrypt";
import { db } from "../db/index.js";
import { users, apiKeys, projects, projectMembers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { authMiddleware, LEGACY_API_KEY_SCOPES, requireApiKeyScope, type ApiKeyScope } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { randomBytes, createHash } from "crypto";
import type { AppEnv } from "../middleware/auth.js";
import { recordAuditEventBestEffort } from "../services/audit.js";

export const authRoutes = new Hono<AppEnv>();

const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_ROUNDS = 12;
const VALID_API_KEY_SCOPES = new Set<ApiKeyScope>(LEGACY_API_KEY_SCOPES);

authRoutes.use("/register", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "register" }));
authRoutes.use("/login", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "login" }));

authRoutes.post("/register", async (c) => {
  if (!JWT_SECRET) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  try {
    const body = await c.req.json();
    const { email, password, name } = body;

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const passwordHash = await hash(password, BCRYPT_ROUNDS);

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name, role: "viewer" })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        name: "Default Project",
        description: "Default project for SDM runs and occurrence data.",
        ownerId: user.id,
      })
      .returning();

    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: user.id, role: "admin" });

    const token = await sign(
      { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 },
      JWT_SECRET
    );

    return c.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: message }, 500);
  }
});

authRoutes.post("/login", async (c) => {
  if (!JWT_SECRET) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  try {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const token = await sign(
      { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 },
      JWT_SECRET
    );

    return c.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    return c.json({ error: message }, 500);
  }
});

authRoutes.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  const [dbUser] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!dbUser) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(dbUser);
});

function normalizeRequestedScopes(value: unknown): ApiKeyScope[] | null {
  if (value === undefined) return LEGACY_API_KEY_SCOPES;
  if (!Array.isArray(value)) return null;
  const scopes = value.filter((scope): scope is ApiKeyScope =>
    typeof scope === "string" && VALID_API_KEY_SCOPES.has(scope as ApiKeyScope)
  );
  if (scopes.length !== value.length || scopes.length === 0) return null;
  return Array.from(new Set(scopes));
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

authRoutes.post("/api-keys", authMiddleware, requireApiKeyScope("admin"), rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "apikey-create" }), async (c) => {
  const user = c.get("user");
  const auth = c.get("auth");
  const body = await c.req.json();
  const { name, expiresAt } = body;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  const scopes = normalizeRequestedScopes(body.scopes);
  if (!scopes) {
    return c.json({ error: "Invalid API key scopes" }, 400);
  }
  const projectId = getNullableString(body.projectId ?? body.project_id);

  const rawKey = `sdm_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      keyHash,
      name,
      userId: user.id,
      scopes,
      projectId,
      createdByKeyId: auth?.method === "api_key" ? auth.apiKeyId : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  await recordAuditEventBestEffort({
    actorUserId: user.id,
    actorApiKeyId: auth?.method === "api_key" ? auth.apiKeyId : null,
    action: "api_key_created",
    targetType: "api_key",
    targetId: apiKey.id,
    method: c.req.method,
    route: c.req.path,
    statusCode: 200,
    metadata: { scopes, projectId },
  });

  return c.json({
    id: apiKey.id,
    name: apiKey.name,
    key: rawKey,
    scopes: apiKey.scopes,
    projectId: apiKey.projectId,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
  });
});

authRoutes.get("/api-keys", authMiddleware, requireApiKeyScope("read"), async (c) => {
  const user = c.get("user");
  const userKeys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      projectId: apiKeys.projectId,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id));

  return c.json(userKeys);
});

authRoutes.delete("/api-keys/:id", authMiddleware, requireApiKeyScope("admin"), async (c) => {
  const user = c.get("user");
  const auth = c.get("auth");
  const id = c.req.param("id");

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .limit(1);

  if (!key) {
    return c.json({ error: "API key not found" }, 404);
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  await recordAuditEventBestEffort({
    actorUserId: user.id,
    actorApiKeyId: auth?.method === "api_key" ? auth.apiKeyId : null,
    action: "api_key_deleted",
    targetType: "api_key",
    targetId: id,
    method: c.req.method,
    route: c.req.path,
    statusCode: 200,
  });
  return c.json({ ok: true });
});

authRoutes.post("/api-keys/:id/rotate", authMiddleware, requireApiKeyScope("admin"), rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "apikey-rotate" }), async (c) => {
  const user = c.get("user");
  const auth = c.get("auth");
  const id = c.req.param("id");

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .limit(1);

  if (!key) {
    return c.json({ error: "API key not found" }, 404);
  }

  const rawKey = `sdm_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  await db
    .update(apiKeys)
    .set({ keyHash, lastUsedAt: null })
    .where(eq(apiKeys.id, id));

  await recordAuditEventBestEffort({
    actorUserId: user.id,
    actorApiKeyId: auth?.method === "api_key" ? auth.apiKeyId : null,
    action: "api_key_rotated",
    targetType: "api_key",
    targetId: id,
    method: c.req.method,
    route: c.req.path,
    statusCode: 200,
  });

  return c.json({
    id: key.id,
    name: key.name,
    key: rawKey,
    scopes: key.scopes,
    projectId: key.projectId,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
  });
});
