import { Hono } from "hono";
import { sign } from "hono/jwt";
import { hash, compare } from "bcrypt";
import { db } from "../db/index.js";
import { users, apiKeys } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { randomBytes, createHash } from "crypto";
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

authRoutes.post("/api-keys", authMiddleware, async (c) => {
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
