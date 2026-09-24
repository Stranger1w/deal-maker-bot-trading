# Deal Maker — Desktop (Windows .exe)

App web = TanStack Start (SSR + Nitro). El `.exe` es Electron que arranca
el server Node compilado (`DESKTOP=1`, preset `node-server`) y lo muestra en
ventana nativa segura (`contextIsolation: true`, sin Node en la UI).

Icono de la app: el `D` verde que pasaste (también `public/favicon.png`).
Para instalador con `.ico` de alta resolución, conviértelo a
`public/icon.ico` (256x256) y cambia `win.icon` en `package.json`.

## Requisitos

- Windows 10/11 64-bit para compilar el `.exe` (sin cross-compile).
- Node 20+ y `.env` con Supabase (ver `SUPABASE_SETUP.md`).

## Comandos (en esta carpeta)

```powershell
npm i
npm run desktop:build   # build web + server node (DESKTOP=1 -> .output/)
npm run desktop:dev     # prueba local Electron sin instalador
npm run dist:win        # instalador NSIS -> dist/Deal Maker Setup *.exe
```

## Qué instala el .exe

- Instalador NSIS (nombre: Deal Maker, appId: `com.dealmaker.app`).
- Acceso directo en Escritorio + Menú Inicio, desinstalador en Panel de Control.
- La ventana abre `http://127.0.0.1:<puerto>` del server local.
- El motor 24/7 NO depende del .exe: vive en cron nube
  (`/api/public/automation-tick` + `/api/public/maintenance`).

## Seguridad

- `preload.cjs` expone solo `window.dealMaker.version`. Nada de claves.
- Las API keys de exchanges se cifran en server (`CREDENTIALS_ENCRYPTION_KEY`)
  y nunca vuelven al navegador (solo últimos 4).
- Solo lectura+trading. Nunca habilitar retiros en el exchange.
