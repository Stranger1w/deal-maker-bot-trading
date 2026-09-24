// Deal Maker Desktop — proceso principal Electron.
// DIAGNÓSTICO pantalla negra + CPU alto:
// `process.execPath` en Electron NO es Node: es el .exe de Electron.
// spawn(execPath, [index.mjs]) relanza OTRO Electron en loop (fork-bomb).
// Por eso ahora: node real si existe; si no, mensaje visible (nunca spawn execPath).
// Logs a archivo deal-maker-debug.log junto al .exe (DevTools no abre colgado).
const { app, BrowserWindow, dialog } = require("electron");
const { fork, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let serverProc = null;
let mainWindow = null;

function logFile() {
  try {
    const base = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, "..");
    return path.join(base, "deal-maker-debug.log");
  } catch {
    return path.join(os.tmpdir(), "deal-maker-debug.log");
  }
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`;
  try {
    fs.appendFileSync(logFile(), line);
  } catch {}
  console.log(...args);
}
process.on("uncaughtException", (e) => log("UNCAUGHT:", e && e.stack ? e.stack : e));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function serverEntry() {
  // electron-builder empaqueta .output/server/index.mjs vía extraResources.
  const candidates = [
    path.join(process.resourcesPath, "server", "index.mjs"),
    path.join(__dirname, "..", ".output", "server", "index.mjs"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  log("serverEntry:", candidates.join(" | "), "=>", found || "NONE");
  return found;
}

function realNodePath() {
  const dir = path.dirname(process.execPath);
  const p = path.join(dir, process.platform === "win32" ? "node.exe" : "node");
  const ok = fs.existsSync(p);
  log("realNode:", p, ok ? "EXISTS" : "missing");
  return ok ? p : null;
}

function startServer() {
  const entry = serverEntry();
  if (!entry) return null;
  const port = process.env.PORT || "3127";
  // .env junto al .exe portable / resources: el server compilado no lee
  // process.env del padre para Vite, así que inyectamos las vars aquí.
  try {
    const dotenv = require("node:fs");
    const p = require("node:path");
    const candidates = [
      p.join(process.resourcesPath || "", "..", ".env"),
      p.join(__dirname, "..", ".env"),
    ];
    for (const f of candidates) {
      try {
        const raw = dotenv.readFileSync(f, "utf8");
        let n = 0;
        for (const line of raw.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
          if (!m || process.env[m[1]]) continue;
          let v = m[2] || "";
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          process.env[m[1]] = v;
        }
        break;
      } catch {}
    }
  } catch {}
  serverProc = null;
  const nodeBin = realNodePath();
  if (nodeBin) {
    log("server: spawn node real", nodeBin);
    serverProc = spawn(nodeBin, [entry], {
      env: { ...process.env, PORT: port, HOST: "127.0.0.1", DESKTOP: "1" },
      stdio: "ignore",
      windowsHide: true,
    });
  } else if (!app.isPackaged) {
    log("server: fork en dev");
    serverProc = fork(entry, [], {
      env: { ...process.env, PORT: port, HOST: "127.0.0.1", DESKTOP: "1" },
      silent: true,
    });
  } else {
    log("FATAL: sin node.exe junto al portable; no hago spawn(execPath) para no colgar el PC");
    return { fatal: "no-node" };
  }
  try {
    serverProc.unref();
  } catch {}
  if (serverProc && serverProc.on) {
    serverProc.on("error", (e) => log("server error:", e && e.message ? e.message : e));
    serverProc.on("exit", (code, sig) => log("server exit:", code, sig));
  }
  return `http://127.0.0.1:${port}`;
}

async function waitFor(url, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok || res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: "#0b0e13",
    show: false,
    icon: path.join(__dirname, "..", "public", "favicon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // DevTools para diagnosticar pantalla negra (Ctrl+Shift+I también lo abre).
  if (process.env.DEALMAKER_DEBUG === "1") mainWindow.webContents.openDevTools({ mode: "detach" });
  // Diagnóstico CSS: vuelca a deal-maker-debug.log los 404 de assets.
  mainWindow.webContents.session.webRequest.onCompleted({ urls: ["*://127.0.0.1/*"] }, (d) => {
    if (d.statusCode >= 400) log("ASSET 404:", d.statusCode, d.url);
  });
  log("createWindow execPath=", process.execPath, "packaged=", app.isPackaged);
  const started = startServer();
  if (started && typeof started === "object" && started.fatal === "no-node") {
    const msg = "Falta node.exe junto al portable. Log: " + logFile();
    log("FATAL no-node");
    try {
      dialog.showErrorBox("Deal Maker — falta node", msg);
    } catch {}
    await mainWindow.loadURL(
      "data:text/html,<body style='background:#0b0e13;color:#fff;font-family:sans-serif;padding:40px'><h2>Falta node junto al .exe</h2><p>" +
        msg +
        "</p></body>",
    );
    mainWindow.show();
    return;
  }
  const url = started || "http://127.0.0.1:3127";
  const ready = await waitFor(url);
  log("server ready:", ready, url);
  if (!ready) {
    await mainWindow.loadURL(
      "data:text/html,<body style='background:#0b0e13;color:#fff;font-family:sans-serif;padding:40px'><h2>Deal Maker no pudo arrancar el servidor local</h2><p>Revisa que .env esté junto al .exe con VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.</p></body>",
    );
  } else {
    await mainWindow.loadURL(url);
  }
  mainWindow.show();
  mainWindow.on("closed", () => (mainWindow = null));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  try { serverProc?.kill(); } catch {}
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  try { serverProc?.kill(); } catch {}
});
