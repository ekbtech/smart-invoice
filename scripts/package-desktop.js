import { spawnSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = resolve(projectRoot, "desktop");
const appUrlPath = resolve(desktopDirectory, "app-url.json");
const value = process.env.SIP_DESKTOP_APP_URL;

if (!value) throw new Error("Set SIP_DESKTOP_APP_URL to the deployed HTTPS application URL before packaging.");
const url = new URL(value);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
  throw new Error("The packaged desktop application URL must be a base HTTPS URL without credentials or query/fragment data.");
}

let createdConfig = false;
try {
  await writeFile(appUrlPath, `${JSON.stringify({ url: url.href }, null, 2)}\n`, { flag: "wx" });
  createdConfig = true;
  const builderCli = resolve(projectRoot, "node_modules", "electron-builder", "cli.js");
  const result = spawnSync(process.execPath, [builderCli, "--win", "nsis"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  if (createdConfig) await unlink(appUrlPath);
}
