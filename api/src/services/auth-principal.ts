import { createHash } from "crypto";
import { verify } from "hono/jwt";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys, users } from "../db/schema.js";

export type Principal = {
  id: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  authVersion: number;
  source: "jwt" | "api-key";
};

export class AuthStorageUnavailable extends Error {
  constructor() { super("Authentication storage unavailable"); }
}

// PostgreSQL UUIDs are opaque identifiers. Do not restrict the version nibble
// here: future UUID versions are still valid database identifiers.
// PostgreSQL accepts all UUID bit patterns, including the nil UUID. Validate
// the scalar/canonical shape here without imposing a version/variant policy
// that the database itself does not impose.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(["admin", "editor", "viewer"]);

function asPrincipal(row: { id: string; email: string; role: string; authVersion: number }, source: Principal["source"]): Principal | null {
  if (!ROLES.has(row.role) || !Number.isSafeInteger(row.authVersion) || row.authVersion < 0) return null;
  return { id: row.id, email: row.email, role: row.role as Principal["role"], authVersion: row.authVersion, source };
}

async function currentUser(userId: string, source: Principal["source"]): Promise<Principal | null> {
  try {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      role: users.role,
      authVersion: users.authVersion,
    }).from(users).where(eq(users.id, userId)).limit(1);
    return user ? asPrincipal(user, source) : null;
  } catch {
    throw new AuthStorageUnavailable();
  }
}

/** Verifies a JWT and resolves its principal from current auth storage. */
export async function verifyCurrentJwt(token: string): Promise<Principal | null> {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return null;
  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, secret, "HS256") as Record<string, unknown>;
  } catch {
    return null;
  }
  const expectedIssuer = process.env.JWT_ISSUER?.trim() || "sdm-dashboard";
  const now = Math.floor(Date.now() / 1000);
  // hono/jwt validates exp when present, but its API intentionally permits a
  // token without exp. Access tokens in this application are always bounded.
  if (payload.iss !== expectedIssuer || typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
  if (!Number.isSafeInteger(payload.av) || (payload.av as number) < 0) return null;
  const principal = await currentUser(payload.sub, "jwt");
  return principal && principal.authVersion === payload.av ? principal : null;
}

/** Resolves an API key to a current user. API keys intentionally survive session revocation. */
export async function verifyCurrentApiKey(rawKey: string): Promise<Principal | null> {
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  try {
    const [key] = await db.select({ userId: apiKeys.userId, expiresAt: apiKeys.expiresAt })
      .from(apiKeys).where(and(eq(apiKeys.keyHash, keyHash))).limit(1);
    if (!key || (key.expiresAt && key.expiresAt <= new Date())) return null;
    return await currentUser(key.userId, "api-key");
  } catch (error) {
    if (error instanceof AuthStorageUnavailable) throw error;
    throw new AuthStorageUnavailable();
  }
}
