import { describe, expect, it } from "vitest";
import { jobDurationMs } from "./job-duration";

describe("job duration", () => {
  const start = "2026-10-11T06:21:20.618Z";
  const finish = "2026-10-11T06:22:26.541Z";
  it.each(["completed", "failed", "cancelled"])("uses recorded end time for reopened %s runs", (state) => {
    expect(jobDurationMs(state, start, finish, Date.parse("2026-10-11T18:00:00Z"))).toBe(65923);
    expect(jobDurationMs(state, start, finish, Date.parse("2026-10-12T18:00:00Z"))).toBe(65923);
    expect(jobDurationMs(state, start, undefined, Date.now())).toBeNull();
  });
  it("ticks only active runs", () => {
    expect(jobDurationMs("active", start, undefined, Date.parse(start) + 5000)).toBe(5000);
  });
  it("does not invent a duration from malformed or reversed timestamps", () => {
    expect(jobDurationMs("completed", start, "bad", Date.now())).toBeNull();
    expect(jobDurationMs("completed", finish, start, Date.now())).toBeNull();
    expect(jobDurationMs("active", undefined, undefined, Date.now())).toBeNull();
  });
});
