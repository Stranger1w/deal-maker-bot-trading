// Deal Maker Desktop — preload mínimo y seguro.
// No expone Node ni claves. Solo versión para "Acerca de".
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("dealMaker", {
  version: "1.0.0",
  platform: process.platform,
});
