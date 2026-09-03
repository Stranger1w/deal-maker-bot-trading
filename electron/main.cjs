// Electron main process for Deal Maker.
// Security model:
//  - contextIsolation: true, nodeIntegration: false, sandbox: true
//  - the renderer only ever talks HTTP to the local server; it never sees
//    Binance secrets or the encryption key (those stay in this Node process
//    and in the bundled server functions).
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const isDev = !app.isPackaged;
const DEV_URL = process.env.DEAL_MAKER_DEV_URL || "http://localhost:8080";

/** Loads KEY=VALUE pairs from an optional .env file into the main process only. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Boots the bundled Node server (nitro `node-server` output) inside this process. */
async function startLocalServer() {
  const candidates = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "dist", "server", "index.mjs"),
    path.join(app.getAppPath(), "dist", "server", "index.mjs"),
    path.join(__dirname, "..", "dist", "server", "index.mjs"),
  ];
  const entry = candidates.find((p) => p && fs.existsSync(p));
  if (!entry) {
    throw new Error(
      "No se encontró dist/server/index.mjs. Ejecuta `npm run build:desktop` antes de empaquetar.",
    );
  }
  const port = await findFreePort();
  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.NITRO_PORT = String(port);
  process.env.NITRO_HOST = "127.0.0.1";
  await import(pathToFileURL(entry).href);
  return `http://127.0.0.1:${port}`;
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status < 500) return true;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Deal Maker",
    backgroundColor: "#0b0f14",
    show: false,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // External links open in the system browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  win.loadURL(url);
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    loadEnvFile(path.join(app.getPath("userData"), ".env"));
    loadEnvFile(path.join(app.getAppPath(), ".env"));

    Menu.setApplicationMenu(Menu.getApplicationMenu());

    let url = DEV_URL;
    if (isDev) {
      await waitForServer(url);
    } else {
      url = await startLocalServer();
      await waitForServer(url);
    }
    createWindow(url);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
