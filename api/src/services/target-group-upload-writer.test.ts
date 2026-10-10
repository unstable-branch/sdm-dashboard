import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputAssetRegistrationError, registerInputAssetFromServerPath } from "./input-assets.js";
import { writeTargetGroupUpload } from "./target-group-upload-writer.js";

const rootsToRemove: string[] = [];
async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "sdm-upload-writer-"));
  rootsToRemove.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(rootsToRemove.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("descriptor-anchored target-group upload writer", () => {
  it("writes under the original directory when the root name is rebound", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "uploads");
    const moved = join(base, "original");
    const outside = join(base, "outside");
    const bytes = Buffer.from("species,target_group\nA,1");
    await import("node:fs/promises").then(({ mkdir }) => Promise.all([mkdir(root), mkdir(outside)]));

    let insertCalls = 0;
    const database = {
      select: () => { throw new Error("unexpected select"); },
      insert: () => {
        insertCalls += 1;
        throw new Error("unexpected insert");
      },
    } as never;
    await expect(writeTargetGroupUpload(root, "groups.csv", bytes, async (path, contentSha256) => {
      await import("node:fs/promises").then(({ rename }) => rename(root, moved));
      await symlink(outside, root);
      return registerInputAssetFromServerPath({
        creatorUserId: "22222222-2222-4222-8222-222222222222",
        scope: "private",
        kind: "target_group",
        absolutePath: path,
        contentSha256,
      }, { roots: { uploads: root }, database });
    })).rejects.toBeInstanceOf(InputAssetRegistrationError);

    expect(insertCalls).toBe(0);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(moved)).toEqual(["groups.csv"]);
    expect(await readFile(join(moved, "groups.csv"))).toEqual(bytes);
  });

  it("preserves a foreign replacement file when registration fails", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "uploads");
    const bytes = Buffer.from("original upload");
    const foreign = Buffer.from("foreign replacement");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(root));

    await expect(writeTargetGroupUpload(root, "groups.csv", bytes, async (path) => {
      await unlink(path);
      await writeFile(path, foreign);
      throw new Error("registration failed");
    })).rejects.toThrow("registration failed");

    expect(await readFile(join(root, "groups.csv"))).toEqual(foreign);
  });

  it("binds real registration to the uploaded hash and denies substituted bytes before insert", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "uploads");
    const uploadedBytes = Buffer.from("species,target_group\nA,1");
    const substitutedBytes = Buffer.from("species,target_group\nB,2");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(root));
    let insertCalls = 0;
    const database = {
      select: () => { throw new Error("unexpected select"); },
      insert: () => {
        insertCalls += 1;
        throw new Error("unexpected insert");
      },
    } as never;

    await expect(writeTargetGroupUpload(root, "groups.csv", uploadedBytes, async (path, contentSha256) => {
      expect(contentSha256).toBe(createHash("sha256").update(uploadedBytes).digest("hex"));
      await unlink(path);
      await writeFile(path, substitutedBytes);
      return registerInputAssetFromServerPath({
        creatorUserId: "22222222-2222-4222-8222-222222222222",
        scope: "private",
        kind: "target_group",
        absolutePath: path,
        contentSha256,
      }, { roots: { uploads: root }, database });
    })).rejects.toBeInstanceOf(InputAssetRegistrationError);

    expect(insertCalls).toBe(0);
    expect(await readFile(join(root, "groups.csv"))).toEqual(substitutedBytes);
  });

  it("rejects noncanonical roots without creating directories", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "missing") + "/";
    await expect(writeTargetGroupUpload(root, "groups.csv", Buffer.from("x"), async () => undefined)).rejects.toThrow();
    expect(await readdir(base)).toEqual([]);
  });

  it("refuses a symlinked ancestor without writing through it", async () => {
    const base = await temporaryDirectory();
    const outside = join(base, "outside");
    const alias = join(base, "alias");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(outside));
    await symlink(outside, alias);
    await expect(writeTargetGroupUpload(join(alias, "uploads"), "groups.csv", Buffer.from("x"), async () => undefined)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
});
