import { describe, it, expect, beforeEach } from "vitest";
import { resolveFilePath, setUploadDir } from "../services/upload-utils.js";
import { join } from "path";

describe("resolveFilePath", () => {
  const root = join("/var", "data", "uploads");
  beforeEach(() => {
    setUploadDir(root);
  });

  it("rejects empty input", () => {
    expect(resolveFilePath("").path).toBe("");
  });

  it("rejects null byte", () => {
    expect(resolveFilePath("foo\0.csv").path).toBe("");
  });

  it("rejects bare '..' parent reference", () => {
    expect(resolveFilePath("..").path).toBe("");
  });

  it("sanitizes ../foo to basename under UPLOAD_DIR (path-traversal-safe)", () => {
    const r1 = resolveFilePath("../etc/passwd");
    expect(r1.path).toBe(join(root, "passwd"));

    const r2 = resolveFilePath("../../etc/passwd");
    expect(r2.path).toBe(join(root, "passwd"));
  });

  it("sanitizes deeply nested ../ chains to basename under UPLOAD_DIR", () => {
    const r = resolveFilePath("../a/b/c/../d/../../../etc/passwd");
    expect(r.path).toBe(join(root, "passwd"));
  });

  it("rejects absolute paths under root", () => {
    expect(resolveFilePath("/etc/passwd").path).toBe("");
    expect(resolveFilePath("/var/data/secret.txt").path).toBe("");
  });

  it("accepts basenames within UPLOAD_DIR", () => {
    const r = resolveFilePath("abc-123.csv");
    expect(r.path).toBe(join(root, "abc-123.csv"));
  });

  it("rejects Windows-style absolute paths that escape root", () => {
    expect(resolveFilePath("C:/Windows/System32/notepad.exe").path).toBe("");
  });

  it("returns empty path when UPLOAD_DIR is unset", () => {
    setUploadDir("");
    expect(resolveFilePath("abc-123.csv").path).toBe("");
  });

  it("accepts a fully-qualified child path that exists under UPLOAD_DIR", () => {
    const child = join(root, "nested", "abc.csv");
    const r = resolveFilePath(child);
    expect(r.path).toBe(child);
  });

  it("rejects a fully-qualified sibling path outside UPLOAD_DIR", () => {
    expect(resolveFilePath(join(root, "..", "uploads-other", "a.csv")).path).toBe("");
  });
});
