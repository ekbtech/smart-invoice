import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { startRecurringScheduler } from "./recurring.js";

const app = createApp();

try {
  await pool.query("SELECT 1");
  const server = app.listen(config.port, () => {
    console.log(`Smart Invoice Pro API listening on http://localhost:${config.port}`);
  });
  const stopRecurringScheduler = startRecurringScheduler();

  async function shutdown(signal) {
    console.log(`${signal} received; closing API server.`);
    await stopRecurringScheduler();
    server.close(async (error) => {
      await pool.end();
      if (error) {
        console.error("API shutdown failed:", error);
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  console.error("The API could not connect to MySQL. Start the database and verify the DB_* settings before retrying.", error);
  await pool.end();
  process.exitCode = 1;
}
