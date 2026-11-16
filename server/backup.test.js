import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { encryptStreamToFile, verifyEncryptedBackup } from "./backup.js";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "smart-invoice-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("encrypted backups authenticate and reject the wrong key", async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = join(directory, "test.sipbackup");
  const key = randomBytes(32);
  await encryptStreamToFile(Readable.from(["database snapshot"]), filename, key);

  const metadata = await verifyEncryptedBackup(filename, key);
  assert.ok(metadata.size > 0);
  await assert.rejects(verifyEncryptedBackup(filename, randomBytes(32)));
});

test("encrypted backups detect ciphertext tampering", async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = join(directory, "test.sipbackup");
  const key = randomBytes(32);
  await encryptStreamToFile(Readable.from(["database snapshot"]), filename, key);

  const backup = await readFile(filename);
  backup[22] ^= 1;
  await writeFile(filename, backup);

  await assert.rejects(verifyEncryptedBackup(filename, key));
});

test("backup creation never overwrites an existing file", async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = join(directory, "test.sipbackup");
  const key = randomBytes(32);
  await encryptStreamToFile(Readable.from(["first snapshot"]), filename, key);
  const original = await readFile(filename);

  await assert.rejects(
    encryptStreamToFile(Readable.from(["replacement"]), filename, key),
    { code: "EEXIST" },
  );
  assert.deepEqual(await readFile(filename), original);
});
