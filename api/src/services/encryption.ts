import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

export const SDM_ENCRYPTION_MAGIC = Buffer.from("SDMENC1\n", "utf-8");
const MAGIC_LENGTH = SDM_ENCRYPTION_MAGIC.length;

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

// Wire format (must match R/core/crypto.R exactly):
//   magic(8) + nonce(12) + ciphertext + tag(16)
// Total overhead: 8 + 12 + 16 = 36 bytes
export function encrypt(plaintext: Buffer): Buffer {
  const key = getKey();
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([SDM_ENCRYPTION_MAGIC, nonce, encrypted, tag]);
}

export function decrypt(ciphertext: Buffer): Buffer {
  const key = getKey();
  if (ciphertext.length < MAGIC_LENGTH + NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Ciphertext too short");
  }
  if (!SDM_ENCRYPTION_MAGIC.equals(ciphertext.subarray(0, MAGIC_LENGTH))) {
    throw new Error("Invalid SDM encryption magic — file was not encrypted with this tool");
  }
  const nonce = ciphertext.subarray(MAGIC_LENGTH, MAGIC_LENGTH + NONCE_LENGTH);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const data = ciphertext.subarray(MAGIC_LENGTH + NONCE_LENGTH, ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function isEncrypted(buffer: Buffer): boolean {
  if (buffer.length < MAGIC_LENGTH + NONCE_LENGTH + TAG_LENGTH + 1) return false;
  return SDM_ENCRYPTION_MAGIC.equals(buffer.subarray(0, MAGIC_LENGTH));
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
