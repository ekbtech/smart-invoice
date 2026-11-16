import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const migrationsDirectory = fileURLToPath(new URL("../database/migrations/", import.meta.url));

try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(160) NOT NULL PRIMARY KEY,
       applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
     ) ENGINE=InnoDB`,
  );
  const [files] = await pool.query(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'",
  );
  if (!files.length) throw new Error("The migration tracking table was not created.");

  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(name))
    .sort();
  const [appliedRows] = await pool.query("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration)) continue;
    const sql = await readFile(new URL(`../database/migrations/${migration}`, import.meta.url), "utf8");
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await pool.query(statement);
    await pool.execute("INSERT INTO schema_migrations (version) VALUES (?)", [migration]);
    console.log(`Applied ${migration} (${statements.length} statements).`);
  }
  console.log("Database migrations are up to date.");
} catch (error) {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
