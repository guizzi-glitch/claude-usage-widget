"use strict";

const path = require("node:path");
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} = require("electron");
const { collectUsage } = require("./collector");

const REFRESH_MS = 60_000;
const STATUS_TTL_MS = 5 * 60_000;
let tray = null;
let panel = null;
let refreshTimer = null;
let quitting = false;
let serviceStatusCache = null;

function assetPath(name) {
  return path.join(__dirname, "assets", name);
}

function cachePath() {
  return path.join(app.getPath("userData"), "usage-widget.json");
}

function readUsage() {
  try {
    return collectUsage({ outputFile: cachePath() });
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      available: false,
      error: error instanceof Error ? error.message : "Falha ao ler os dados do Codex",
      rateLimits: {},
      activity: { daily: [] },
    };
  }
}

function updateTray(data) {
  if (!tray) return;
  const session = Math.round(Number(data?.rateLimits?.session?.percentUsed || 0));
  const weekly = Math.round(Number(data?.rateLimits?.weeklyAll?.percentUsed || 0));
  tray.setToolTip(
    data?.available
      ? `Codex Usage — sessão ${session}% · semanal ${weekly}%`
      : "Codex Usage — aguardando dados locais",
  );
}

async function fetchServiceStatus() {
  if (serviceStatusCache && Date.now() - serviceStatusCache.checkedAt < STATUS_TTL_MS) {
    return serviceStatusCache.value;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  let value;
  try {
    const response = await fetch("https://status.openai.com/api/v2/summary.json", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const summary = await response.json();
    const relevant = (summary.components || [])
      .filter((component) => !component.group && /^(codex\b|vs code extension$|responses$|chat completions$)/i.test(component.name || ""))
      .slice(0, 5)
      .map((component) => ({ name: component.name, status: component.status }));
    const descriptions = {
      none: "Todos os sistemas operacionais",
      minor: "Instabilidade parcial",
      major: "Interrupção parcial",
      critical: "Interrupção crítica",
      maintenance: "Em manutenção",
    };
    const indicator = summary.status?.indicator || "none";
    value = {
      available: true,
      indicator,
      description: descriptions[indicator] || summary.status?.description || "Status disponível",
      components: relevant,
    };
  } catch {
    value = { available: false, indicator: "unknown", description: "Status indisponível", components: [] };
  } finally {
    clearTimeout(timeout);
  }
  serviceStatusCache = { checkedAt: Date.now(), value };
  return value;
}

async function refresh() {
  const data = readUsage();
  data.serviceStatus = await fetchServiceStatus();
  updateTray(data);
  if (panel && !panel.isDestroyed()) panel.webContents.send("usage:updated", data);
  return data;
}

function positionPanel() {
  if (!panel || !tray) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const work = display.workArea;
  const [width, height] = panel.getSize();
  const trayBounds = tray.getBounds();
  const x = Math.round(
    Math.min(work.x + work.width - width - 12, Math.max(work.x + 12, trayBounds.x + trayBounds.width - width)),
  );
  const taskbarAtTop = trayBounds.y < work.y;
  const y = taskbarAtTop ? work.y + 12 : work.y + work.height - height - 12;
  panel.setPosition(x, y, false);
}

function togglePanel() {
  if (!panel) return;
  if (panel.isVisible()) {
    panel.hide();
    return;
  }
  positionPanel();
  panel.show();
  panel.focus();
  refresh();
}

function startupEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setStartup(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: app.isPackaged ? ["--hidden"] : [path.resolve(__dirname, ".."), "--hidden"],
  });
}

function rebuildMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir painel", click: togglePanel },
    { label: "Atualizar agora", click: refresh },
    { type: "separator" },
    {
      label: "Iniciar com o Windows",
      type: "checkbox",
      checked: startupEnabled(),
      click: (item) => setStartup(item.checked),
    },
    {
      label: "Abrir pasta de dados",
      click: () => shell.showItemInFolder(cachePath()),
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
}

function createPanel() {
  panel = new BrowserWindow({
    width: 410,
    height: 700,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#101114",
    icon: assetPath("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panel.loadFile(path.join(__dirname, "renderer", "index.html"));
  panel.on("blur", () => panel?.hide());
  panel.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      panel.hide();
    }
  });
}

function createTray() {
  let icon = nativeImage.createFromPath(assetPath("icon.png"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 20, height: 20 }));
  tray.on("click", togglePanel);
  rebuildMenu();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", togglePanel);
  app.whenReady().then(() => {
    createPanel();
    createTray();
    refresh();
    refreshTimer = setInterval(refresh, REFRESH_MS);
    if (!process.argv.includes("--hidden")) togglePanel();
  });
}

ipcMain.handle("usage:get", () => refresh());
ipcMain.handle("window:hide", () => panel?.hide());
ipcMain.handle("startup:get", () => startupEnabled());
ipcMain.handle("startup:set", (_event, enabled) => {
  setStartup(Boolean(enabled));
  rebuildMenu();
  return startupEnabled();
});

app.on("before-quit", () => {
  quitting = true;
  if (refreshTimer) clearInterval(refreshTimer);
});

app.on("window-all-closed", () => {});
