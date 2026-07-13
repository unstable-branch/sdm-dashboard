import { describe, expect, it } from "vitest";
import { manifestRecordCount } from "./manifest";

describe("manifestRecordCount", () => {
  it("reads the record_count emitted by the R manifest", () => {
    expect(manifestRecordCount({ data: { record_count: 1234 } })).toBe(1234);
  });

  it("supports older occurrence_rows manifests and rejects missing values", () => {
    expect(manifestRecordCount({ data: { occurrence_rows: 42 } })).toBe(42);
    expect(manifestRecordCount({ data: {} })).toBeNull();
  });
});
