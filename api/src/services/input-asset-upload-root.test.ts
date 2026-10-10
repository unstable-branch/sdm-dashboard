import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolveInputAssetUploadRoot } from "./input-assets.js";

// Real filesystem: the writer and registration both depend on this resolver.
describe("resolveInputAssetUploadRoot", () => {
  let base: string;

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "sdm-upload-root-")));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  });

  it("defaults to <project>/data/uploads when unset", async () => {
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", "");
    vi.stubEnv("SDM_PROJECT_ROOT", "");
    const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    await expect(resolveInputAssetUploadRoot()).resolves.toBe(join(project, "data", "uploads"));
  });

  it("accepts an existing canonical custom root", async () => {
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", base);
    await expect(resolveInputAssetUploadRoot()).resolves.toBe(base);
  });

  it("accepts a canonical custom root whose leaf does not exist yet", async () => {
    const leaf = join(base, "uploads");
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", leaf);
    await expect(resolveInputAssetUploadRoot()).resolves.toBe(leaf);
  });

  it.each([
    ["relative", () => "data/uploads"],
    ["dot segment", () => base + "/./uploads"],
    ["dot-dot segment", () => base + "/x/../uploads"],
    ["trailing separator", () => base + "/uploads/"],
  ])("refuses a %s root", async (_label, root) => {
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", root());
    await expect(resolveInputAssetUploadRoot()).resolves.toBeNull();
  });

  it("refuses a symlinked root and a root below a symlinked ancestor", async () => {
    const real = join(base, "real");
    await mkdir(real);
    await symlink(real, join(base, "link"));
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", join(base, "link"));
    await expect(resolveInputAssetUploadRoot()).resolves.toBeNull();
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", join(base, "link", "uploads"));
    await expect(resolveInputAssetUploadRoot()).resolves.toBeNull();
  });

  it("refuses a root that exists as a regular file", async () => {
    await writeFile(join(base, "file"), "x");
    vi.stubEnv("SDM_INPUT_ASSET_UPLOAD_ROOT", join(base, "file"));
    await expect(resolveInputAssetUploadRoot()).resolves.toBeNull();
  });
});
