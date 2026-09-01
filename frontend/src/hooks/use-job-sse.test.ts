import { describe, it, expect } from "vitest";
import { clearSharedJobs } from "./use-job-sse";

describe("clearSharedJobs", () => {
  it("is a callable exported function", () => {
    expect(typeof clearSharedJobs).toBe("function");
  });

  it("is idempotent (calling twice does not throw)", () => {
    expect(() => {
      clearSharedJobs();
      clearSharedJobs();
    }).not.toThrow();
  });

  it("can be called immediately after import without error", () => {
    expect(() => clearSharedJobs()).not.toThrow();
  });
});
