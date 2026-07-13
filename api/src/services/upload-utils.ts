import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { encrypt, decrypt } from "./encryption.js";
import { plumberClient } from "./plumber.js";

export let UPLOAD_DIR = "";

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
  writeFileSync(encPath, encrypted);
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
    writeFileSync(plaintextPath, plaintext);
    const lineCount = plaintext.toString().split("\n").filter((l) => l.trim().length > 0).length - 1;
    console.log(`[encrypt] Decrypted ${encPath} → ${plaintextPath} (${lineCount} lines)`);
    return plaintextPath;
  } catch (err) {
    console.error(`[encrypt] Failed to decrypt ${encPath}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function resolveFilePath(fileId: string): { path: string } {
  const encPath = join(UPLOAD_DIR, fileId);
  if (encPath.endsWith(".enc")) {
    const decrypted = decryptToUploads(encPath);
    return { path: decrypted ?? encPath };
  }
  return { path: encPath };
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
