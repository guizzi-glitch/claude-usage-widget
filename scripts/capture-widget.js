"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { collectUsage } = require("../windows/collector");

const output = path.join(__dirname, "..", "dist", "widget-preview.png");

ipcMain.handle("usage:get", () => ({
  ...collectUsage(),
  serviceStatus: {
    available: true,
    indicator: "minor",
    description: "Instabilidade parcial",
    components: [
      { name: "Codex Web", status: "operational" },
      { name: "Codex Desktop", status: "operational" },
      { name: "Codex API", status: "operational" },
    ],
  },
}));
ipcMain.handle("startup:get", () => false);
ipcMain.handle("startup:set", () => false);
ipcMain.handle("window:hide", () => {});

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 410,
    height: 700,
    show: false,
    frame: false,
    backgroundColor: "#101114",
    webPreferences: {
      preload: path.join(__dirname, "..", "windows", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "..", "windows", "renderer", "index.html"));
  window.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, (await window.webContents.capturePage()).toPNG());
      console.log(output);
      app.quit();
    }, 1200);
  });
});
