import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { ecologyRoutes } from "./ecology.js";
import { plumberClient } from "../services/plumber.js";
import { getUserProjectIds } from "../services/access.js";

type MockContext = {
  req: { header: (name: string) => string | undefined };
  set: (key: string, value: unknown) => void;
  json: (body: unknown, status?: number) => Response;
};

type MockNext = () => Promise<void>;

const mocks = vi.hoisted(() => ({
  runRows: [{ id: "run-visible" }],
  select: vi.fn(),
}));

function runSelectChain() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(mocks.runRows)),
      })),
    })),
  };
}

vi.mock("../db", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: MockContext, next: MockNext) => {
    if (c.req.header("Authorization") !== "Bearer test-token") {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
}));

vi.mock("../services/access", () => ({
  getUserProjectIds: vi.fn(async () => ["proj-1"]),
}));

vi.mock("../services/plumber", () => ({
  plumberClient: {
    getEcologyData: vi.fn(),
    getEooAoo: vi.fn(),
    getAoa: vi.fn(),
    getEcologyReport: vi.fn(),
  },
}));

describe("ecology routes", () => {
  const app = new Hono();
  app.route("/api/v1/ecology", ecologyRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runRows = [{ id: "run-visible" }];
    mocks.select.mockImplementation(() => runSelectChain());
    vi.mocked(getUserProjectIds).mockResolvedValue(["proj-1"]);
  });

  it("returns 401 when ecology data is requested without auth", async () => {
    const res = await app.request("/api/v1/ecology/run-visible");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getUserProjectIds).not.toHaveBeenCalled();
    expect(plumberClient.getEcologyData).not.toHaveBeenCalled();
  });

  it("returns 404 and does not proxy when the run is not visible", async () => {
    mocks.runRows = [];

    const res = await app.request("/api/v1/ecology/run-hidden/eoo-aoo", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Run not found" });
    expect(getUserProjectIds).toHaveBeenCalledWith({
      id: "user-1",
      email: "test@example.com",
      role: "viewer",
    });
    expect(plumberClient.getEooAoo).not.toHaveBeenCalled();
  });

  it("proxies ecology data for an authorized visible run", async () => {
    vi.mocked(plumberClient.getEcologyData).mockResolvedValueOnce({
      run_id: "run-visible",
      range_change: { suitable_area_km2: 123 },
    });

    const res = await app.request("/api/v1/ecology/run-visible", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      run_id: "run-visible",
      range_change: { suitable_area_km2: 123 },
    });
    expect(plumberClient.getEcologyData).toHaveBeenCalledWith("run-visible");
  });

  it("preserves the ecology report response shape for authorized visible runs", async () => {
    vi.mocked(plumberClient.getEcologyReport).mockResolvedValueOnce("report text");

    const res = await app.request("/api/v1/ecology/run-visible/report", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: "report text" });
    expect(plumberClient.getEcologyReport).toHaveBeenCalledWith("run-visible");
  });
});
