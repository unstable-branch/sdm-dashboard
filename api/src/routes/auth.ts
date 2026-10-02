import { Hono } from "hono";
import { sign } from "hono/jwt";
import { hash, compare } from "bcrypt";
import { db } from "../db/index.js";
import { users, apiKeys, projects, projectMembers, userSettings } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "crypto";
import { logAction, extractClientInfo } from "../services/audit.js";
import { sendPasswordResetEmail, generateToken, hashToken } from "../services/email.js";
import type { AppEnv } from "../middleware/auth.js";
import {
  consumePasswordReset,
  invalidateBrowserSessions,
  issueBrowserSession,
  rotateRefreshToken,
  updatePasswordAndInvalidate,
} from "../services/sessions.js";
import {
  issuePersistentBrowserSession,
  rotatePersistentBrowserRefresh,
  revokePersistentBrowserSession,
} from "../services/browser-session-lifecycle.js";

export const authRoutes = new Hono<AppEnv>();

authRoutes.onError((err, c) => {
  console.error("[auth] Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER?.trim() || "sdm-dashboard";
const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY_S = 900; // 15 minutes
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const REFRESH_TOKEN_BYTES = 32;

function hashRefreshToken(token: string): string {
  if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
  return createHmac("sha256", JWT_SECRET).update(token).digest("hex");
}

function createRefreshToken() {
  const raw = randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  return {
    raw,
    hash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400000),
  };
}

function createBrowserRefreshToken(rememberMe: boolean) {
  const entropy = randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  const persistence = rememberMe ? "p" : "s";
  const proof = createHmac("sha256", JWT_SECRET as string).update(`${entropy}.${persistence}`).digest("hex");
  const raw = `${entropy}.${persistence}.${proof}`;
  return { raw, hash: hashRefreshToken(raw), expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400000) };
}

function browserRefreshPersistence(token: string): boolean | null {
  const match = /^([a-f0-9]{64})\.([ps])\.([a-f0-9]{64})$/.exec(token);
  if (!match || !JWT_SECRET) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${match[1]}.${match[2]}`).digest("hex");
  const actualBytes = Buffer.from(match[3], "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  return match[2] === "p";
}

function parseCookie(cookieHeader: string | undefined, names: string[]): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const name of names) {
    const prefix = `${name}=`;
    const item = cookies.find((part) => part.startsWith(prefix));
    if (!item) continue;
    try { return decodeURIComponent(item.slice(prefix.length)) || null; } catch { return null; }
  }
  return null;
}

function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin || origin === "null") return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return false;
    const raw = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000";
    return raw.split(",").map((value) => value.trim()).filter(Boolean)
      .some((value) => new URL(value).origin === parsed.origin);
  } catch { return false; }
}

function browserCookieNames(c: { req: { url: string } }) {
  const secure = process.env.NODE_ENV === "production" || new URL(c.req.url).protocol === "https:";
  return secure
    ? { access: "__Host-sdm_token", refresh: "__Host-sdm_refresh_token", secure: true }
    : { access: "sdm_token", refresh: "sdm_refresh_token", secure: false };
}

function setBrowserSessionCookies(c: any, accessToken: string, refreshToken: string, rememberMe: boolean) {
  const names = browserCookieNames(c);
  const flags = `Path=/; HttpOnly; SameSite=Strict${names.secure ? "; Secure" : ""}`;
  const accessAge = rememberMe ? `; Max-Age=${ACCESS_TOKEN_EXPIRY_S}` : "";
  const refreshAge = rememberMe ? `; Max-Age=${REFRESH_TOKEN_EXPIRY_DAYS * 86400}` : "";
  c.header("Set-Cookie", `${names.access}=${encodeURIComponent(accessToken)}; ${flags}${accessAge}`, { append: true });
  c.header("Set-Cookie", `${names.refresh}=${encodeURIComponent(refreshToken)}; ${flags}${refreshAge}`, { append: true });
}

function clearBrowserSessionCookies(c: any) {
  const names = browserCookieNames(c);
  const flags = `Path=/; HttpOnly; SameSite=Strict${names.secure ? "; Secure" : ""}; Max-Age=0`;
  for (const name of [names.access, names.refresh]) c.header("Set-Cookie", `${name}=; ${flags}`, { append: true });
}

function isBrowserSessionRequest(body: unknown): body is { browser_session: true; remember_me: boolean } {
  return typeof body === "object" && body !== null && (body as Record<string, unknown>).browser_session === true;
}

async function issueAccessToken(user: { id: string; email: string; role: string; authVersion: number }, sessionId?: string): Promise<string> {
  return sign(
    { sub: user.id, email: user.email, role: user.role, av: user.authVersion, iss: JWT_ISSUER, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_S,
      ...(sessionId ? { browser_session: true, sid: sessionId } : {}) },
    JWT_SECRET as string,
  );
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a digit";
  return null;
}

authRoutes.use("/register", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "register" }));
authRoutes.use("/forgot-password", rateLimit({ windowMs: 60_000, max: 3, keyPrefix: "forgot-pw" }));
authRoutes.use("/reset-password", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "reset-pw" }));
authRoutes.use("/login", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "login" }));

authRoutes.post("/register", async (c) => {
  if (!JWT_SECRET) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  try {
    const body = await c.req.json();
    const { email, password, name } = body;
    const browserSession = isBrowserSessionRequest(body);
    if (browserSession && (!isAllowedBrowserOrigin(c.req.header("Origin")) || typeof body.remember_me !== "boolean")) {
      return c.json({ error: "Invalid browser session request" }, 403);
    }

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const pwErr = validatePassword(password);
    if (pwErr) return c.json({ error: pwErr }, 400);

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

    const client = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: "user_register",
      entity: "users",
      entityId: user.id,
      ...client,
    });

    const session = browserSession
      ? await issuePersistentBrowserSession(user.id, passwordHash, createBrowserRefreshToken(body.remember_me), issueAccessToken)
      : await issueBrowserSession(user.id, passwordHash, issueAccessToken, createRefreshToken);
    if (!session) return c.json({ error: "Registration failed" }, 500);
    const token = session.accessToken;
    const refreshToken = session.refreshToken;
    if (browserSession) setBrowserSessionCookies(c, token, refreshToken, body.remember_me);

    return c.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...(browserSession ? {} : { token, refresh_token: refreshToken }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: message }, 500);
  }
});

const LOGIN_LOCKOUT_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const _loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function checkLoginLockout(email: string): string | null {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const record = _loginAttempts.get(key);

  if (record) {
    if (now < record.lockedUntil) {
      const remaining = Math.ceil((record.lockedUntil - now) / 1000 / 60);
      return `Account temporarily locked. Try again in ${remaining} minute(s).`;
    }
    if (now >= record.lockedUntil) {
      _loginAttempts.delete(key);
    }
  }
  return null;
}

function recordLoginAttempt(email: string, success: boolean) {
  const key = email.toLowerCase().trim();
  if (success) {
    _loginAttempts.delete(key);
    return;
  }
  const now = Date.now();
  const record = _loginAttempts.get(key) || { count: 0, lockedUntil: now };
  record.count += 1;
  if (record.count >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOGIN_LOCKOUT_WINDOW_MS;
    record.count = 0;
  }
  _loginAttempts.set(key, record);

  if (_loginAttempts.size > 10000) {
    for (const [k, v] of _loginAttempts) {
      if (now >= v.lockedUntil && v.count === 0) _loginAttempts.delete(k);
    }
  }
}

authRoutes.post("/login", async (c) => {
  if (!JWT_SECRET) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  try {
    const body = await c.req.json();
    const { email, password } = body;
    const browserSession = isBrowserSessionRequest(body);
    if (browserSession && (!isAllowedBrowserOrigin(c.req.header("Origin")) || typeof body.remember_me !== "boolean")) {
      return c.json({ error: "Invalid browser session request" }, 403);
    }

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const lockoutMsg = checkLoginLockout(email);
    if (lockoutMsg) {
      return c.json({ error: lockoutMsg }, 429);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      recordLoginAttempt(email, false);
      const client = extractClientInfo(c);
      logAction({ action: "login_failed", entity: "users", details: { email, reason: "not_found" }, ...client }).catch((e) => console.warn("[auth] Failed to log login_failed (not_found):", e));
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      recordLoginAttempt(email, false);
      const client = extractClientInfo(c);
      logAction({ userId: user.id, action: "login_failed", entity: "users", entityId: user.id, details: { reason: "wrong_password" }, ...client }).catch((e) => console.warn("[auth] Failed to log login_failed (wrong_password):", e));
      return c.json({ error: "Invalid credentials" }, 401);
    }

    recordLoginAttempt(email, true);

    const session = browserSession
      ? await issuePersistentBrowserSession(user.id, user.passwordHash, createBrowserRefreshToken(body.remember_me), issueAccessToken)
      : await issueBrowserSession(user.id, user.passwordHash, issueAccessToken, createRefreshToken);
    if (!session) return c.json({ error: "Invalid credentials" }, 401);
    const currentUser = session.user;

    const client = extractClientInfo(c);
    logAction({
      userId: currentUser.id,
      action: "user_login",
      entity: "users",
      entityId: currentUser.id,
      ...client,
    });

    const token = session.accessToken;
    const refreshToken = session.refreshToken;

    if (browserSession) {
      setBrowserSessionCookies(c, token, refreshToken, body.remember_me);
    } else {
      const isSecure = process.env.NODE_ENV === "production" || c.req.header("X-Forwarded-Proto") === "https";
      const cookieName = isSecure ? "__Host-sdm_token" : "sdm_token";
      const secureFlag = isSecure ? "; Secure" : "";
      c.header("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=${ACCESS_TOKEN_EXPIRY_S}`);
    }

    return c.json({
      user: { id: currentUser.id, email: currentUser.email, name: "name" in currentUser ? currentUser.name : user.name, role: currentUser.role },
      ...(browserSession ? {} : { token, refresh_token: refreshToken }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    return c.json({ error: message }, 500);
  }
});

authRoutes.post("/refresh", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "refresh" }), async (c) => {
  if (!JWT_SECRET) {
    return c.json({ error: "Authentication unavailable (server not configured)" }, 503);
  }
  try {
    const body = await c.req.json();
    const browserSession = isBrowserSessionRequest(body);
    if (browserSession && !isAllowedBrowserOrigin(c.req.header("Origin"))) {
      return c.json({ error: "Invalid browser session origin" }, 403);
    }
    const refreshToken = browserSession
      ? parseCookie(c.req.header("Cookie"), [browserCookieNames(c).refresh])
      : body.refresh_token;
    if (!refreshToken) {
      return c.json({ error: browserSession ? "Browser refresh cookie is required" : "refresh_token is required" }, browserSession ? 401 : 400);
    }

    const persistence = browserSession ? browserRefreshPersistence(refreshToken) : null;
    if (browserSession && persistence === null) return c.json({ error: "Invalid or revoked refresh token" }, 401);
    if (!browserSession && browserRefreshPersistence(refreshToken) !== null) {
      return c.json({ error: "Browser refresh credentials require cookie exchange" }, 401);
    }
    const replacement = browserSession ? createBrowserRefreshToken(persistence === true) : createRefreshToken();
    const stored = browserSession
      ? await rotatePersistentBrowserRefresh(hashRefreshToken(refreshToken), replacement, issueAccessToken)
      : await rotateRefreshToken(hashRefreshToken(refreshToken), replacement, issueAccessToken);
    if (!stored) return c.json({ error: "Invalid or revoked refresh token" }, 401);

    if (browserSession) setBrowserSessionCookies(c, stored.accessToken, stored.refreshToken, persistence === true);
    return c.json(browserSession
      ? { ok: true }
      : { token: stored.accessToken, refresh_token: stored.refreshToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    return c.json({ error: message }, 500);
  }
});

authRoutes.post("/logout", async (c) => {
  if (!isAllowedBrowserOrigin(c.req.header("Origin")) || c.req.header("X-API-Key") || c.req.header("Authorization")) {
    return c.json({ error: "Invalid browser logout request" }, 403);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid browser logout request" }, 400); }
  if (!isBrowserSessionRequest(body)) return c.json({ error: "Invalid browser logout request" }, 403);
  const refreshToken = parseCookie(c.req.header("Cookie"), [browserCookieNames(c).refresh]);
  if (!refreshToken || browserRefreshPersistence(refreshToken) === null) {
    return c.json({ error: "Invalid or expired browser session credential" }, 401);
  }
  let revoked: boolean;
  try {
    revoked = await revokePersistentBrowserSession(hashRefreshToken(refreshToken));
  } catch {
    return c.json({ error: "Authentication service unavailable" }, 503);
  }
  if (!revoked) return c.json({ error: "Invalid or expired browser session credential" }, 401);
  clearBrowserSessionCookies(c);
  return c.json({ ok: true });
});

authRoutes.post("/revoke-all", authMiddleware, async (c) => {
  const user = c.get("user");
  await invalidateBrowserSessions(user.id);
  const isSecure = process.env.NODE_ENV === "production" || c.req.header("X-Forwarded-Proto") === "https";
  const cookieName = isSecure ? "__Host-sdm_token" : "sdm_token";
  c.header("Set-Cookie", cookieName + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  return c.json({ ok: true });
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

  const client = extractClientInfo(c);
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

  const pwErr = validatePassword(newPassword);
  if (pwErr) return c.json({ error: pwErr }, 400);

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
  const changed = await updatePasswordAndInvalidate(user.id, newHash, dbUser.passwordHash);
  if (!changed) return c.json({ error: "Session changed; please sign in again" }, 401);

  const isSecure = process.env.NODE_ENV === "production" || c.req.header("X-Forwarded-Proto") === "https";
  const cookieName = isSecure ? "__Host-sdm_token" : "sdm_token";
  c.header("Set-Cookie", cookieName + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");

  const client = extractClientInfo(c);
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
  const { name, expiresAt, scopeProjectId } = body;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  // Optional single-project scope: the creator must currently be a member (or
  // the owner / a global admin) of the project they scope the key to. A stale
  // or foreign projectId denies closed.
  let scopedProjectId: string | null = null;
  if (scopeProjectId !== undefined && scopeProjectId !== null) {
    if (typeof scopeProjectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scopeProjectId)) {
      return c.json({ error: "Invalid scopeProjectId" }, 400);
    }
    const [project] = await db.select({ id: projects.id, ownerId: projects.ownerId })
      .from(projects).where(eq(projects.id, scopeProjectId)).limit(1);
    if (!project) return c.json({ error: "Scope project not found" }, 404);
    if (project.ownerId !== user.id && user.role !== "admin") {
      const [membership] = await db.select({ id: projectMembers.id })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, scopeProjectId), eq(projectMembers.userId, user.id)))
        .limit(1);
      if (!membership) return c.json({ error: "Not a member of the scope project" }, 403);
    }
    scopedProjectId = scopeProjectId;
  }

  const rawKey = `sdm_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      keyHash,
      keyPreview: rawKey.substring(0, 8),
      name,
      userId: user.id,
      scopeProjectId: scopedProjectId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  const client = extractClientInfo(c);
  await logAction({
    userId: user.id,
    action: "api_key_created",
    entity: "api_keys",
    entityId: apiKey.id,
    ...client,
    details: { name, expiresAt: apiKey.expiresAt ?? null, scoped: scopedProjectId !== null },
  });

  return c.json({
    id: apiKey.id,
    name: apiKey.name,
    key: rawKey,
    keyPreview: rawKey.substring(0, 8),
    showOnce: true,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
  });
});

authRoutes.get("/api-keys", authMiddleware, async (c) => {
  const user = c.get("user");
  const userKeys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPreview: apiKeys.keyPreview,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    })
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

  const client = extractClientInfo(c);
  await logAction({
    userId: user.id,
    action: "api_key_deleted",
    entity: "api_keys",
    entityId: id,
    ...client,
    details: { name: key.name },
  });

  return c.json({ ok: true });
});

authRoutes.post("/forgot-password", async (c) => {
  const body = await c.req.json();
  const { email } = body;

  if (!email) {
    return c.json({ error: "Email is required" }, 400);
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  const client = extractClientInfo(c);

  if (user) {
    const token = generateToken();
    const hashedToken = hashToken(token);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    await db
      .update(users)
      .set({ resetToken: hashedToken, resetTokenExpiry: expiry, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    await sendPasswordResetEmail(user.email, token, appUrl);

    await logAction({
      userId: user.id,
      action: "password_reset_requested",
      entity: "users",
      entityId: user.id,
      ...client,
    });
  }

  return c.json({
    message: "If that email is registered, a password reset link has been sent.",
  });
});

authRoutes.post("/reset-password", async (c) => {
  const body = await c.req.json();
  const { token, password } = body;

  if (!token || !password) {
    return c.json({ error: "Token and new password are required" }, 400);
  }

  const pwErr = validatePassword(password);
  if (pwErr) return c.json({ error: pwErr }, 400);

  const hashedToken = hashToken(token);

  const [user] = await db
    .select({ id: users.id, email: users.email, resetToken: users.resetToken, resetTokenExpiry: users.resetTokenExpiry })
    .from(users)
    .where(eq(users.resetToken, hashedToken))
    .limit(1);

  if (!user) {
    return c.json({ error: "Invalid or expired reset token" }, 400);
  }

  if (!user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
    return c.json({ error: "Invalid or expired reset token" }, 400);
  }

  const newHash = await hash(password, BCRYPT_ROUNDS);
  const reset = await consumePasswordReset(user.id, hashedToken, newHash);
  if (!reset) return c.json({ error: "Invalid or expired reset token" }, 400);

  const client = extractClientInfo(c);
  await logAction({
    userId: user.id,
    action: "password_reset_completed",
    entity: "users",
    entityId: user.id,
    ...client,
  });

  return c.json({ ok: true });
});
