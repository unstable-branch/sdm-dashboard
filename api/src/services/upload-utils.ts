import { mkdirSync, existsSync, writeFileSync, readFileSync, renameSync } from "fs";
import { join, extname, resolve, sep, basename } from "path";
import { randomUUID } from "crypto";
import { encrypt, decrypt } from "./encryption.js";
import { plumberClient } from "./plumber.js";

export let UPLOAD_DIR = "";

function writeAtomicSync(path: string, data: Buffer): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function setUploadDir(dir: string): void {
  UPLOAD_DIR = dir;
}

export function saveUploadEncrypted(buffer: Buffer, originalName: string): { encPath: string; pipelineRunId: string } {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const pipelineRunId = randomUUID();
  const uuid = randomUUID();
  const ext = extname(originalName) || ".csv";
  const encPath = join(UPLOAD_DIR, `${uuid}${ext}.enc`);
  const encrypted = encrypt(buffer);
  writeAtomicSync(encPath, encrypted);
  return { encPath, pipelineRunId };
}

export function decryptToUploads(encPath: string): string | null {
  if (!existsSync(encPath)) {
    console.warn(`[encrypt] File not found: ${encPath}`);
    return null;
  }
  if (!encPath.endsWith(".enc")) return null;
  const plaintextPath = encPath.replace(/\.enc$/, "");
  if (existsSync(plaintextPath)) return plaintextPath;
  try {
    const ciphertext = readFileSync(encPath);
    const plaintext = decrypt(ciphertext);
    writeAtomicSync(plaintextPath, plaintext);
    const lineCount = plaintext.toString().split("\n").filter((l) => l.trim().length > 0).length - 1;
    console.log(`[encrypt] Decrypted ${encPath} → ${plaintextPath} (${lineCount} lines)`);
    return plaintextPath;
  } catch (err) {
    console.error(`[encrypt] Failed to decrypt ${encPath}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Resolve a client-supplied file identifier to an on-disk path under UPLOAD_DIR,
 * rejecting any path that escapes the upload directory.
 *
 * Allowed forms:
 *   - a basename only (e.g. "abc-123.csv"), useful when UPLOAD_DIR is the cwd
 *   - a path that, after normalization, has UPLOAD_DIR as an ancestor
 *
 * Rejected: empty, absolute, null-byte, parent-traversal (".."), or any path
 * whose resolved form is outside UPLOAD_DIR.
 */
export function resolveFilePath(fileId: string): { path: string } {
  if (!fileId || typeof fileId !== "string" || fileId.includes("\0")) {
    return { path: "" };
  }
  if (fileId.includes("..")) {
    const safe = basename(fileId);
    if (!safe || safe === fileId) return { path: "" };
    fileId = safe;
  }
  if (!UPLOAD_DIR) return { path: "" };

  const root = resolve(UPLOAD_DIR);
  const isAbsoluteInput = fileId.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(fileId);
  const base = isAbsoluteInput ? fileId : join(root, fileId);
  const normSafe = resolve(base);
  if (normSafe !== root && !normSafe.startsWith(root + sep)) {
    return { path: "" };
  }

  if (normSafe.endsWith(".enc")) {
    const decrypted = decryptToUploads(normSafe);
    if (decrypted) {
      const normDec = resolve(decrypted);
      if (normDec !== root && !normDec.startsWith(root + sep)) {
        return { path: "" };
      }
      return { path: decrypted };
    }
    return { path: normSafe };
  }
  return { path: normSafe };
}

export async function pollPlumberJob(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
  const deadline = timeout ? Date.now() + timeout : Infinity;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const status = await plumberClient.getJobStatus(jobId);
      if (status?.status === "completed" || status?.status === "success") {
        return status as Record<string, unknown>;
      }
      if (status?.status === "failed" || status?.status === "error") {
        return { error: status.error || "Job failed" };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw lastError || new Error("Polling timed out");
}
