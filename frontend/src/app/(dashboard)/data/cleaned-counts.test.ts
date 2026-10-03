import { describe, expect, it } from "vitest";
import { aggregateCleanedCounts, displayCleanedCount, readCleanedCount } from "./cleaned-counts";
import type { UploadFile } from "@/services/types";

const upload = (overrides: Partial<UploadFile>): UploadFile => ({
  file_id: "asset", file_name: "data.csv", file_size: 0, n_rows: 0,
  cleaned: true, modified_at: null, ...overrides,
});

describe("cleaned count semantics", () => {
  it.each([
    ["known count", { valid_records: 7 }, 7],
    ["known zero", { valid_records: 0 }, 0],
    ["explicit null", { valid_records: null }, null],
    ["missing", {}, null],
  ])("preserves %s", (_label, result, expected) => {
    expect(readCleanedCount(result)).toBe(expected);
  });

  it("does not replace unknown upload counts with raw rows in aggregate or labels", () => {
    expect(aggregateCleanedCounts([
      upload({ cleaned_valid_records: null, n_rows: 9 }),
      upload({ cleaned_valid_records: undefined, n_rows: 4 }),
      upload({ cleaned_valid_records: 0, n_rows: 3 }),
      upload({ cleaned_valid_records: 5, n_rows: 6 }),
    ])).toBeNull();
    expect(displayCleanedCount(upload({ cleaned_valid_records: undefined, n_rows: 9 }))).toBe("Count unavailable");
    expect(displayCleanedCount(upload({ cleaned_valid_records: 0, n_rows: 9 }))).toBe("0");
  });

  it("sums when every cleaned count is authoritative", () => {
    expect(aggregateCleanedCounts([
      upload({ cleaned_valid_records: 0, n_rows: 9 }),
      upload({ cleaned_valid_records: 5, n_rows: 6 }),
    ])).toBe(5);
  });
});
