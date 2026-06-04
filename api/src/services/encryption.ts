import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  let hex = process.env.DATA_ENCRYPTION_KEY;
  if (!hex) {
    hex = process.env.SDM_ENCRYPTION_KEY;
    if (hex) {
      console.warn("[encrypt] SDM_ENCRYPTION_KEY is deprecated — use DATA_ENCRYPTION_KEY instead");
    }
  }
  if (!hex) {
    throw new Error("DATA_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes / 256 bits)");
  }
  return key;
}

// Verify key availability at startup
try {
  getKey();
  console.log("[encrypt] DATA_ENCRYPTION_KEY is set and valid");
} catch (e) {
  console.warn("[encrypt] Encryption key not configured — files will be stored unencrypted");
  console.warn("[encrypt] Set DATA_ENCRYPTION_KEY in .env (64 hex chars = 32 bytes)");
  console.warn("[encrypt] Generate with: openssl rand -hex 32");
}

export function encrypt(plaintext: Buffer): Buffer {
  const key = getKey();
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, encrypted]);
}

export function decrypt(ciphertext: Buffer): Buffer {
  const key = getKey();
  const nonce = ciphertext.subarray(0, NONCE_LENGTH);
  const tag = ciphertext.subarray(NONCE_LENGTH, NONCE_LENGTH + TAG_LENGTH);
  const data = ciphertext.subarray(NONCE_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function isEncrypted(buffer: Buffer): boolean {
  return buffer.length >= NONCE_LENGTH + TAG_LENGTH + 1;
}

export function encryptString(plaintext: string): string {
  return encrypt(Buffer.from(plaintext, "utf-8")).toString("hex");
}

export function decryptString(ciphertextHex: string): string {
  return decrypt(Buffer.from(ciphertextHex, "hex")).toString("utf-8");
}

export function isEncryptionKeyConfigured(): boolean {
  return !!(process.env.DATA_ENCRYPTION_KEY || process.env.SDM_ENCRYPTION_KEY);
}

function encryptedPath(filePath: string): string {
  return filePath + ".enc";
}

function decryptedPath(filePath: string): string {
  return filePath.replace(/\.enc$/, "");
}
