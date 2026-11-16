import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, appendFile, copyFile, open, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { pool } from "./db.js";

const magic = Buffer.from("SIPBACKUP1", "ascii");
const nonceLength = 12;
const tagLength = 16;
const excludedTables = new Set(["schema_migrations"]);

function backupKey() {
  const value = process.env.BACKUP_ENCRYPTION_KEY;
  if (!/^[a-fA-F0-9]{64}$/.test(value ?? "")) {
    throw new Error("Set BACKUP_ENCRYPTION_KEY to a unique 32-byte key encoded as 64 hexadecimal characters.");
  }
  const key = Buffer.from(value, "hex");
  if (key.equals(config.encryptionKey)) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be different from APP_ENCRYPTION_KEY.");
  }
  return key;
}

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replaceAll("`", "``")}\``;
}

async function databaseSchema(connection) {
  const [rows] = await connection.execute(
    `SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName, c.DATA_TYPE AS dataType
     FROM information_schema.TABLES t
     JOIN information_schema.COLUMNS c
       ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
     WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
     ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    [config.database.database],
  );
  const tables = new Map();
  for (const row of rows) {
    if (excludedTables.has(row.tableName)) continue;
    const table = tables.get(row.tableName) ?? { name: row.tableName, columns: [] };
    table.columns.push({ name: row.columnName, type: row.dataType });
    tables.set(row.tableName, table);
  }
  return [...tables.values()];
}

function encodeValue(value) {
  if (value instanceof Date) return { __sipBackupType: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __sipBackupType: "buffer", value: value.toString("base64") };
  return value;
}

function decodeValue(value, columnType) {
  if (value && value.__sipBackupType === "date") return new Date(value.value);
  if (value && value.__sipBackupType === "buffer") return Buffer.from(value.value, "base64");
  if (columnType === "json" && value !== null && typeof value !== "string") return JSON.stringify(value);
  return value;
}

async function* backupRows() {
  const connection = await pool.getConnection();
  let discardConnection = false;
  try {
    await connection.beginTransaction();
    const tables = await databaseSchema(connection);
    yield `${JSON.stringify({
      type: "manifest",
      version: 1,
      sourceDatabase: config.database.database,
      createdAt: new Date().toISOString(),
      tables,
    })}\n`;
    for (const table of tables) {
      const selectedColumns = table.columns.map((column) => {
        const identifier = quoteIdentifier(column.name);
        if (["date", "datetime", "timestamp", "time", "year", "decimal"].includes(column.type)) {
          return `CAST(${identifier} AS CHAR) AS ${identifier}`;
        }
        return identifier;
      });
      const query = connection.query(
        `SELECT ${selectedColumns.join(", ")} FROM ${quoteIdentifier(table.name)}`,
      );
      for await (const row of query.stream({ highWaterMark: 64 })) {
        yield `${JSON.stringify({
          type: "row",
          table: table.name,
          values: table.columns.map((column) => encodeValue(row[column.name])),
        })}\n`;
      }
    }
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      connection.destroy();
      discardConnection = true;
      throw new AggregateError([error, rollbackError], "Backup failed and its database transaction could not be rolled back.");
    }
    throw error;
  } finally {
    if (!discardConnection) connection.release();
  }
}

export async function encryptStreamToFile(source, outputPath, key) {
  const filename = outputPath;
  const temporary = `${filename}.partial-${randomUUID()}`;
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("AES-256 backup encryption requires a 32-byte key.");
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  try {
    await writeFile(temporary, Buffer.concat([magic, nonce]), { flag: "wx", mode: 0o600 });
    await pipeline(source, cipher, createWriteStream(temporary, { flags: "a", mode: 0o600 }));
    await appendFile(temporary, cipher.getAuthTag());
    await copyFile(temporary, filename, fsConstants.COPYFILE_EXCL);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function encryptedFileMetadata(filename) {
  const details = await stat(filename);
  const prefixLength = magic.length + nonceLength;
  if (details.size < prefixLength + tagLength + 1) throw new Error("The backup file is truncated or invalid.");
  const handle = await open(filename, "r");
  try {
    const prefix = Buffer.alloc(prefixLength);
    const suffix = Buffer.alloc(tagLength);
    const first = await handle.read(prefix, 0, prefixLength, 0);
    const last = await handle.read(suffix, 0, tagLength, details.size - tagLength);
    if (first.bytesRead !== prefixLength || last.bytesRead !== tagLength || !prefix.subarray(0, magic.length).equals(magic)) {
      throw new Error("The backup file has an unsupported format.");
    }
    return {
      size: details.size,
      nonce: prefix.subarray(magic.length),
      tag: suffix,
      ciphertextStart: prefixLength,
      ciphertextEnd: details.size - tagLength - 1,
    };
  } finally {
    await handle.close();
  }
}

function createDecryptedStream(filename, metadata, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, metadata.nonce);
  decipher.setAuthTag(metadata.tag);
  const ciphertext = createReadStream(filename, { start: metadata.ciphertextStart, end: metadata.ciphertextEnd });
  ciphertext.on("error", (error) => decipher.destroy(error));
  return ciphertext.pipe(decipher);
}

export async function verifyEncryptedBackup(filename, key) {
  const metadata = await encryptedFileMetadata(filename);
  await pipeline(
    createReadStream(filename, { start: metadata.ciphertextStart, end: metadata.ciphertextEnd }),
    (() => {
      const decipher = createDecipheriv("aes-256-gcm", key, metadata.nonce);
      decipher.setAuthTag(metadata.tag);
      return decipher;
    })(),
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  );
  return metadata;
}

export async function createEncryptedBackup(outputPath) {
  const key = backupKey();
  const filename = outputPath;
  try {
    await access(filename);
    throw new Error("The destination already exists. Choose a new backup filename; backups are never overwritten.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await encryptStreamToFile(Readable.from(backupRows()), filename, key);
}

function sameSchema(source, target) {
  return JSON.stringify(source) === JSON.stringify(target);
}

async function assertEmptyTarget(connection, tables) {
  for (const table of tables) {
    if (table.name === "subscription_plans") continue;
    const [rows] = await connection.query(`SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(table.name)}`);
    if (Number(rows[0].rowCount) > 0) {
      throw new Error("Restore is allowed only into a newly migrated, empty database. Existing business data was not modified.");
    }
  }
}

async function insertRows(connection, table, rows) {
  if (rows.length === 0) return;
  const columnSql = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const rowPlaceholder = `(${table.columns.map(() => "?").join(", ")})`;
  const sql = `INSERT INTO ${quoteIdentifier(table.name)} (${columnSql}) VALUES ${rows.map(() => rowPlaceholder).join(", ")}`;
  const values = rows.flatMap((row) => row.map((value, index) => decodeValue(value, table.columns[index].type)));
  await connection.execute(sql, values);
}

export async function restoreEncryptedBackup(filename) {
  const key = backupKey();
  await access(filename);
  const metadata = await verifyEncryptedBackup(filename, key);
  const connection = await pool.getConnection();
  let transaction = false;
  let foreignKeyChecksDisabled = false;
  let discardConnection = false;
  try {
    const currentSchema = await databaseSchema(connection);
    const input = createDecryptedStream(filename, metadata, key);
    const lines = createInterface({ input, crlfDelay: Infinity });
    let manifest = null;
    let tableByName = new Map();
    let currentTable = null;
    let batch = [];
    await connection.beginTransaction();
    transaction = true;
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (!manifest) {
        if (record.type !== "manifest" || record.version !== 1 || !Array.isArray(record.tables)) {
          throw new Error("The backup manifest is invalid or unsupported.");
        }
        manifest = record;
        if (!sameSchema(manifest.tables, currentSchema)) {
          throw new Error("The backup schema does not match this database. Apply migrations for the same application version before restoring.");
        }
        tableByName = new Map(currentSchema.map((table) => [table.name, table]));
        await assertEmptyTarget(connection, currentSchema);
        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
        foreignKeyChecksDisabled = true;
        for (const table of currentSchema) {
          await connection.query(`DELETE FROM ${quoteIdentifier(table.name)}`);
        }
        continue;
      }
      if (record.type !== "row" || !tableByName.has(record.table) || !Array.isArray(record.values)) {
        throw new Error("The backup contains an invalid table record.");
      }
      const table = tableByName.get(record.table);
      if (record.values.length !== table.columns.length) throw new Error(`The backup row does not match the ${table.name} table schema.`);
      if (currentTable && currentTable.name !== table.name) {
        await insertRows(connection, currentTable, batch);
        batch = [];
      }
      currentTable = table;
      batch.push(record.values);
      if (batch.length >= 200) {
        await insertRows(connection, currentTable, batch);
        batch = [];
      }
    }
    if (!manifest) throw new Error("The backup manifest is missing.");
    await insertRows(connection, currentTable, batch);
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    foreignKeyChecksDisabled = false;
    await connection.commit();
    transaction = false;
  } catch (error) {
    if (transaction) {
      try {
        if (foreignKeyChecksDisabled) await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        await connection.rollback();
      } catch (cleanupError) {
        connection.destroy();
        discardConnection = true;
        throw new AggregateError([error, cleanupError], "Restore failed and the database connection could not be safely reset.");
      }
    }
    throw error;
  } finally {
    if (!discardConnection) connection.release();
  }
}
