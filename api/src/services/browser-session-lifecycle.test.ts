import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BrowserSessionUser } from "./browser-session-lifecycle.js";

const databaseUrl = process.env.SDM_BROWSER_SESSION_TEST_DATABASE_URL;
const containerId = process.env.SDM_BROWSER_SESSION_TEST_CONTAINER_ID;
const containerName = "sdm-session-lifecycle-pg-20261002";
const expectedImageId = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";

function guardContainerShape(value: unknown, id: string, port: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("inspected container shape invalid");
  const c = value as { Id?: unknown; Image?: unknown; Name?: unknown; Config?: { Image?: unknown }; NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: unknown; HostPort?: unknown }> | null> }; HostConfig?: { PortBindings?: Record<string, Array<{ HostIp?: unknown; HostPort?: unknown }> | null>; NanoCpus?: unknown; Memory?: unknown; Tmpfs?: Record<string, unknown> }; Mounts?: unknown };
  const bindings = c.NetworkSettings?.Ports?.["5432/tcp"];
  const configuredBindings = c.HostConfig?.PortBindings?.["5432/tcp"];
  const cpu = c.HostConfig?.NanoCpus, memory = c.HostConfig?.Memory;
  if (c.Id !== id || c.Name !== `/${containerName}` || c.Config?.Image !== "postgres:17-alpine" || c.Image !== expectedImageId ||
      !Array.isArray(bindings) || bindings.length !== 1 || bindings[0]?.HostIp !== "127.0.0.1" || bindings[0]?.HostPort !== port ||
      !Array.isArray(configuredBindings) || configuredBindings.length !== 1 || configuredBindings[0]?.HostIp !== "127.0.0.1" || configuredBindings[0]?.HostPort !== port ||
      !Array.isArray(c.Mounts) || c.Mounts.length !== 0 || typeof cpu !== "number" || !Number.isFinite(cpu) || cpu <= 0 || cpu > 2_000_000_000 ||
      typeof memory !== "number" || !Number.isFinite(memory) || memory <= 0 || memory > 536_870_912 ||
      typeof c.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] !== "string") throw new Error("container is not owned, bounded, loopback, tmpfs disposable");
}

function assertDisposableUrl(databaseUrl: string): URL {
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("malformed disposable URL"); }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.username !== "sdm_lifecycle_test" || url.password !== "" ||
      url.pathname !== "/sdm_lifecycle_test" || url.search || !/^\d+$/.test(url.port)) throw new Error("unsafe disposable URL");
  return url;
}

function assertOwnedDisposableDatabase(): string {
  if (!databaseUrl || !containerId) throw new Error("Persistent browser-session integration opt-in and container identity are both required");
  let url: URL;
  try { url = assertDisposableUrl(databaseUrl); } catch { throw new Error("Persistent browser-session integration target is not the expected credentialless loopback disposable database"); }
  let inspected: { Id: string; Image: string; Config: { Image: string }; Name: string; NetworkSettings: { Ports: Record<string, Array<{ HostIp: string; HostPort: string }>> }; HostConfig: { PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>; NanoCpus: number; Memory: number; Tmpfs?: Record<string, string> }; Mounts: unknown[] };
  try {
    inspected = JSON.parse(execFileSync("docker", ["inspect", containerName], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 }))[0];
  } catch { throw new Error("Persistent browser-session disposable container could not be verified"); }
  try { guardContainerShape(inspected, containerId, url.port); } catch {
    throw new Error("Persistent browser-session test refused unowned, unbounded, persistent or non-loopback database container");
  }
  try { execFileSync("docker", ["exec", containerName, "pg_isready", "-U", "sdm_lifecycle_test", "-d", "sdm_lifecycle_test"], { stdio: "ignore" }); }
  catch { throw new Error("Persistent browser-session disposable database is not ready"); }
  return databaseUrl;
}

describe("disposable PostgreSQL guard", () => {
  const good = { Id: "container-id", Image: expectedImageId, Name: `/${containerName}`, Config: { Image: "postgres:17-alpine" },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
    HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] }, NanoCpus: 2_000_000_000, Memory: 536_870_912, Tmpfs: { "/var/lib/postgresql/data": "rw,size=480m" } }, Mounts: [] };
  it("accepts only positive bounded inspected CPU and memory with complete expected shape", () => {
    expect(() => guardContainerShape(good, "container-id", "54321")).not.toThrow();
    for (const [field, value] of [["NanoCpus", 0], ["NanoCpus", undefined], ["Memory", 0], ["Memory", undefined]] as const) {
      const malformed = structuredClone(good);
      if (value === undefined) delete malformed.HostConfig[field];
      else malformed.HostConfig[field] = value;
      expect(() => guardContainerShape(malformed, "container-id", "54321")).toThrow();
    }
  });
  it("rejects missing inspected container structures and non-loopback URLs", () => {
    expect(() => guardContainerShape({}, "container-id", "54321")).toThrow();
    expect(() => assertDisposableUrl("postgresql://user@localhost:54321/db")).toThrow();
  });
});

if (!databaseUrl && !containerId) {
  describe.skip("persistent browser-session lifecycle (opt-in real PostgreSQL)", () => {
    it("requires SDM_BROWSER_SESSION_TEST_DATABASE_URL and verified container identity", () => {});
  });
} else {
  // Verify resource ownership and isolation before setting DATABASE_URL or importing db/index.ts.
  const verifiedUrl = assertOwnedDisposableDatabase();
  process.env.DATABASE_URL = verifiedUrl;
  const [{ db }, { refreshTokens, users }, { eq, sql }, { Client }] = await Promise.all([
    import("../db/index.js"), import("../db/schema.js"), import("drizzle-orm"), import("pg"),
  ]);
  const {
    isPersistentBrowserSessionActive, issuePersistentBrowserSession, revokePersistentBrowserSession, rotatePersistentBrowserRefresh,
  } = await import("./browser-session-lifecycle.js");

  const userId = "10000000-0000-4000-8000-000000000001";
  const userB = "10000000-0000-4000-8000-000000000002";
  const ROLLING_REFRESH_MS = 30 * 24 * 60 * 60 * 1_000;
  const token = (v: string) => ({ raw: `raw-${v}`, hash: createHash("sha256").update(v).digest("hex"), expiresAt: new Date(Date.now() + ROLLING_REFRESH_MS) });
  const identity = (user: { id: string; email: string; role: "admin" | "editor" | "viewer"; authVersion: number }, sessionId: string) => `${user.id}:${user.authVersion}:${sessionId}`;
  const roleUser = { id: userId, email: "lifecycle-a@example.invalid", role: "editor" as const, authVersion: 0 };

  async function createUser(id: string, email: string) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, auth_version) VALUES (${id}::uuid, ${email}, 'pw-hash', 'editor', 0) ON CONFLICT (id) DO NOTHING`);
  }
  async function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }
  async function waitForBlockedBackend(client: InstanceType<typeof Client>, queryPattern: string, blockerPid: number, label: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await client.query(`SELECT pid, query, wait_event_type, pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND query ILIKE $1`, [queryPattern]);
      const exact = rows.find((row: { blockers: number[] }) => row.blockers.map(Number).includes(blockerPid));
      if (exact) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${label} blocked by backend pid ${blockerPid}`);
  }
  async function waitForBackendPid(client: InstanceType<typeof Client>, where: string, label: string): Promise<number> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await client.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ${where}`);
      if (rows[0]) return Number(rows[0].pid);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out identifying exact PostgreSQL ${label} backend`);
  }

  describe("persistent browser-session lifecycle (verified disposable PostgreSQL)", () => {
    beforeAll(async () => {
      const { rows } = await db.execute(sql`SELECT current_database() AS db, current_user AS role`);
      expect(rows[0]).toMatchObject({ db: "sdm_lifecycle_test", role: "sdm_lifecycle_test" });
      await createUser(userId, "lifecycle-a@example.invalid");
      await createUser(userB, "lifecycle-b@example.invalid");
    });
    beforeEach(async () => {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userB));
      await db.execute(sql`DELETE FROM browser_sessions WHERE user_id IN (${userId}::uuid, ${userB}::uuid)`);
      await db.update(users).set({ authVersion: 0, role: "editor", passwordHash: "pw-hash" }).where(eq(users.id, userId));
      await db.update(users).set({ authVersion: 0, role: "editor", passwordHash: "pw-hash" }).where(eq(users.id, userB));
    });
    afterAll(async () => {
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, userB));
    });

    it("preserves family identity; stale consumed-token logout revokes one family, not sibling or other-user sessions", async () => {
      const a0 = token("a0"), aSibling0 = token("a-sibling0"), b0 = token("b0");
      const issuedA = await issuePersistentBrowserSession(userId, "pw-hash", a0, async (u, s) => identity(u, s));
      const issuedSibling = await issuePersistentBrowserSession(userId, "pw-hash", aSibling0, async (u, s) => identity(u, s));
      const issuedB = await issuePersistentBrowserSession(userB, "pw-hash", b0, async (u, s) => identity(u, s));
      expect(issuedA).not.toBeNull(); expect(issuedSibling).not.toBeNull(); expect(issuedB).not.toBeNull();
      const a1 = token("a1");
      const rotated = await rotatePersistentBrowserRefresh(a0.hash, a1, async (u, s) => identity(u, s));
      expect(a1.expiresAt.getTime()).toBeGreaterThan(a0.expiresAt.getTime());
      expect((await db.execute(sql`SELECT (extract(epoch from expires_at) * 1000)::bigint AS expiry_ms FROM browser_sessions WHERE id = ${issuedA!.sessionId}::uuid`)).rows[0].expiry_ms)
        .toBe(String(a1.expiresAt.getTime()));
      expect(rotated?.sessionId).toBe(issuedA?.sessionId);
      expect(rotated?.accessToken).toBe(identity(roleUser, issuedA!.sessionId));
      expect(await revokePersistentBrowserSession(a0.hash)).toBe(true);
      expect(await rotatePersistentBrowserRefresh(a1.hash, token("a2"), async (u, s) => identity(u, s))).toBeNull();
      expect(await isPersistentBrowserSessionActive(userId, issuedA!.sessionId, 0)).toBe(false);
      expect(await isPersistentBrowserSessionActive(userId, issuedSibling!.sessionId, 0)).toBe(true);
      expect(await isPersistentBrowserSessionActive(userB, issuedB!.sessionId, 0)).toBe(true);
      const sibling1 = token("a-sibling1");
      expect(await rotatePersistentBrowserRefresh(aSibling0.hash, sibling1, async (_u, s) => s)).not.toBeNull();
      expect(await revokePersistentBrowserSession(a0.hash)).toBe(true);
    });

    it("rolls back refresh consumption and replacement when issuance fails", async () => {
      const original = token("issuer-rollback-original");
      const issued = await issuePersistentBrowserSession(userId, "pw-hash", original, async (_u, s) => s);
      const replacement = token("issuer-rollback-successor");
      await expect(rotatePersistentBrowserRefresh(original.hash, replacement, async () => { throw new Error("synthetic issuer failure"); })).rejects.toThrow("synthetic issuer failure");
      const { rows } = await db.execute(sql`SELECT token_hash, revoked_at FROM refresh_tokens WHERE session_id = ${issued!.sessionId}::uuid ORDER BY created_at`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ token_hash: original.hash, revoked_at: null });
      expect(await rotatePersistentBrowserRefresh(original.hash, replacement, async (_u, s) => s)).not.toBeNull();
    });

    it("rolls back refresh consumption when replacement insertion fails", async () => {
      const original = token("replacement-rollback-original");
      const issued = await issuePersistentBrowserSession(userId, "pw-hash", original, async (_u, s) => s);
      const collision = token("replacement-rollback-collision");
      await issuePersistentBrowserSession(userId, "pw-hash", collision, async (_u, s) => s);
      await expect(rotatePersistentBrowserRefresh(original.hash, collision, async (_u, s) => s)).rejects.toThrow();
      const { rows } = await db.execute(sql`SELECT token_hash, revoked_at FROM refresh_tokens WHERE session_id = ${issued!.sessionId}::uuid`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ token_hash: original.hash, revoked_at: null });
      expect(await rotatePersistentBrowserRefresh(original.hash, token("replacement-rollback-retry"), async (_u, s) => s)).not.toBeNull();
    });

    it("forces overlapping refresh-first lock acquisition before family logout", async () => {
      const a0 = token("race-refresh-first");
      const issued = await issuePersistentBrowserSession(userId, "pw-hash", a0, async (_u, s) => s);
      let entered!: () => void, release!: () => void;
      const inIssuanceCallback = new Promise<void>((r) => { entered = r; });
      const gate = new Promise<void>((r) => { release = r; });
      const replacement = token("race-refresh-first-next");
      const observer = new Client({ connectionString: verifiedUrl }); await observer.connect();
      let rotation: Promise<{ sessionId: string; accessToken: string; refreshToken: string } | null> | undefined;
      let logout: Promise<boolean> | undefined;
      try {
        rotation = rotatePersistentBrowserRefresh(a0.hash, replacement, async (_u, s) => { entered(); await gate; return s; });
        await withDeadline(inIssuanceCallback, "refresh issuer callback");
        const refreshPid = await waitForBackendPid(observer, `state='idle in transaction' AND query ILIKE '%insert into%refresh_tokens%'`, "refresh");
        logout = revokePersistentBrowserSession(a0.hash);
        await waitForBlockedBackend(observer, '%from%users%for update%', refreshPid, "logout user-row waiter");
        release();
        expect(await rotation).not.toBeNull();
        expect(await logout).toBe(true);
        expect(await rotatePersistentBrowserRefresh(replacement.hash, token("race-refresh-first-last"), async (_u, s) => s)).toBeNull();
        expect(await isPersistentBrowserSessionActive(userId, issued!.sessionId, 0)).toBe(false);
      } finally {
        release();
        if (rotation || logout) await withDeadline(Promise.allSettled([rotation, logout].filter(Boolean) as Promise<unknown>[]).then(() => undefined), "pending refresh-first transactions").catch(() => undefined);
        await observer.end();
      }
    });

    it("forces overlapping logout-first lock acquisition before refresh", async () => {
      const a0 = token("race-logout-first");
      const issued = await issuePersistentBrowserSession(userId, "pw-hash", a0, async (_u, s) => s);
      const blocker = new Client({ connectionString: verifiedUrl });
      const observer = new Client({ connectionString: verifiedUrl });
      await blocker.connect(); await observer.connect();
      const lockKey = 77123456789;
      let blockerHeld = false;
      let logout: Promise<boolean> | undefined, rotation: Promise<{ sessionId: string; accessToken: string; refreshToken: string } | null> | undefined;
      try {
        await blocker.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]); blockerHeld = true;
        const advisoryHolderPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION sdm_lifecycle_logout_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lockKey}::bigint); RETURN NEW; END $$`));
        await db.execute(sql.raw("CREATE TRIGGER sdm_lifecycle_logout_barrier BEFORE UPDATE OF revoked_at ON browser_sessions FOR EACH ROW WHEN (NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION sdm_lifecycle_logout_barrier()"));
        logout = revokePersistentBrowserSession(a0.hash);
        const logoutPid = await waitForBackendPid(observer, `wait_event='advisory' AND query ILIKE '%update%browser_sessions%'`, "logout");
        expect(logoutPid).not.toBe(advisoryHolderPid);
        const replacement = token("race-logout-first-next");
        rotation = rotatePersistentBrowserRefresh(a0.hash, replacement, async (_u, s) => s);
        await waitForBlockedBackend(observer, '%from%users%for update%', logoutPid, "refresh user-row waiter behind logout");
        await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]); blockerHeld = false;
        expect(await logout).toBe(true);
        expect(await rotation).toBeNull();
        expect(await isPersistentBrowserSessionActive(userId, issued!.sessionId, 0)).toBe(false);
      } finally {
        if (blockerHeld) await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
        if (logout || rotation) await Promise.race([Promise.allSettled([logout, rotation].filter(Boolean) as Promise<unknown>[]), new Promise((resolve) => setTimeout(resolve, 5_000))]);
        await db.execute(sql`DROP TRIGGER IF EXISTS sdm_lifecycle_logout_barrier ON browser_sessions`);
        await db.execute(sql`DROP FUNCTION IF EXISTS sdm_lifecycle_logout_barrier()`);
        await observer.end(); await blocker.end();
      }
    });

    it("rejects malformed, absent and expired credentials without touching another user's session", async () => {
      const a = token("input-a"), b = token("input-b");
      const ia = await issuePersistentBrowserSession(userId, "pw-hash", a, async (_u, s) => s);
      const ib = await issuePersistentBrowserSession(userB, "pw-hash", b, async (_u, s) => s);
      expect(await revokePersistentBrowserSession("malformed")).toBe(false);
      expect(await revokePersistentBrowserSession(createHash("sha256").update("missing-hash").digest("hex"))).toBe(false);
      expect(await isPersistentBrowserSessionActive(userB, ib!.sessionId, 0)).toBe(true);
      expect(await isPersistentBrowserSessionActive(userId, ia!.sessionId, 0)).toBe(true);
      expect(await issuePersistentBrowserSession(userId, "stale-password-hash", token("stale-password"), async (_u: BrowserSessionUser, s: string) => s)).toBeNull();
      const expired = token("expired"); expired.expiresAt = new Date(Date.now() - 1000);
      expect(await issuePersistentBrowserSession(userId, "pw-hash", expired, async (_u, s) => s)).toBeNull();
      await db.execute(sql`UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = ${a.hash}`);
      expect(await revokePersistentBrowserSession(a.hash)).toBe(false);
      expect(await isPersistentBrowserSessionActive(userId, ia!.sessionId, 0)).toBe(true);
    });

    it("does not report success when storage fails during family revocation", async () => {
      const issued = await issuePersistentBrowserSession(userId, "pw-hash", token("storage-failure"), async (_u, s) => s);
      await db.execute(sql`CREATE OR REPLACE FUNCTION sdm_lifecycle_test_fail_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic storage failure'; END $$`);
      await db.execute(sql`CREATE TRIGGER sdm_lifecycle_test_fail_revoke BEFORE UPDATE ON browser_sessions FOR EACH ROW EXECUTE FUNCTION sdm_lifecycle_test_fail_revoke()`);
      try { await expect(revokePersistentBrowserSession(token("storage-failure").hash)).rejects.toThrow(); }
      finally {
        await db.execute(sql`DROP TRIGGER IF EXISTS sdm_lifecycle_test_fail_revoke ON browser_sessions`);
        await db.execute(sql`DROP FUNCTION IF EXISTS sdm_lifecycle_test_fail_revoke()`);
      }
      expect(await isPersistentBrowserSessionActive(userId, issued!.sessionId, 0)).toBe(true);
    });

    it("fails closed for deleted, invalid-role, changed-version, revoked and expired sessions", async () => {
      const a = await issuePersistentBrowserSession(userId, "pw-hash", token("deny-a"), async (_u, s) => s);
      expect(await isPersistentBrowserSessionActive(userId, a!.sessionId, 0)).toBe(true);
      await db.update(users).set({ authVersion: 1 }).where(eq(users.id, userId));
      expect(await isPersistentBrowserSessionActive(userId, a!.sessionId, 0)).toBe(false);
      await db.update(users).set({ authVersion: 0, role: "bogus" as "viewer" }).where(eq(users.id, userId));
      expect(await isPersistentBrowserSessionActive(userId, a!.sessionId, 0)).toBe(false);
      await db.update(users).set({ role: "editor" }).where(eq(users.id, userId));
      const deleteTarget = await issuePersistentBrowserSession(userId, "pw-hash", token("delete-user"), async (_u, s) => s);
      expect(await isPersistentBrowserSessionActive(userId, deleteTarget!.sessionId, 0)).toBe(true);
      await db.execute(sql`UPDATE browser_sessions SET expires_at = now() - interval '1 second' WHERE id = ${a!.sessionId}::uuid`);
      expect(await isPersistentBrowserSessionActive(userId, a!.sessionId, 0)).toBe(false);
      await db.execute(sql`UPDATE browser_sessions SET expires_at = now() + interval '1 hour', revoked_at = now() WHERE id = ${a!.sessionId}::uuid`);
      expect(await isPersistentBrowserSessionActive(userId, a!.sessionId, 0)).toBe(false);
      await db.delete(users).where(eq(users.id, userId));
      expect(await isPersistentBrowserSessionActive(userId, deleteTarget!.sessionId, 0)).toBe(false);
    });
  });
}
