"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexUsage", {
  getUsage: () => ipcRenderer.invoke("usage:get"),
  hide: () => ipcRenderer.invoke("window:hide"),
  getStartup: () => ipcRenderer.invoke("startup:get"),
  setStartup: (enabled) => ipcRenderer.invoke("startup:set", Boolean(enabled)),
  onUsage: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("usage:updated", listener);
    return () => ipcRenderer.removeListener("usage:updated", listener);
  },
});
