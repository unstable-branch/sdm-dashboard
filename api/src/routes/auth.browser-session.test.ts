import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createHmac } from "crypto";

const state = vi.hoisted(() => ({
  issueBrowserSession: vi.fn(),
  issuePersistentBrowserSession: vi.fn(),
  rotatePersistentBrowserRefresh: vi.fn(),
  revokePersistentBrowserSession: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeBrowserSession: vi.fn(),
  invalidateBrowserSessions: vi.fn(),
  select: vi.fn(),
}));

vi.mock("bcrypt", () => ({ hash: vi.fn(async () => "password-hash"), compare: vi.fn(async () => true) }));
vi.mock("ioredis", () => ({ default: class { on = vi.fn(); connect = vi.fn(async () => undefined); get status() { return "ready"; } zremrangebyscore = vi.fn(async () => 0); zcard = vi.fn(async () => 0); zadd = vi.fn(async () => 1); expire = vi.fn(async () => 1); } }));
vi.mock("../db/index.js", () => ({ db: {
  select: state.select,
  insert: vi.fn(() => ({ values: vi.fn(() => ({
    returning: vi.fn(async () => [{ id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer", passwordHash: "password-hash" }]),
    onConflictDoNothing: vi.fn(async () => undefined),
  })) })),
  update: vi.fn(),
} }));
vi.mock("../services/sessions.js", () => ({
  consumePasswordReset: vi.fn(), invalidateBrowserSessions: state.invalidateBrowserSessions,
  issueBrowserSession: state.issueBrowserSession, rotateRefreshToken: state.rotateRefreshToken,
  revokeBrowserSession: state.revokeBrowserSession, updatePasswordAndInvalidate: vi.fn(),
}));
vi.mock("../services/browser-session-lifecycle.js", () => ({
  issuePersistentBrowserSession: state.issuePersistentBrowserSession,
  rotatePersistentBrowserRefresh: state.rotatePersistentBrowserRefresh,
  revokePersistentBrowserSession: state.revokePersistentBrowserSession,
  isPersistentBrowserSessionActive: vi.fn(),
}));
vi.mock("../middleware/auth.js", () => ({ authMiddleware: vi.fn(async (c: any, next: any) => { c.set("user", { id: "user-1", email: "browser@example.test", role: "viewer" }); await next(); }) }));
vi.mock("../services/audit.js", () => ({ logAction: vi.fn(async () => undefined), extractClientInfo: vi.fn(() => ({})) }));

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.FRONTEND_URL = "https://dashboard.example.test:8443";

const { authRoutes } = await import("./auth.js");
const app = new Hono();
app.route("/api/v1/auth", authRoutes);
const allowedOrigin = "https://dashboard.example.test:8443";
const issued = { user: { id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer", authVersion: 0 }, accessToken: "access-token", refreshToken: "refresh-token" };
function browserRefreshToken(rememberMe = true) {
  const entropy = "a".repeat(64);
  const persistence = rememberMe ? "p" : "s";
  const proof = createHmac("sha256", "test-secret").update(`${entropy}.${persistence}`).digest("hex");
  return `${entropy}.${persistence}.${proof}`;
}

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: allowedOrigin, ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.issueBrowserSession.mockResolvedValue(issued);
  state.issuePersistentBrowserSession.mockResolvedValue({ ...issued, sessionId: "22222222-2222-4222-8222-222222222222" });
  state.rotatePersistentBrowserRefresh.mockResolvedValue({ accessToken: "rotated-access", refreshToken: "rotated-refresh", sessionId: "22222222-2222-4222-8222-222222222222" });
  state.revokePersistentBrowserSession.mockResolvedValue(true);
  state.rotateRefreshToken.mockResolvedValue({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
  state.revokeBrowserSession.mockResolvedValue(true);
  state.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer", authVersion: 0, passwordHash: "password-hash" }] }) }) });
});

describe("browser session refresh contract", () => {
  it("rejects browser login before credential lookup when Origin is not an exact allowlist match", async () => {
    const response = await request("login", { browser_session: true, remember_me: true, email: "browser@example.test", password: "Password123" }, { Origin: "https://dashboard.example.test" });
    expect(response.status).toBe(403);
    expect(state.select).not.toHaveBeenCalled();
    expect(state.issueBrowserSession).not.toHaveBeenCalled();
  });

  it("issues login access and refresh cookies without exposing browser refresh credentials in JSON", async () => {
    const response = await request("login", { browser_session: true, remember_me: true, email: "browser@example.test", password: "Password123" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ user: { id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer" } });
    expect(data).not.toHaveProperty("token");
    expect(data).not.toHaveProperty("refresh_token");
    expect(state.issuePersistentBrowserSession).toHaveBeenCalledOnce();
    expect(state.issueBrowserSession).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^sdm_token=access-token; Path=\/; HttpOnly; SameSite=Strict; Max-Age=900$/),
      expect.stringMatching(/^sdm_refresh_token=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/),
    ]));
  });

  it("registers browser sessions using the same cookie-only refresh contract", async () => {
    state.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    const response = await request("register", { browser_session: true, remember_me: false, email: "browser@example.test", password: "Password123", name: "Browser" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer" } });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((cookie) => cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict"))).toBe(true);
    expect(cookies.every((cookie) => !cookie.includes("Max-Age="))).toBe(true);
  });

  it("rejects missing, malformed, or non-allowlisted browser origins before session work", async () => {
    for (const origin of [undefined, "null", "https://dashboard.example.test", "https://dashboard.example.test:8443.evil.test", "not-an-origin"]) {
      const headers = origin === undefined ? { Origin: "" } : { Origin: origin };
      const response = await request("refresh", { browser_session: true }, headers);
      expect(response.status).toBe(403);
    }
    expect(state.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("refreshes only from the browser refresh cookie and rotates both cookies", async () => {
    const response = await request("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${browserRefreshToken()}` });
    expect(response.status).toBe(200);
    expect(state.rotatePersistentBrowserRefresh).toHaveBeenCalledOnce();
    expect(state.rotateRefreshToken).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^sdm_token=rotated-access; Path=\/; HttpOnly; SameSite=Strict; Max-Age=900$/),
      expect.stringMatching(/^sdm_refresh_token=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/),
    ]));
    expect(await response.json()).toEqual({ ok: true });
  });

  it("does not fall back to an explicit body token when browser-cookie refresh is selected", async () => {
    const response = await request("refresh", { browser_session: true, refresh_token: "body-token" });
    expect(response.status).toBe(401);
    expect(state.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("does not accept a valid browser credential through the non-browser body exchange", async () => {
    const response = await request("refresh", { refresh_token: browserRefreshToken() });
    expect(response.status).toBe(401);
    expect(state.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("uses session persistence when remember_me is false and carries that choice through rotation", async () => {
    const initial = browserRefreshToken(false);
    const response = await request("refresh", { browser_session: true, remember_me: true }, { Cookie: `sdm_refresh_token=${initial}` });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    const refreshCookie = cookies.find((value) => value.startsWith("sdm_refresh_token="));
    const accessCookie = cookies.find((value) => value.startsWith("sdm_token="));
    expect(refreshCookie).toBeDefined();
    expect(accessCookie).toBeDefined();
    expect(refreshCookie).not.toContain("Max-Age=");
    expect(accessCookie).not.toContain("Max-Age=");
    const replacement = state.rotatePersistentBrowserRefresh.mock.calls[0][1];
    expect(replacement.raw).toMatch(/^[a-f0-9]{64}\.s\.[a-f0-9]{64}$/);
  });

  it("rejects consumed or invalid server-side refresh sessions without issuing replacement cookies", async () => {
    state.rotatePersistentBrowserRefresh.mockResolvedValueOnce(null);
    const response = await request("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${browserRefreshToken()}` });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("uses Secure __Host cookies in production regardless of forwarded HTTP headers", async () => {
    process.env.NODE_ENV = "production";
    try {
      const response = await request("login", { browser_session: true, remember_me: false, email: "browser@example.test", password: "Password123" }, { "X-Forwarded-Proto": "http", "X-Forwarded-Host": "attacker.invalid" });
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      expect(cookies.every((cookie) => cookie.includes("; Secure") && cookie.includes("; Path=/") && cookie.includes("; HttpOnly") && cookie.includes("SameSite=Strict"))).toBe(true);
      expect(cookies.map((cookie) => cookie.split("=", 1)[0])).toEqual(["__Host-sdm_token", "__Host-sdm_refresh_token"]);
      expect(cookies.every((cookie) => !/;\s*Domain=/i.test(cookie))).toBe(true);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("requires the __Host refresh cookie name in production", async () => {
    process.env.NODE_ENV = "production";
    try {
      const insecureName = await request("refresh", { browser_session: true }, { Cookie: `sdm_refresh_token=${browserRefreshToken()}` });
      expect(insecureName.status).toBe(401);
      expect(state.rotateRefreshToken).not.toHaveBeenCalled();
      const secureName = await request("refresh", { browser_session: true }, { Cookie: `__Host-sdm_refresh_token=${browserRefreshToken()}` });
      expect(secureName.status).toBe(200);
      expect(secureName.headers.getSetCookie().every((cookie) => cookie.startsWith("__Host-") && cookie.includes("; Secure"))).toBe(true);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("requires exact origin and rejects API-key bypass for browser logout", async () => {
    const denied = await request("logout", { browser_session: true }, { Origin: "https://dashboard.example.test", "X-API-Key": "forged-key" });
    expect(denied.status).toBe(403);
    expect(state.revokeBrowserSession).not.toHaveBeenCalled();
  });

  it("revokes only the signed refresh cookie even without an access JWT and clears both cookies", async () => {
    const refresh = browserRefreshToken();
    const response = await request("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${refresh}` });
    expect(response.status).toBe(200);
    expect(state.revokePersistentBrowserSession).toHaveBeenCalledWith(expect.any(String));
    expect(state.revokeBrowserSession).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^sdm_token=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/),
      expect.stringMatching(/^sdm_refresh_token=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/),
    ]));
    expect(await response.json()).toEqual({ ok: true });
  });

  it("does not report logout success for absent credentials or storage failure", async () => {
    const missing = await request("logout", { browser_session: true });
    expect(missing.status).toBe(401);
    expect(state.revokePersistentBrowserSession).not.toHaveBeenCalled();

    state.revokePersistentBrowserSession.mockRejectedValueOnce(new Error("database unavailable"));
    const outage = await request("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${browserRefreshToken()}` });
    expect(outage.status).toBe(503);
    expect(outage.headers.getSetCookie()).toHaveLength(0);
    expect(await outage.json()).toEqual({ error: "Authentication service unavailable" });
  });

  it("refuses bearer/API-key selected logout authority", async () => {
    const cases: Record<string, string>[] = [
      { "X-API-Key": "synthetic-api-key" },
      { Authorization: "Bearer synthetic-bearer" },
    ];
    for (const headers of cases) {
      const response = await request("logout", { browser_session: true }, { Cookie: `sdm_refresh_token=${browserRefreshToken()}`, ...headers });
      expect(response.status).toBe(403);
    }
    expect(state.revokePersistentBrowserSession).not.toHaveBeenCalled();
  });

  it("preserves legacy non-browser registration credential exchange", async () => {
    state.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    const response = await request("register", { email: "browser@example.test", password: "Password123", name: "Browser" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer" },
      token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it("preserves legacy non-browser login credential exchange", async () => {
    const response = await request("login", { email: "browser@example.test", password: "Password123" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "user-1", email: "browser@example.test", name: "Browser", role: "viewer" },
      token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it("preserves the existing non-browser body exchange contract", async () => {
    const response = await request("refresh", { refresh_token: "legacy-body-token" });
    expect(response.status).toBe(200);
    expect(state.rotateRefreshToken).toHaveBeenCalledOnce();
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await response.json()).toEqual({ token: "rotated-access", refresh_token: "rotated-refresh" });
  });
});
