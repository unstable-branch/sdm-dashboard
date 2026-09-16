import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  canAccessRun: vi.fn(),
  postNicheOverlap: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
}));
vi.mock("../services/access.js", () => ({ canAccessRun: mocks.canAccessRun }));
vi.mock("../db/index.js", () => ({ db: { select: vi.fn() } }));
vi.mock("../db/schema.js", () => ({ runs: { id: "id", jobId: "jobId" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    withUser: vi.fn(() => ({ withRole: vi.fn(() => ({ postNicheOverlap: mocks.postNicheOverlap })) })),
  },
}));

import { ecologyRoutes } from "./ecology.js";

function app() {
  const root = new Hono();
  root.route("/ecology", ecologyRoutes);
  return root;
}

describe("niche-overlap authorization", () => {
  it("requires two source runs", async () => {
    const response = await app().request("/ecology/niche-overlap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id_1: "run-a" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.postNicheOverlap).not.toHaveBeenCalled();
  });

  it("denies when either source run is inaccessible", async () => {
    mocks.canAccessRun.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await app().request("/ecology/niche-overlap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id_1: "run-a", run_id_2: "run-b" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.canAccessRun).toHaveBeenCalledTimes(2);
    expect(mocks.postNicheOverlap).not.toHaveBeenCalled();
  });

  it("proxies only after both source runs are authorized", async () => {
    mocks.canAccessRun.mockResolvedValue(true);
    mocks.postNicheOverlap.mockResolvedValue({ ok: true });
    const response = await app().request("/ecology/niche-overlap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id_1: "run-a", run_id_2: "run-b" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.canAccessRun).toHaveBeenCalledWith("user-1", "viewer", "run-a");
    expect(mocks.canAccessRun).toHaveBeenCalledWith("user-1", "viewer", "run-b");
    expect(mocks.postNicheOverlap).toHaveBeenCalledTimes(1);
  });
});
