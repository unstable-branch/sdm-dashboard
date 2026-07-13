import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { encryptOutputs } from "../src/services/plumber-sync.js";
import { encrypt } from "../src/services/encryption.js";

const TEST_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("encryptOutputs", () => {
  let tmpDir: string;

  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = TEST_KEY;
    tmpDir = join("/tmp", `encrypt-test-${Date.now()}-${Math.random()}`);
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    delete process.env.DATA_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  async function createFile(name: string, content: string) {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, name), content, "utf8");
  }

  it("encrypts .tif files and removes originals", async () => {
    await createFile("suitability.tif", "fake tiff content");
    await encryptOutputs(tmpDir);

    const encPath = join(tmpDir, "suitability.tif.enc");
    const origPath = join(tmpDir, "suitability.tif");
    const enc = await readFile(encPath);
    expect(enc).toBeInstanceOf(Buffer);
    expect(enc.length).toBeGreaterThan(0);
    await expect(readFile(origPath, "utf8")).rejects.toThrow();
  });

  it("encrypts .csv files and removes originals", async () => {
    await createFile("predictions.csv", "lon,lat,suit\n140,-23,0.8\n");
    await encryptOutputs(tmpDir);

    const encPath = join(tmpDir, "predictions.csv.enc");
    const origPath = join(tmpDir, "predictions.csv");
    expect(encPath).toBeDefined();
    await expect(readFile(origPath, "utf8")).rejects.toThrow();
  });

  it("does NOT encrypt .json files", async () => {
    await createFile("metadata.json", '{"runId":"abc","status":"done"}');
    await encryptOutputs(tmpDir);

    const encPath = join(tmpDir, "metadata.json.enc");
    const origPath = join(tmpDir, "metadata.json");
    const orig = await readFile(origPath, "utf8");
    expect(orig).toBe('{"runId":"abc","status":"done"}');
    await expect(readFile(encPath, "utf8")).rejects.toThrow();
  });

  it("is idempotent — calling twice does not double-encrypt", async () => {
    await createFile("suitability.tif", "original content");
    await encryptOutputs(tmpDir);
    const firstEnc = await readFile(join(tmpDir, "suitability.tif.enc"));

    await encryptOutputs(tmpDir);
    const secondEnc = await readFile(join(tmpDir, "suitability.tif.enc"));

    expect(firstEnc).toEqual(secondEnc);
  });

  it("skips already-encrypted files without error", async () => {
    await createFile("suitability.tif", "content");
    await encryptOutputs(tmpDir);
    await encryptOutputs(tmpDir);

    const encPath = join(tmpDir, "suitability.tif.enc");
    const enc = await readFile(encPath);
    const decrypted = Buffer.from(enc.slice(12, -16)); // strip nonce + tag
    expect(decrypted.toString()).toBe("content");
  });

  it("handles empty directory gracefully", async () => {
    await mkdir(tmpDir, { recursive: true });
    await expect(encryptOutputs(tmpDir)).resolves.not.toThrow();
  });

  it("skips non-existent directory gracefully", async () => {
    await expect(encryptOutputs("/nonexistent/path/12345")).resolves.not.toThrow();
  });

  it("only processes files with encryptable extensions", async () => {
    await createFile("data.csv", "a,b\n1,2\n");
    await createFile("notes.txt", "some notes");
    await createFile("report.pdf", "%PDF-1.4 fake");
    await encryptOutputs(tmpDir);

    // .csv should be encrypted
    await expect(readFile(join(tmpDir, "data.csv"), "utf8")).rejects.toThrow();
    // .txt and .pdf should NOT be encrypted (not in ENCRYPTABLE_EXTENSIONS)
    const txtContent = await readFile(join(tmpDir, "notes.txt"), "utf8");
    const pdfContent = await readFile(join(tmpDir, "report.pdf"), "utf8");
    expect(txtContent).toBe("some notes");
    expect(pdfContent).toBe("%PDF-1.4 fake");
  });
});
