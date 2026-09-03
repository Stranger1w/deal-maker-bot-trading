// Minimal, read-only bridge. No Node APIs, no secrets, no IPC to privileged code.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("dealMakerDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
});
