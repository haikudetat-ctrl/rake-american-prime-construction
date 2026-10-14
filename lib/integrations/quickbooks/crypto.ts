import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM, stored as base64url "iv.tag.ciphertext". GCM authenticates, so a
// tampered or wrong-key value fails to open instead of yielding garbage.

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string, key: Buffer): string {
  const [iv, tag, ciphertext] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !ciphertext) throw new Error("malformed sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
