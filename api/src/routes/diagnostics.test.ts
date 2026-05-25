import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { diagnosticsRoutes } from "./diagnostics.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import { plumberClient } from "../services/plumber.js";
import { db } from "../db/index.js";

type MockContext = {
  set: (key: string, value: unknown) => void;
  json: (body: unknown, status?: number) => Response;
};

type MockNext = () => Promise<void>;

type MockReturnValueOnce = {
  mockReturnValueOnce: (value: unknown) => unknown;
};

type MockMiddleware = {
  mockImplementation: (fn: (c: MockContext, next: MockNext) => Promise<Response | void> | Response | void) => unknown;
};

vi.mock("../middleware/rate-limit", () => ({
  defaultRateLimit: vi.fn(async (_c: MockContext, next: MockNext) => {
    await next();
  }),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: MockContext, next: MockNext) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
}));

vi.mock("../services/access", () => ({
  getUserProjectIds: vi.fn(async () => ["proj-1"]),
}));

vi.mock("../services/plumber", () => ({
  plumberClient: {
    getDiagnosticsVif: vi.fn(),
    getDiagnosticsResponseCurves: vi.fn(),
    getDiagnosticsImportance: vi.fn(),
    getDiagnosticsCbi: vi.fn(),
    getDiagnosticsMess: vi.fn(),
    getDiagnosticsSummary: vi.fn(),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

const app = new Hono();
app.route("/api/v1/diagnostics", diagnosticsRoutes);

function mockRunLookup(result: unknown[]) {
  (db.select as unknown as MockReturnValueOnce).mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(result)),
      })),
    })),
  });
}

describe("diagnostics routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authMiddleware as unknown as MockMiddleware).mockImplementation(async (c, next) => {
      c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
      await next();
    });
    vi.mocked(getUserProjectIds).mockResolvedValue(["proj-1"]);
  });

  it("returns 401 when auth is missing", async () => {
    (authMiddleware as unknown as MockMiddleware).mockImplementation(async (c) => c.json({ error: "Unauthorized" }, 401));

    const res = await app.request("/api/v1/diagnostics/vif/run-123");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(plumberClient.getDiagnosticsVif).not.toHaveBeenCalled();
  });

  it("returns 404 and does not proxy when the run is not visible", async () => {
    mockRunLookup([]);

    const res = await app.request("/api/v1/diagnostics/vif/run-hidden");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Run not found" });
    expect(plumberClient.getDiagnosticsVif).not.toHaveBeenCalled();
  });

  it("returns 404 without querying Plumber when the user has no visible projects", async () => {
    vi.mocked(getUserProjectIds).mockResolvedValue([]);

    const res = await app.request("/api/v1/diagnostics/vif/run-123");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Run not found" });
    expect(db.select).not.toHaveBeenCalled();
    expect(plumberClient.getDiagnosticsVif).not.toHaveBeenCalled();
  });

  it("proxies VIF diagnostics for an authorized visible run", async () => {
    const payload = { run_id: "run-123", vif: [{ variable: "bio1", vif: 2.1 }] };
    mockRunLookup([{ id: "run-123" }]);
    vi.mocked(plumberClient.getDiagnosticsVif).mockResolvedValue(payload);

    const res = await app.request("/api/v1/diagnostics/vif/run-123");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(plumberClient.getDiagnosticsVif).toHaveBeenCalledWith("run-123");
  });

  it("uses the same visibility guard for summary diagnostics", async () => {
    const payload = { run_id: "run-123", ok: true };
    mockRunLookup([{ id: "run-123" }]);
    vi.mocked(plumberClient.getDiagnosticsSummary).mockResolvedValue(payload);

    const res = await app.request("/api/v1/diagnostics/summary/run-123");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(plumberClient.getDiagnosticsSummary).toHaveBeenCalledWith("run-123");
  });
});
