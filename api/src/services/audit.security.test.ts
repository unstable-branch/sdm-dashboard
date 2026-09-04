import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  executeResult: { count: 0 },
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({
      values: (rows: unknown) => {
        mocks.insertValues(rows);
        return Promise.resolve(undefined);
      },
    }),
    execute: vi.fn().mockResolvedValue(mocks.executeResult),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  relations: vi.fn(() => ({})),
}));

vi.mock("../middleware/client-ip.js", () => ({
  getClientIp: () => "127.0.0.1",
}));

import { logAction, shutdownAudit, startRetentionPrune } from "./audit.js";

describe("KK-02: audit_logs details size cap", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.insertValues.mockClear();
    mocks.executeResult.count = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("accepts small details under the 4 KB cap", async () => {
    await logAction({
      action: "test.small",
      details: { foo: "bar", n: 42 },
    });
    await new Promise((r) => setTimeout(r, 10));
    const emitted = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(emitted).toContain("test.small");
    expect(emitted).toContain("bar");
  });

  it("truncates details exceeding 4 KB and emits a warning", async () => {
    const huge = "x".repeat(8 * 1024);
    await logAction({
      action: "test.huge",
      details: { payload: huge },
    });
    await new Promise((r) => setTimeout(r, 10));
    const emitted = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(emitted).toContain("test.huge");
    expect(emitted).not.toContain("xxxxxxxx");
    expect(emitted).toContain("_truncated");
    const warns = warnSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(warns).toContain("Dropping oversized details");
  });
});

describe("KK-01: retention prune plumbing", () => {
  it("exports startRetentionPrune and shutdownAudit", () => {
    expect(typeof startRetentionPrune).toBe("function");
    expect(typeof shutdownAudit).toBe("function");
  });
});
