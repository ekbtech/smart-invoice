import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { registerSchema } from "../server/domain.js";
import { config } from "../server/config.js";
import { pool } from "../server/db.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env");

function askLine(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  return prompt.question(question).finally(() => prompt.close());
}

function askSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run `npm run system:reset` from an interactive terminal so the password can be entered privately.");
  }
  return new Promise((resolveSecret, reject) => {
    const decoder = new StringDecoder("utf8");
    let value = "";
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Terminal input closed before setup was complete. No reset was performed."));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("System reset cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolveSecret(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
        }
      }
    };

    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setRawMode(true);
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
  });
}

function replaceAdminAllowlist(envText, email) {
  const assignment = `PLATFORM_ADMIN_EMAILS=${email}`;
  const lines = envText.split(/\r?\n/);
  const assignmentPattern = /^\s*(?:export\s+)?PLATFORM_ADMIN_EMAILS\s*=/;
  const matchingLines = lines.flatMap((line, index) => assignmentPattern.test(line) ? [index] : []);
  if (matchingLines.length) {
    lines[matchingLines[0]] = assignment;
    for (const index of matchingLines.slice(1).reverse()) lines.splice(index, 1);
  } else {
    if (lines.at(-1) !== "") lines.push("");
    lines.push(assignment);
  }
  const newline = envText.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(newline);
}

async function saveAdminAllowlist(email) {
  let envText;
  try {
    envText = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("No .env file was found. Copy .env.example to .env before resetting.");
    throw error;
  }
  const contents = replaceAdminAllowlist(envText, email);
  const fileInfo = await stat(envPath);
  const tempPath = `${envPath}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, contents, { encoding: "utf8", mode: fileInfo.mode & 0o777, flag: "wx" });
    await rename(tempPath, envPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        console.error(`Could not remove temporary configuration file ${tempPath}:`, cleanupError.message);
      }
    }
    throw error;
  }
}

async function resetDatabase(input) {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let foreignKeysDisabled = false;
  let connectionDestroyed = false;
  try {
    const [[database]] = await connection.query("SELECT DATABASE() AS name");
    if (database.name !== config.database.database) {
      throw new Error(`Connected database "${database.name}" does not match configured database "${config.database.database}". Nothing was changed.`);
    }
    const [[lock]] = await connection.execute("SELECT GET_LOCK(?, 0) AS acquired", ["smart_invoice_pro_system_reset"]);
    if (Number(lock.acquired) !== 1) throw new Error("Another system reset is already running.");
    lockAcquired = true;

    const [[starterPlan]] = await connection.execute("SELECT id FROM subscription_plans WHERE code = 'starter' LIMIT 1");
    if (!starterPlan) throw new Error("The starter plan is missing. Run `npm run db:migrate` before resetting.");

    const passwordHash = await bcrypt.hash(input.password, 12);
    const userId = randomUUID();
    const tenantId = randomUUID();
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    foreignKeysDisabled = true;
    await connection.beginTransaction();

    const [tables] = await connection.execute(
      `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME NOT IN ('schema_migrations', 'subscription_plans')
       ORDER BY TABLE_NAME`,
    );
    for (const { tableName } of tables) {
      await connection.query(`DELETE FROM ${connection.escapeId(tableName)}`);
    }

    await connection.execute(
      "INSERT INTO tenants (id, name, email) VALUES (?, ?, ?)",
      [tenantId, input.businessName, input.email],
    );
    await connection.execute(
      "INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)",
      [userId, input.email, input.fullName, passwordHash],
    );
    await connection.execute(
      "INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, 'admin')",
      [tenantId, userId],
    );
    await connection.execute(
      "INSERT INTO branches (id, tenant_id, name, is_default) VALUES (?, ?, 'Main branch', TRUE)",
      [randomUUID(), tenantId],
    );
    await connection.execute(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, trial_ends_at)
       VALUES (?, ?, ?, 'trialing', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 14 DAY))`,
      [randomUUID(), tenantId, starterPlan.id],
    );
    await connection.execute(
      `INSERT INTO platform_admin_audit (id, admin_user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'system.reset', 'system', NULL, JSON_OBJECT('tenantId', ?))`,
      [randomUUID(), userId, tenantId],
    );
    await connection.commit();
    return { tenantId, userId, deletedTables: tables.length };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "System reset failed and the database transaction could not be rolled back.");
    }
    throw error;
  } finally {
    if (foreignKeysDisabled) {
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch (error) {
        connection.destroy();
        connectionDestroyed = true;
        throw new Error(`Could not restore database foreign-key checks; the connection was discarded. ${error.message}`);
      }
    }
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", ["smart_invoice_pro_system_reset"]);
    if (!connectionDestroyed) connection.release();
  }
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run `npm run system:reset` in an interactive terminal. Credentials are not accepted as command-line arguments.");
  }

  const [[database]] = await pool.query("SELECT DATABASE() AS name");
  await readFile(envPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") throw new Error("No .env file was found. Copy .env.example to .env before resetting.");
    throw error;
  });
  const [[userCount]] = await pool.query("SELECT COUNT(*) AS count FROM users");
  const [[tenantCount]] = await pool.query("SELECT COUNT(*) AS count FROM tenants");
  console.log("DANGER: This permanently deletes all current users, workspaces, invoices, and business records.");
  console.log(`Database: ${database.name} (${Number(userCount.count)} users, ${Number(tenantCount.count)} workspaces)`);
  console.log("Stop the API and frontend before continuing. Subscription plan definitions and migration history will be kept.");
  const confirmation = await askLine(`Type ${database.name} to confirm the full reset: `);
  if (confirmation !== database.name) throw new Error("Database confirmation did not match. Nothing was changed.");

  const fullName = await askLine("General administrator full name: ");
  const email = await askLine("General administrator email: ");
  const businessName = await askLine("Admin workspace name [Main Workspace]: ");
  const password = await askSecret("Password (4+ characters): ");
  const passwordConfirmation = await askSecret("Confirm password: ");
  if (password !== passwordConfirmation) throw new Error("The passwords did not match. Nothing was changed.");
  const input = registerSchema.parse({
    fullName,
    email,
    businessName: businessName.trim() || "Main Workspace",
    password,
  });

  const result = await resetDatabase(input);
  try {
    await saveAdminAllowlist(input.email);
  } catch (error) {
    throw new Error(`The database was reset and the administrator account was created, but .env could not be updated: ${error.message}. Set PLATFORM_ADMIN_EMAILS=${input.email} in .env before restarting the API.`);
  }

  console.log(`\nSystem reset complete. All previous users and business data were deleted.`);
  console.log(`One general administrator was created for ${input.businessName} (${input.email}).`);
  console.log(`Deleted data tables: ${result.deletedTables}. Subscription plans and migration history were preserved.`);
  console.log("Restart the API so it loads the new single-email platform-admin allowlist.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "System reset failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
