import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runsByJobId: { "run-uuid-001": { id: "run-uuid-001" } },
  runsById: { "00000000-0000-0000-0000-000000000001": { id: "00000000-0000-0000-0000-000000000001" } },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (n: number) => {
            const r = mocks.runsByJobId as Record<string, unknown>;
            const rid = mocks.runsById as Record<string, unknown>;
            const all = { ...r, ...rid };
            return Object.values(all).slice(0, n);
          }),
        })),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => {
  const mk = (name: string) => ({ _name: name });
  return {
    projectMembers: mk("project_members"),
    projects: mk("projects"),
    runs: mk("runs"),
  };
});

vi.mock("./queue.js", () => ({
  getSharedRedis: vi.fn(() => null),
}));

import { isUuid } from "./access.js";

describe("GC-06: access helpers", () => {
  it("isUuid recognizes UUIDs and rejects Plumber job ids", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000001")).toBe(true);
    expect(isUuid("run-20240101120000-0001")).toBe(false);
    expect(isUuid("cov_20240101_zyxw98")).toBe(false);
    expect(isUuid("climate_20240101_abcd12")).toBe(false);
  });
});
