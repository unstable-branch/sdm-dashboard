import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { refreshTokens, users } from "../db/schema.js";

export type SessionRole = "admin" | "editor" | "viewer";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: SessionRole;
  authVersion: number;
};

type RefreshToken = {
  raw: string;
  hash: string;
  expiresAt: Date;
};

type AccessTokenIssuer = (user: SessionUser) => Promise<string>;
type RefreshTokenFactory = () => RefreshToken;

const sessionUserFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  authVersion: users.authVersion,
} as const;

function isSessionRole(role: string): role is SessionRole {
  return role === "admin" || role === "editor" || role === "viewer";
}

// The transaction type is intentionally kept private. All callers use the
// helpers below, so refresh-row revocation cannot be accidentally performed
// outside the user lock and its surrounding transaction.
function revokeRefreshTokens(tx: any, userId: string): Promise<unknown> {
  return tx.update(refreshTokens).set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Issue a browser session while holding the user's row lock. The password hash
 * is compared again after the lock is acquired, so a login that raced recovery
 * cannot issue a session from stale credentials.
 */
export async function issueBrowserSession(
  userId: string,
  expectedPasswordHash: string,
  issueAccessToken: AccessTokenIssuer,
  createRefreshToken: RefreshTokenFactory,
): Promise<{ user: SessionUser; accessToken: string; refreshToken: string } | null> {
  return db.transaction(async (tx) => {
    const [lockedUser] = await tx.select({
      ...sessionUserFields,
      passwordHash: users.passwordHash,
    }).from(users).where(eq(users.id, userId)).for("update").limit(1);

    if (!lockedUser || lockedUser.passwordHash !== expectedPasswordHash || !isSessionRole(lockedUser.role)) {
      return null;
    }

    // Keep this update in the same transaction as both token issuances. A
    // recovery operation therefore commits either before this session or after
    // it, and cannot interleave between the access and refresh tokens.
    const [currentUser] = await tx.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId))
      .returning(sessionUserFields);
    if (!currentUser || !isSessionRole(currentUser.role)) return null;

    const refresh = createRefreshToken();
    await tx.insert(refreshTokens).values({
      userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    const accessToken = await issueAccessToken(currentUser);

    return { user: currentUser, accessToken, refreshToken: refresh.raw };
  });
}

/** Atomically invalidates browser sessions. API keys remain separate automation credentials. */
export async function invalidateBrowserSessions(userId: string, clearResetToken = true): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      authVersion: sql.raw("auth_version + 1"),
      ...(clearResetToken ? { resetToken: null, resetTokenExpiry: null } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
    await revokeRefreshTokens(tx, userId);
  });
}

/** Update a user and invalidate sessions when the role changes. */
export async function updateUserAndMaybeInvalidate(
  userId: string,
  updates: {
    email?: string;
    name?: string;
    role?: SessionRole;
    bio?: string;
    organization?: string;
  },
): Promise<{ updated: {
  id: string;
  email: string;
  name: string | null;
  role: SessionRole;
  avatarUrl: string | null;
  bio: string | null;
  organization: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}; changedRole: boolean } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ role: users.role })
      .from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!current || !isSessionRole(current.role)) return null;

    const changedRole = updates.role !== undefined && updates.role !== current.role;
    const [updated] = await tx.update(users)
      .set({ ...updates, ...(changedRole ? { authVersion: sql`${users.authVersion} + 1` } : {}), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        organization: users.organization,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      });
    if (!updated || !isSessionRole(updated.role)) return null;
    if (changedRole) await revokeRefreshTokens(tx, userId);
    return { updated: { ...updated, role: updated.role as SessionRole }, changedRole };
  });
}

/** Change a password and invalidate all browser sessions in one transaction. */
export async function updatePasswordAndInvalidate(
  userId: string,
  passwordHash: string,
  expectedPasswordHash?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const passwordCondition = expectedPasswordHash === undefined
      ? eq(users.id, userId)
      : and(eq(users.id, userId), eq(users.passwordHash, expectedPasswordHash));
    const [updated] = await tx.update(users).set({
      passwordHash,
      authVersion: sql.raw("auth_version + 1"),
      resetToken: null,
      resetTokenExpiry: null,
      updatedAt: new Date(),
    }).where(passwordCondition).returning({ id: users.id });
    if (!updated) return false;
    await revokeRefreshTokens(tx, userId);
    return true;
  });
}

/** Consume one reset token and invalidate all browser sessions atomically. */
export async function consumePasswordReset(
  userId: string,
  resetTokenHash: string,
  passwordHash: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(users).set({
      passwordHash,
      authVersion: sql.raw("auth_version + 1"),
      resetToken: null,
      resetTokenExpiry: null,
      updatedAt: new Date(),
    }).where(and(
      eq(users.id, userId),
      eq(users.resetToken, resetTokenHash),
      gt(users.resetTokenExpiry, sql.raw("CURRENT_TIMESTAMP")),
    )).returning({ id: users.id });
    if (!updated) return false;
    await revokeRefreshTokens(tx, userId);
    return true;
  });
}

export type RotatedRefresh = { accessToken: string; refreshToken: string };

/**
 * Rotate one refresh token under the same per-user lock used by recovery. The
 * conditional consume is the one-consumer gate; successor insertion and access
 * token issuance are in the same transaction and therefore roll back together.
 */
export async function rotateRefreshToken(
  tokenHash: string,
  replacement: RefreshToken,
  issueAccessToken: AccessTokenIssuer,
): Promise<RotatedRefresh | null> {
  return db.transaction(async (tx) => {
    // This lookup only discovers the user to lock. It is deliberately not the
    // consume operation; the conditional UPDATE below is authoritative.
    const [candidate] = await tx.select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
    }).from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
    if (!candidate) return null;

    // All auth-version/recovery paths lock users before touching refresh rows.
    const [currentUser] = await tx.select(sessionUserFields)
      .from(users).where(eq(users.id, candidate.userId)).for("update").limit(1);
    if (!currentUser || !isSessionRole(currentUser.role)) return null;

    const consumed = await tx.update(refreshTokens).set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokens.id, candidate.id),
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql.raw("CURRENT_TIMESTAMP")),
      ))
      .returning({ id: refreshTokens.id });
    if (consumed.length !== 1) return null;

    await tx.insert(refreshTokens).values({
      userId: candidate.userId,
      tokenHash: replacement.hash,
      expiresAt: replacement.expiresAt,
    });
    const accessToken = await issueAccessToken(currentUser);
    return { accessToken, refreshToken: replacement.raw };
  });
}
