import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error("Invalid base32 secret.");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function createTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function createTotpUri(secret, email) {
  const label = encodeURIComponent(`Smart Invoice Pro:${email}`);
  const issuer = encodeURIComponent("Smart Invoice Pro");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

function totpAt(secret, counter) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(data).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255)) % 1_000_000;
  return String(code).padStart(6, "0");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyTotp(secret, token, now = Date.now()) {
  if (!/^\d{6}$/.test(token)) return false;
  const currentCounter = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) {
    if (safeEqual(totpAt(secret, currentCounter + offset), token)) return true;
  }
  return false;
}

export function encryptMfaSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptMfaSecret(value) {
  const encrypted = Buffer.from(value);
  if (encrypted.length < 30 || encrypted[0] !== 1) throw new Error("The stored MFA key is invalid.");
  const iv = encrypted.subarray(1, 13);
  const tag = encrypted.subarray(13, 29);
  const ciphertext = encrypted.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
