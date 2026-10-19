; Deal Maker — instalador Windows (NSIS via electron-builder)
; Requiere: Node 20+, npm i, .env con Supabase, build desktop.
;
; 1) npm run dist:win        -> genera dist-electron/Deal Maker Setup .exe
; 2) El .exe instala en Program Files, crea acceso directo + desinstalador.
; 3) Compilación cruzada NO soportada: compila el .exe en Windows,
;    el .dmg en macOS (ver desktop/README.md).
