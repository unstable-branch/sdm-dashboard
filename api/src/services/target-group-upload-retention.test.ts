import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const boundary = vi.hoisted(() => ({
  afterIdentityCheck: undefined as undefined | ((path: string) => Promise<void>),
}));

// Only inject the race at the filesystem boundary. All operations remain real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    lstat: async (path: string) => {
      const result = await fs.lstat(path);
      await boundary.afterIdentityCheck?.(path);
      return result;
    },
  };
});

import { writeTargetGroupUpload } from "./target-group-upload-writer.js";

const directories: string[] = [];
async function actualFs() {
  return vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
}

afterEach(async () => {
  boundary.afterIdentityCheck = undefined;
  const fs = await actualFs();
  await Promise.all(directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
});

describe("failed upload retention", () => {
  it("never deletes a foreign inode replaced after the cleanup identity check", async () => {
    const fs = await actualFs();
    const root = await fs.mkdtemp(join(tmpdir(), "sdm-cleanup-race-"));
    directories.push(root);
    const foreign = Buffer.from("foreign replacement");
    let raced = false;
    boundary.afterIdentityCheck = async (path) => {
      raced = true;
      await fs.unlink(path);
      await fs.writeFile(path, foreign, { flag: "wx" });
    };
    await expect(writeTargetGroupUpload(root, "groups.csv", Buffer.from("uploaded bytes"), async () => {
      throw new Error("registration denied");
    })).rejects.toThrow("registration denied");

    // If unsafe cleanup ran, the foreign replacement must survive. If it did
    // not run, retain the unregistered original without guessing deletion ownership.
    expect(await fs.readdir(root)).toContain("groups.csv");
    expect(await fs.readFile(join(root, "groups.csv"))).toEqual(raced ? foreign : Buffer.from("uploaded bytes"));
  });

  it("retains an unregistered upload when registration fails", async () => {
    const fs = await actualFs();
    const root = await fs.mkdtemp(join(tmpdir(), "sdm-retained-upload-"));
    directories.push(root);
    const bytes = Buffer.from("uploaded bytes");
    await expect(writeTargetGroupUpload(root, "groups.csv", bytes, async () => {
      throw new Error("registration denied");
    })).rejects.toThrow("registration denied");
    expect(await fs.readFile(join(root, "groups.csv"))).toEqual(bytes);
  });
});
