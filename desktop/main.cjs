const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, session } = require("electron");

function configuredUrl() {
  let value = process.env.SIP_DESKTOP_APP_URL;
  if (!value) {
    const configPath = path.join(__dirname, "app-url.json");
    if (fs.existsSync(configPath)) {
      value = JSON.parse(fs.readFileSync(configPath, "utf8")).url;
    }
  }
  if (!value) throw new Error("Set SIP_DESKTOP_APP_URL to the deployed HTTPS application URL.");

  const url = new URL(value);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && !app.isPackaged && isLoopback))) {
    throw new Error("Use a base application URL without credentials or query/fragment data. HTTPS is required except for local development.");
  }
  return url;
}

function sameOrigin(target, expected) {
  try {
    return new URL(target).origin === expected.origin;
  } catch {
    return false;
  }
}

function createWindow(appUrl) {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(target, appUrl)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, target) => {
    if (!sameOrigin(target, appUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.loadURL(appUrl.href).catch((error) => {
    window.close();
    dialog.showErrorBox("Smart Invoice Pro could not load", error.message);
  });
}

app.whenReady().then(() => {
  let appUrl;
  try {
    appUrl = configuredUrl();
  } catch (error) {
    dialog.showErrorBox("Smart Invoice Pro could not start", error.message);
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow(appUrl);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
