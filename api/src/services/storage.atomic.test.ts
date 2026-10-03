import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeAtomic, writeAtomicSync } from "./storage.js";

const fixtures: string[] = [];
const SCRATCH_ROOT = tmpdir();
function fixture() {
  const dir = mkdtempSync(join(SCRATCH_ROOT, "storage-atomic-cleanup-"));
  fixtures.push(dir);
  const target = join(dir, "metadata-target");
  mkdirSync(target);
  writeFileSync(join(target, "keep.txt"), "existing data");
  return { dir, target };
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("atomic file write failure cleanup", () => {
  it("removes its temporary file after a synchronous rename failure", () => {
    const { dir, target } = fixture();
    expect(() => writeAtomicSync(target, "new data")).toThrow();
    expect(readdirSync(dir)).toEqual(["metadata-target"]);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("existing data");
  });

  it("removes its temporary file after an asynchronous rename failure", async () => {
    const { dir, target } = fixture();
    await expect(writeAtomic(target, "new data")).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["metadata-target"]);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("existing data");
  });
});
