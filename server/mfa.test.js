import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV ??= "test";
process.env.APP_ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { createTotpSecret, decryptMfaSecret, encryptMfaSecret, verifyTotp } = await import("./mfa.js");

test("TOTP matches the RFC 6238 SHA-1 test vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "287083", 59_000), false);
});

test("TOTP accepts the adjacent clock step but rejects malformed codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(secret, "287082", 30_000), true);
  assert.equal(verifyTotp(secret, "287082", 59_000 + 60_000), false);
  assert.equal(verifyTotp(secret, "28-7082", 59_000), false);
});

test("MFA secrets are encrypted at rest and decrypt only with a valid tag", () => {
  const encrypted = encryptMfaSecret("test-secret");
  assert.notEqual(encrypted.toString("utf8"), "test-secret");
  assert.equal(decryptMfaSecret(encrypted), "test-secret");
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptMfaSecret(tampered));
});

test("new TOTP secrets contain 160 bits of entropy", () => {
  const secret = createTotpSecret();
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]+$/);
});
