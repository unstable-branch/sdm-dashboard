import { describe, expect, it } from "vitest";
import * as payload from "./model-payload.js";

describe("canonical execution JSON", () => {
  it("uses lexical object keys and preserves scientific array order", () => {
    expect(payload).toHaveProperty("canonicalExecutionJson", expect.any(Function));
    const serialize = (payload as unknown as { canonicalExecutionJson: (value: unknown) => string }).canonicalExecutionJson;
    const input = { z: undefined, config: { "2": 2, "10": 10, cvFolds: 0, enabled: false,
      values: [null, "quoted\"\n", -0, 0.25, 1e-8] }, species: "Synthetic species" };
    const expected = '{"config":{"10":10,"2":2,"cvFolds":0,"enabled":false,"values":[null,"quoted\\\"\\n",0,0.25,1e-8]},"species":"Synthetic species"}';
    expect(serialize(input)).toBe(expected);
    expect(serialize({ species: input.species, config: input.config })).toBe(expected);
    expect(input.config.values).toEqual([null, "quoted\"\n", -0, 0.25, 1e-8]);
  });

  it.each([NaN, Infinity, -Infinity, undefined, 1n, Symbol("unsupported"),
    () => "unsupported", new Date(0), new Map(), [undefined], Array(1)])(
    "rejects non-JSON identity input %s instead of producing ambiguous bytes", (value: unknown) => {
      const serialize = (payload as unknown as { canonicalExecutionJson: (value: unknown) => string }).canonicalExecutionJson;
      expect(() => serialize(value)).toThrow("Invalid execution identity");
    },
  );

  it("rejects cyclic data without rejecting repeated acyclic references", () => {
    const serialize = (payload as unknown as { canonicalExecutionJson: (value: unknown) => string }).canonicalExecutionJson;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => serialize(cyclic)).toThrow("Invalid execution identity");
    const shared = { seed: 42 };
    expect(serialize({ second: shared, first: shared })).toBe('{"first":{"seed":42},"second":{"seed":42}}');
  });

  it("rejects executable getters without invoking them", () => {
    const serialize = (payload as unknown as { canonicalExecutionJson: (value: unknown) => string }).canonicalExecutionJson;
    let reads = 0;
    const input = Object.defineProperty({}, "seed", { enumerable: true, get() { reads++; return 42; } });
    expect(() => serialize(input)).toThrow("Invalid execution identity");
    expect(reads).toBe(0);
  });
});
