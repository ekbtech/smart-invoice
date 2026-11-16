import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { pool } from "./db.js";
import { createEncryptedBackup, restoreEncryptedBackup } from "./backup.js";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function run() {
  const operation = process.argv[2];
  if (operation === "backup") {
    const output = option("--output");
    if (!output) throw new Error("Usage: npm run db:backup -- --output <new-file.sipbackup>");
    await createEncryptedBackup(output);
    console.log("Encrypted database backup created.");
    return;
  }
  if (operation === "restore") {
    const filename = option("--file");
    const confirmation = option("--confirm-restore");
    if (!filename || confirmation !== config.database.database) {
      throw new Error(`Usage: npm run db:restore -- --file <backup.sipbackup> --confirm-restore ${config.database.database}`);
    }
    await restoreEncryptedBackup(filename);
    console.log("Database backup restored into the empty configured database.");
    return;
  }
  throw new Error("Choose either the backup or restore operation.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database backup operation failed.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
