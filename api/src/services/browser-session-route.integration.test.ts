import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { verifyRouteDatabaseOptIn } from "./browser-session-route-guard.js";
import { createHash, createHmac } from "node:crypto";
import { Hono } from "hono";
import { sign } from "hono/jwt";

vi.mock("../middleware/rate-limit.js", () => ({ rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock("../services/audit.js", () => ({ logAction: vi.fn(async () => undefined), extractClientInfo: vi.fn(() => ({})) }));

const databaseUrl = process.env.SDM_BROWSER_SESSION_TEST_DATABASE_URL;
const containerId = process.env.SDM_BROWSER_SESSION_TEST_CONTAINER_ID;
let db: typeof import("../db/index.js").db;
let users: typeof import("../db/schema.js").users;
let authRoutes: typeof import("../routes/auth.js").authRoutes;
let verifyCurrentJwt: typeof import("./auth-principal.js").verifyCurrentJwt;
let verifyCurrentApiKey: typeof import("./auth-principal.js").verifyCurrentApiKey;
let apiKeys: typeof import("../db/schema.js").apiKeys;
let eq: typeof import("drizzle-orm").eq;
let sql: typeof import("drizzle-orm").sql;
let hash: typeof import("bcrypt").hash;
let app: Hono;
const origin = "https://route-proof.example.test";
const ids = { a: "30000000-0000-4000-8000-000000000001", b: "30000000-0000-4000-8000-000000000002" };
const email = { a: "route-a@example.invalid", b: "route-b@example.invalid" };
const password = "Synthetic-Route-Password-2026";

function verifyOptInBeforeDbImport(): string {
  const verifiedUrl = verifyRouteDatabaseOptIn({
    databaseUrl,
    containerId,
    inheritedDatabaseUrl: process.env.DATABASE_URL,
    inspect: (immutableContainerId) => JSON.parse(execFileSync("docker", ["inspect", immutableContainerId], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }))[0],
  });
  if (!verifiedUrl) throw new Error("explicit disposable route-test opt-in is incomplete");
  return verifiedUrl;
}

const optedIn = databaseUrl !== undefined || containerId !== undefined;
if (!optedIn) {
  describe.skip("persistent browser auth through Hono and real PostgreSQL (explicit opt-in required)", () => {
    it("is enabled only by the guarded disposable PostgreSQL harness", () => {});
  });
} else {
  const verifiedUrl = verifyOptInBeforeDbImport();
  process.env.DATABASE_URL = verifiedUrl;
  process.env.JWT_SECRET = "synthetic-route-proof-secret-not-for-production";
  process.env.JWT_ISSUER = "sdm-dashboard";
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = origin;

  beforeAll(async () => {
    [{ db }, { users, apiKeys }, { authRoutes }, { verifyCurrentJwt, verifyCurrentApiKey }, { eq, sql }, { hash }] = await Promise.all([
      import("../db/index.js"), import("../db/schema.js"), import("../routes/auth.js"),
      import("./auth-principal.js"), import("drizzle-orm"), import("bcrypt"),
    ]);
    app = new Hono();
    app.route("/api/v1/auth", authRoutes);
    await db.execute(sql.raw(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS name varchar(255), ADD COLUMN IF NOT EXISTS avatar_url text,
      ADD COLUMN IF NOT EXISTS bio text, ADD COLUMN IF NOT EXISTS organization text,
      ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint DEFAULT 1073741824,
      ADD COLUMN IF NOT EXISTS storage_used_bytes bigint DEFAULT 0, ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
      ADD COLUMN IF NOT EXISTS reset_token text, ADD COLUMN IF NOT EXISTS reset_token_expiry timestamptz,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`));
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS api_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL, key_preview varchar(16),
      name varchar(255) NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope_project_id uuid, last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz)`));
  });

  const cookie = (headers: Headers, name: string) => headers.getSetCookie().find((v) => v.startsWith(`${name}=`))?.split(";", 1)[0].slice(name.length + 1);
  const call = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(`/api/v1/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body),
  });

  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, email.a));
    await db.delete(users).where(eq(users.email, email.b));
    const passwordHash = await hash(password, 4);
    await db.insert(users).values([
      { id: ids.a, email: email.a, passwordHash, name: "A", role: "viewer", authVersion: 0 },
      { id: ids.b, email: email.b, passwordHash, name: "B", role: "editor", authVersion: 0 },
    ]);
    await db.insert(apiKeys).values({ keyHash: createHash("sha256").update("synthetic-api-key-route-proof").digest("hex"), name: "synthetic route proof", userId: ids.a });
  });

  afterAll(async () => {
    if (db && users) {
      await db.delete(users).where(eq(users.email, email.a));
      await db.delete(users).where(eq(users.email, email.b));
    }
  });

  describe("persistent browser auth through Hono and real PostgreSQL", () => {
    it("rotates A, logs out via consumed A0 without access JWT, and preserves sibling B", async () => {
      const loginA = await call("login", { browser_session: true, remember_me: true, email: email.a, password });
      const loginB = await call("login", { browser_session: true, remember_me: true, email: email.b, password });
      expect(loginA.status, await loginA.clone().text()).toBe(200);
      expect(loginB.status).toBe(200);
      const a0 = cookie(loginA.headers, "sdm_refresh_token")!;
      const jwtA = cookie(loginA.headers, "sdm_token")!;
      const b0 = cookie(loginB.headers, "sdm_refresh_token")!;
      const jwtB = cookie(loginB.headers, "sdm_token")!;
      const apiKeyPrincipal = await verifyCurrentApiKey("synthetic-api-key-route-proof");
      expect(apiKeyPrincipal).toMatchObject({ id: ids.a, source: "api-key" });
      await db.update(users).set({ role: "viewer" }).where(eq(users.id, ids.b));
      expect(await verifyCurrentJwt(jwtB)).toMatchObject({ id: ids.b, role: "viewer" });
      await db.update(users).set({ role: "editor" }).where(eq(users.id, ids.b));
      await db.update(users).set({ authVersion: 1 }).where(eq(users.id, ids.b));
      expect(await verifyCurrentJwt(jwtB)).toBeNull();
      await db.update(users).set({ authVersion: 0 }).where(eq(users.id, ids.b));
      expect(await verifyCurrentJwt(jwtB)).toMatchObject({ id: ids.b, role: "editor" });
      expect(await loginA.json()).not.toHaveProperty("token");

      const refreshA = await call("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${a0}` });
      expect(refreshA.status).toBe(200);
      const a1 = cookie(refreshA.headers, "sdm_refresh_token")!;
      const jwtA1 = cookie(refreshA.headers, "sdm_token")!;
      const refreshB = await call("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${b0}` });
      expect(refreshB.status).toBe(200);

      expect(await verifyCurrentJwt(jwtA)).not.toBeNull();
      expect(await verifyCurrentJwt(jwtA1)).not.toBeNull();
      expect((await call("logout", { browser_session: true })).status).toBe(401);
      expect((await call("logout", { browser_session: true }, { Cookie: "sdm_refresh_token=malformed" })).status).toBe(401);
      expect((await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${b0}`, "X-API-Key": "synthetic-api-key-route-proof" })).status).toBe(403);
      expect((await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${b0}`, Origin: "https://foreign.example.test" })).status).toBe(403);
      expect(await verifyCurrentJwt(jwtB)).not.toBeNull();

      const expiredAccess = await sign({ sub: ids.a, iss: "sdm-dashboard", av: 0, exp: Math.floor(Date.now() / 1000) - 30 }, process.env.JWT_SECRET!);
      const logoutA = await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${a0}; sdm_token=${expiredAccess}` });
      expect(logoutA.status).toBe(200);
      expect(await verifyCurrentJwt(jwtA)).toBeNull();
      expect(await verifyCurrentJwt(jwtA1)).toBeNull();
      expect(await verifyCurrentApiKey("synthetic-api-key-route-proof")).toMatchObject({ id: ids.a, source: "api-key" });
      expect((await call("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${a1}` })).status).toBe(401);
      const bRefreshNext = cookie(refreshB.headers, "sdm_refresh_token")!;
      const b0Hash = createHmac("sha256", "synthetic-route-proof-secret-not-for-production").update(b0).digest("hex");
      const bRows = await db.execute(sql`SELECT token_hash = ${b0Hash} AS matches FROM refresh_tokens WHERE user_id = ${ids.b}::uuid`);
      expect(bRows.rows.map((row) => row.matches)).toContain(true);
      const expiredRows = await db.execute(sql`UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = ${b0Hash} RETURNING id`);
      expect(expiredRows.rows).toHaveLength(1);
      expect((await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${b0}` })).status).toBe(401);
      expect(await verifyCurrentJwt(jwtB)).toMatchObject({ id: ids.b, role: "editor" });

      await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION sdm_route_test_fail_logout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic route storage failure'; END $$`));
      await db.execute(sql.raw(`CREATE TRIGGER sdm_route_test_fail_logout BEFORE UPDATE OF revoked_at ON browser_sessions FOR EACH ROW EXECUTE FUNCTION sdm_route_test_fail_logout()`));
      try {
        const failedLogout = await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${bRefreshNext}` });
        expect(failedLogout.status).toBe(503);
        expect(failedLogout.headers.getSetCookie()).toHaveLength(0);
      } finally {
        await db.execute(sql.raw("DROP TRIGGER IF EXISTS sdm_route_test_fail_logout ON browser_sessions"));
        await db.execute(sql.raw("DROP FUNCTION IF EXISTS sdm_route_test_fail_logout()"));
      }
      expect(await verifyCurrentJwt(jwtB)).not.toBeNull();
      expect((await call("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${bRefreshNext}` })).status).toBe(200);

      expect((await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${a0}` })).status).toBe(200);
      expect((await call("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${bRefreshNext}`, "X-API-Key": "synthetic-api-key-route-proof" })).status).toBe(403);
      expect(await verifyCurrentJwt(jwtB)).not.toBeNull();
    });
  });
}
