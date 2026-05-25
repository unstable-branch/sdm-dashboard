import { Hono } from "hono";
import { sign } from "hono/jwt";
import { hash, compare } from "bcrypt";
import { db } from "../db/index.js";
import { users, apiKeys, projects, projectMembers, userSettings } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { randomBytes, createHash } from "crypto";
import { logAction, extractClientInfo } from "../services/audit.js";
import type { AppEnv } from "../middleware/auth.js";

export const authRoutes = new Hono<AppEnv>();

const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_ROUNDS = 12;

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

    await db
      .insert(userSettings)
      .values({ userId: user.id })
      .onConflictDoNothing();

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "user_register",
      entity: "users",
      entityId: user.id,
      ...client,
    });

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

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const client = extractClientInfo(c as any);
    logAction({
      userId: user.id,
      action: "user_login",
      entity: "users",
      entityId: user.id,
      ...client,
    });

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
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      organization: users.organization,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!dbUser) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(dbUser);
});

authRoutes.put("/me", authMiddleware, rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "profile-update" }), async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const allowed = ["name", "avatarUrl", "bio", "organization"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const [updated] = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  const client = extractClientInfo(c as any);
  logAction({
    userId: user.id,
    action: "user_profile_update",
    entity: "users",
    entityId: user.id,
    ...client,
  });

  return c.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    avatarUrl: updated.avatarUrl,
    bio: updated.bio,
    organization: updated.organization,
    lastLoginAt: updated.lastLoginAt,
    createdAt: updated.createdAt,
  });
});

authRoutes.post("/change-password", authMiddleware, rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "change-password" }), async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return c.json({ error: "Current password and new password are required" }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
  }

  const [dbUser] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!dbUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const valid = await compare(currentPassword, dbUser.passwordHash);
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  const newHash = await hash(newPassword, BCRYPT_ROUNDS);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const client = extractClientInfo(c as any);
  await logAction({
    userId: user.id,
    action: "user_password_change",
    entity: "users",
    entityId: user.id,
    ...client,
  });

  return c.json({ ok: true });
});

authRoutes.post("/api-keys", authMiddleware, rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "apikey-create" }), async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { name, expiresAt } = body;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  const rawKey = `sdm_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      keyHash,
      name,
      userId: user.id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  return c.json({
    id: apiKey.id,
    name: apiKey.name,
    key: rawKey,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
  });
});

authRoutes.get("/api-keys", authMiddleware, async (c) => {
  const user = c.get("user");
  const userKeys = await db
    .select({ id: apiKeys.id, name: apiKeys.name, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, expiresAt: apiKeys.expiresAt })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id));

  return c.json(userKeys);
});

authRoutes.delete("/api-keys/:id", authMiddleware, async (c) => {
  const user = c.get("user");
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
  return c.json({ ok: true });
});

authRoutes.post("/api-keys/:id/rotate", authMiddleware, rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "apikey-rotate" }), async (c) => {
  const user = c.get("user");
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

  return c.json({
    id: key.id,
    name: key.name,
    key: rawKey,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
  });
});
