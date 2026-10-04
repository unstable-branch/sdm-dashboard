import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  it("publishes strings and buffers from the compiled ESM runtime", () => {
    const dir = mkdtempSync(join(SCRATCH_ROOT, "storage-atomic-esm-"));
    fixtures.push(dir);
    const output = join(dir, "compiled");
    const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    execFileSync("pnpm", ["exec", "tsc", "--project", "tsconfig.json", "--outDir", output], {
      cwd: apiRoot,
      timeout: 60_000,
    });
    writeFileSync(join(output, "package.json"), JSON.stringify({ type: "module" }));
    symlinkSync(join(apiRoot, "node_modules"), join(output, "node_modules"), "junction");
    const program = `
      import assert from "node:assert/strict";
      import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      assert.equal(typeof require, "undefined");
      const { writeAtomicSync } = await import(process.argv[1]);
      const root = process.argv[2];
      const target = join(root, "metadata.json");
      writeFileSync(target, "previous metadata");
      writeAtomicSync(target, JSON.stringify({ records: 0 }));
      assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { records: 0 });
      writeAtomicSync(target, Buffer.from("replacement bytes"));
      assert.equal(readFileSync(target, "utf8"), "replacement bytes");
      const blocked = join(root, "blocked");
      mkdirSync(blocked);
      writeFileSync(join(blocked, "keep.txt"), "preserve");
      assert.throws(() => writeAtomicSync(blocked, "refused"), error => error.code === "EISDIR" || error.code === "EPERM");
      assert.equal(readFileSync(join(blocked, "keep.txt"), "utf8"), "preserve");
      assert.deepEqual(readdirSync(root).sort(), ["blocked", "compiled", "metadata.json"]);
      console.log("compiled ESM atomic publication and failure cleanup passed");
    `;
    const result = execFileSync(process.execPath, [
      "--input-type=module", "-e", program,
      pathToFileURL(join(output, "services/storage.js")).href, dir,
    ], { encoding: "utf8", timeout: 15_000, env: { NODE_ENV: "test", PATH: process.env.PATH } });
    expect(result.trim()).toBe("compiled ESM atomic publication and failure cleanup passed");
  }, 90_000);

  it("removes its temporary file after a synchronous rename failure", () => {
    const { dir, target } = fixture();
    expect(() => writeAtomicSync(target, "new data")).toThrow(/EISDIR|EPERM/);
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
