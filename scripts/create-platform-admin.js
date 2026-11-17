import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { parse as parseDotenv } from "dotenv";
import { registerSchema } from "../server/domain.js";
import { inTransaction, pool } from "../server/db.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env");

function askLine(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  return prompt.question(question).finally(() => prompt.close());
}

function askSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run `npm run admin:create` from an interactive terminal so the password can be entered privately.");
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
      reject(new Error("Terminal input closed before setup was complete. Nothing was changed."));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Account setup cancelled."));
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

function updateAdminAllowlist(envText, email) {
  const existing = (parseDotenv(envText).PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (existing.includes(email)) return { content: envText, changed: false };

  const emails = [...new Set([...existing, email])];
  const assignment = `PLATFORM_ADMIN_EMAILS=${emails.join(",")}`;
  const lines = envText.split(/\r?\n/);
  const assignmentPattern = /^\s*(?:export\s+)?PLATFORM_ADMIN_EMAILS\s*=/;
  const matchingLines = lines.flatMap((line, index) => assignmentPattern.test(line) ? [index] : []);
  if (matchingLines.length) {
    for (const index of matchingLines) lines[index] = assignment;
  } else {
    if (lines.at(-1) !== "") lines.push("");
    lines.push(assignment);
  }
  const newline = envText.includes("\r\n") ? "\r\n" : "\n";
  return { content: lines.join(newline), changed: true };
}

async function saveAdminAllowlist(email) {
  let envText;
  try {
    envText = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("No .env file was found. Copy .env.example to .env and configure the server first.");
    throw error;
  }
  const update = updateAdminAllowlist(envText, email);
  if (!update.changed) return false;

  const fileInfo = await stat(envPath);
  const tempPath = `${envPath}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, update.content, { encoding: "utf8", mode: fileInfo.mode & 0o777, flag: "wx" });
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
  return true;
}

async function createWorkspace(connection, input, userId, createUser, passwordHash) {
  const tenantId = randomUUID();
  await connection.execute(
    "INSERT INTO tenants (id, name, email) VALUES (?, ?, ?)",
    [tenantId, input.businessName, input.email],
  );
  if (createUser) {
    await connection.execute(
      "INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)",
      [userId, input.email, input.fullName, passwordHash],
    );
  }
  await connection.execute(
    "INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, 'owner')",
    [tenantId, userId],
  );
  await connection.execute(
    "INSERT INTO branches (id, tenant_id, name, is_default) VALUES (?, ?, 'Main branch', TRUE)",
    [randomUUID(), tenantId],
  );
  const [subscription] = await connection.execute(
    `INSERT INTO subscriptions (id, tenant_id, plan_id, status, trial_ends_at)
     SELECT ?, ?, id, 'trialing', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 14 DAY)
     FROM subscription_plans WHERE code = 'starter'`,
    [randomUUID(), tenantId],
  );
  if (subscription.affectedRows !== 1) throw new Error("The starter subscription plan is missing. Run `npm run db:migrate` and try again.");
  return tenantId;
}

async function provisionAdmin(input) {
  const newPasswordHash = await bcrypt.hash(input.password, 12);
  return inTransaction(async (connection) => {
    const [users] = await connection.execute(
      "SELECT id, password_hash, disabled_at FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
      [input.email],
    );
    const existing = users[0];
    if (existing) {
      if (existing.disabled_at) throw new Error("That account is disabled. Re-enable it before granting platform administrator access.");
      if (!await bcrypt.compare(input.password, existing.password_hash)) {
        throw new Error("That email already has an account. Enter its current password to grant platform administrator access.");
      }
      const [memberships] = await connection.execute(
        "SELECT tenant_id FROM memberships WHERE user_id = ? AND active = TRUE LIMIT 1",
        [existing.id],
      );
      if (memberships.length) return { userId: existing.id, createdAccount: false, createdWorkspace: false };
      await createWorkspace(connection, input, existing.id, false, null);
      return { userId: existing.id, createdAccount: false, createdWorkspace: true };
    }

    const userId = randomUUID();
    await createWorkspace(connection, input, userId, true, newPasswordHash);
    return { userId, createdAccount: true, createdWorkspace: true };
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run `npm run admin:create` in an interactive terminal. Credentials are not accepted as command-line arguments.");
  }

  console.log("Create a platform-wide administrator account.");
  console.log("Your password will not be displayed or saved in the project configuration.\n");
  const fullName = await askLine("Administrator full name: ");
  const email = await askLine("Administrator email: ");
  const businessName = await askLine("Admin workspace name [Platform Admin Workspace]: ");
  const password = await askSecret("Password (12+ characters): ");
  const confirmation = await askSecret("Confirm password: ");
  if (password !== confirmation) throw new Error("The passwords did not match. Nothing was changed.");

  const input = registerSchema.parse({
    fullName,
    email,
    businessName: businessName.trim() || "Platform Admin Workspace",
    password,
  });

  const result = await provisionAdmin(input);
  try {
    const allowlistChanged = await saveAdminAllowlist(input.email);
    console.log(`\nPlatform administrator access is configured for ${input.email}.`);
    console.log(result.createdAccount ? "A new account and admin workspace were created." : result.createdWorkspace
      ? "The existing account was verified and an admin workspace was created."
      : "The existing account was verified; its existing workspaces were left unchanged.");
    if (allowlistChanged) console.log("Restart the API so it reloads the updated .env allowlist.");
    else console.log("The API must be started with this email in PLATFORM_ADMIN_EMAILS.");
    console.log("Sign in with the email and password you entered, then open Platform admin.");
  } catch (error) {
    console.error(`The account setup completed, but the platform admin allowlist could not be updated: ${error.message}`);
    console.error("Rerun this command with the same email and password after fixing .env; no password is stored in .env.");
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Platform administrator setup failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
