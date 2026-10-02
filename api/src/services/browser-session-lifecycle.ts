import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { browserSessions, refreshTokens, users } from "../db/schema.js";

export type BrowserSessionRole = "admin" | "editor" | "viewer";
export type BrowserSessionUser = { id: string; email: string; role: BrowserSessionRole; authVersion: number };
export type BrowserRefreshCredential = { raw: string; hash: string; expiresAt: Date };
export type BrowserTokenIssuer = (user: BrowserSessionUser, sessionId: string) => Promise<string>;

function validRole(role: string): role is BrowserSessionRole {
  return role === "admin" || role === "editor" || role === "viewer";
}
function validHash(hash: string): boolean {
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash);
}
function future(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime()) && date.getTime() > Date.now();
}
const userFields = { id: users.id, email: users.email, role: users.role, authVersion: users.authVersion } as const;

/**
 * Create one browser family only after locking and rechecking the current user
 * and password. The callback receives the durable session identity and current
 * authVersion for future JWT claim wiring; this service does not issue JWTs.
 */
export async function issuePersistentBrowserSession(
  userId: string,
  expectedPasswordHash: string,
  refresh: BrowserRefreshCredential,
  issueAccessToken: BrowserTokenIssuer,
): Promise<{ sessionId: string; user: BrowserSessionUser; accessToken: string; refreshToken: string } | null> {
  if (!validHash(refresh.hash) || !refresh.raw || !future(refresh.expiresAt)) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ ...userFields, passwordHash: users.passwordHash })
      .from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!row || row.passwordHash !== expectedPasswordHash || !validRole(row.role) || !Number.isSafeInteger(row.authVersion) || row.authVersion < 0) return null;
    const user: BrowserSessionUser = { id: row.id, email: row.email, role: row.role, authVersion: row.authVersion };
    const [session] = await tx.insert(browserSessions).values({
      userId: row.id, authVersion: row.authVersion, expiresAt: refresh.expiresAt,
    }).returning({ id: browserSessions.id });
    await tx.insert(refreshTokens).values({ userId: row.id, tokenHash: refresh.hash, sessionId: session.id, expiresAt: refresh.expiresAt });
    const accessToken = await issueAccessToken(user, session.id);
    return { sessionId: session.id, user, accessToken, refreshToken: refresh.raw };
  });
}

/** Consume a browser refresh token once and atomically insert its same-family successor. */
export async function rotatePersistentBrowserRefresh(
  tokenHash: string,
  replacement: BrowserRefreshCredential,
  issueAccessToken: BrowserTokenIssuer,
): Promise<{ sessionId: string; accessToken: string; refreshToken: string } | null> {
  if (!validHash(tokenHash) || !validHash(replacement.hash) || !replacement.raw || !future(replacement.expiresAt)) return null;
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ rowId: refreshTokens.id, userId: refreshTokens.userId, sessionId: refreshTokens.sessionId })
      .from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
    if (!candidate?.sessionId) return null; // Legacy refresh rows are not browser families.
    const [row] = await tx.select({ ...userFields, passwordHash: users.passwordHash })
      .from(users).where(eq(users.id, candidate.userId)).for("update").limit(1);
    if (!row || !validRole(row.role) || !Number.isSafeInteger(row.authVersion) || row.authVersion < 0) return null;
    const [session] = await tx.select({ id: browserSessions.id, authVersion: browserSessions.authVersion, expiresAt: browserSessions.expiresAt, revokedAt: browserSessions.revokedAt })
      .from(browserSessions).where(and(eq(browserSessions.id, candidate.sessionId), eq(browserSessions.userId, candidate.userId)))
      .for("update").limit(1);
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.authVersion !== row.authVersion) return null;
    const [consumed] = await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(
      eq(refreshTokens.id, candidate.rowId), eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.sessionId, session.id),
      isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`),
    )).returning({ id: refreshTokens.id });
    if (!consumed) return null;
    await tx.update(browserSessions).set({ expiresAt: replacement.expiresAt }).where(eq(browserSessions.id, session.id));
    const user: BrowserSessionUser = { id: row.id, email: row.email, role: row.role, authVersion: row.authVersion };
    await tx.insert(refreshTokens).values({ userId: row.id, tokenHash: replacement.hash, sessionId: session.id, expiresAt: replacement.expiresAt });
    const accessToken = await issueAccessToken(user, session.id);
    return { sessionId: session.id, accessToken, refreshToken: replacement.raw };
  });
}

/** Revoke one identified family using either its current or consumed unexpired refresh-token hash. */
export async function revokePersistentBrowserSession(tokenHash: string): Promise<boolean> {
  if (!validHash(tokenHash)) return false;
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ userId: refreshTokens.userId, sessionId: refreshTokens.sessionId })
      .from(refreshTokens).where(and(eq(refreshTokens.tokenHash, tokenHash), gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`))).limit(1);
    if (!candidate?.sessionId) return false;
    // Global lock order: user first, then family/session; recovery uses this order too.
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.userId)).for("update").limit(1);
    if (!user) return false;
    const [session] = await tx.select({ id: browserSessions.id, revokedAt: browserSessions.revokedAt })
      .from(browserSessions).where(and(eq(browserSessions.id, candidate.sessionId), eq(browserSessions.userId, candidate.userId)))
      .for("update").limit(1);
    if (!session) return false;
    if (session.revokedAt) return true;
    const [updated] = await tx.update(browserSessions).set({ revokedAt: new Date() }).where(and(
      eq(browserSessions.id, session.id), isNull(browserSessions.revokedAt), gt(browserSessions.expiresAt, sql`CURRENT_TIMESTAMP`),
    )).returning({ id: browserSessions.id });
    return Boolean(updated);
  });
}

/** Current-user/session predicate for future principal wiring; no JWT route calls it yet. */
export async function isPersistentBrowserSessionActive(userId: string, sessionId: string, authVersion: number): Promise<boolean> {
  if (!userId || !sessionId || !Number.isSafeInteger(authVersion) || authVersion < 0) return false;
  const [row] = await db.select({ userRole: users.role, userVersion: users.authVersion, sessionVersion: browserSessions.authVersion })
    .from(browserSessions).innerJoin(users, eq(users.id, browserSessions.userId)).where(and(
      eq(browserSessions.id, sessionId), eq(browserSessions.userId, userId), eq(browserSessions.authVersion, authVersion),
      eq(users.authVersion, authVersion), isNull(browserSessions.revokedAt), gt(browserSessions.expiresAt, sql`CURRENT_TIMESTAMP`),
    )).limit(1);
  return Boolean(row && validRole(row.userRole) && row.userVersion === row.sessionVersion);
}
