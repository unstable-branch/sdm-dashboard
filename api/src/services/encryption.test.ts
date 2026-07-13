import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, encryptString, decryptString, isEncrypted, isEncryptionKeyConfigured } from "./encryption.js";

const TEST_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("encryption service", () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY = TEST_KEY;
  });

  it("encrypts and decrypts a buffer round-trip", () => {
    const original = Buffer.from("Hello, SDM Dashboard!");
    const ciphertext = encrypt(original);
    expect(ciphertext).not.toEqual(original);
    const decrypted = decrypt(ciphertext);
    expect(decrypted.toString()).toBe("Hello, SDM Dashboard!");
  });

  it("produces different ciphertexts for the same plaintext (random nonce)", () => {
    const plaintext = Buffer.from("same data");
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toEqual(b);
  });

  it("rejects tampered ciphertext", () => {
    const original = Buffer.from("tamper test");
    const ciphertext = encrypt(original);
    ciphertext[24] ^= 0xff;
    expect(() => decrypt(ciphertext)).toThrow();
  });

  it("handles empty buffer", () => {
    const empty = Buffer.alloc(0);
    const ciphertext = encrypt(empty);
    const decrypted = decrypt(ciphertext);
    expect(decrypted.length).toBe(0);
  });

  it("encrypts and decrypts strings", () => {
    const original = "secret-sdm-string-42";
    const encrypted = encryptString(original);
    expect(encrypted).not.toBe(original);
    const decrypted = decryptString(encrypted);
    expect(decrypted).toBe(original);
  });

  it("isEncrypted returns true for encrypted buffers", () => {
    const ciphertext = encrypt(Buffer.from("test"));
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  it("isEncrypted returns false for short buffers", () => {
    expect(isEncrypted(Buffer.from("hi"))).toBe(false);
    expect(isEncrypted(Buffer.alloc(28))).toBe(false);
  });

  it("isEncryptionKeyConfigured returns true when key is set", () => {
    expect(isEncryptionKeyConfigured()).toBe(true);
  });

  it("isEncryptionKeyConfigured returns false when no key", () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.SDM_ENCRYPTION_KEY;
    expect(isEncryptionKeyConfigured()).toBe(false);
    process.env.DATA_ENCRYPTION_KEY = TEST_KEY;
  });
});
