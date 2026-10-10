import { describe, expect, it } from "vitest";
import { addWorkspaceFile } from "./types";
import type { UploadFile } from "@/services/types";

const file: UploadFile = {
  file_id: "file-1",
  rawAssetId: "canonical-raw-asset-1",
  file_name: "synthetic.csv",
  file_size: 0,
  n_rows: 6000,
  cleaned: false,
  modified_at: "2026-10-02T00:00:00.000Z",
  format: "csv",
};

describe("workspace asset identity", () => {
  it("uses the canonical asset id as its stable card id without UUID APIs", () => {
    const originalRandomUUID = globalThis.crypto?.randomUUID;
    if (globalThis.crypto) Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      const added = addWorkspaceFile([], file, ["Species one"]);
      expect(added).toHaveLength(1);
      expect(added[0].id).toBe("canonical-raw-asset-1");
      expect(added[0].rawAssetId).toBe("canonical-raw-asset-1");
    } finally {
      if (globalThis.crypto && originalRandomUUID) Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: originalRandomUUID });
    }
  });

  it("does not add a duplicate canonical asset", () => {
    const once = addWorkspaceFile([], file, ["Species one"]);
    expect(addWorkspaceFile(once, file, ["Species one"])).toBe(once);
    expect(once).toHaveLength(1);
  });

  it("also deduplicates aliases by file id", () => {
    const once = addWorkspaceFile([], file, []);
    const alias = { ...file, rawAssetId: "another-canonical-id" };
    expect(addWorkspaceFile(once, alias, [])).toBe(once);
  });
});
