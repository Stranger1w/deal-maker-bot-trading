# Deal Maker — Desktop (Windows .exe)

App web = TanStack Start (SSR + Nitro). El `.exe` es Electron que arranca
el server Node compilado (`DESKTOP=1`, preset `node-server`) y lo muestra en
ventana nativa segura (`contextIsolation: true`, sin Node en la UI).

Icono de la app: `public/icon.ico` (256x256) y `public/favicon.png`.

## ⚠️ Antes de compilar: el `.env`

El `.exe` **necesita las variables de entorno** (Supabase, clave de cifrado de
credenciales) para arrancar el servidor local. La configuración de electron-builder
incluye `.env` en el paquete, así que el fichero debe estar **en la raíz del repo
justo antes de compilar**:

```powershell
Copy-Item "C:\Users\Usuario\secrets\deal-maker.env" "C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading\.env"
```

`.env` está en `.gitignore`: **nunca se comitea**. Para republicar el `.exe`
borralo después.

> **Seguridad**: el `.env` (con `SUPABASE_SERVICE_ROLE_KEY` y
> `CREDENTIALS_ENCRYPTION_KEY`) queda **dentro** de `app.asar`, que se puede
> extraer del `.exe`. Es aceptable para una app personal de uso familiar, pero
> **no repartas el `.exe` con alguien que no sea de confianza**: quien lo tenga
> puede leer la service role key y las credenciales cifradas de los exchanges.
> Para una app distribuida, la clave de servicio debería ir en el servidor y el
> `.exe` solo llevar la clave publicable.

## Comandos (en la raíz del repo)

```powershell
# Instalar dependencias (incluye electron y electron-builder)
bun install

# Build del web + server node (DESKTOP=1 -> .output/)
bun run desktop:build

# Prueba local de Electron, sin instalador
bun run desktop:dev

# Instalador NSIS -> dist\Deal Maker Setup 1.0.0.exe
bun run dist:win

# Portable (un solo .exe, sin instalar)
bun run dist:win:portable
```

> **No uses `bun run build` antes de empaquetar**: sin `DESKTOP=1` el preset de
> Nitro es `cloudflare-module` y el `.exe` arranca roto. Usa siempre
> `desktop:build` o `dist:win`.

## Qué instala el `.exe`

- Instalador NSIS (nombre: Deal Maker, appId: `com.dealmaker.app`).
- Acceso directo en Escritorio + Menú Inicio, desinstalador en Panel de Control.
- La ventana abre `http://127.0.0.1:3127` del server local.
- El motor 24/7 NO depende del `.exe`: vive en el cron de la nube
  (`/api/public/automation-tick` + `/api/public/maintenance`).

## Depuración

- Log del arranque en `deal-maker-debug.log`, junto al `.exe` (o en la raíz del
  repo si no está empaquetado).
- `DEALMAKER_DEBUG=1` abre DevTools.
- Si la ventana sale negra, mira ese log: el server local no arrancó (falta el
  `.env` con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`).

## Seguridad

- `preload.cjs` expone solo `window.dealMaker.version` y la plataforma. Nada de
  claves.
- Las API keys de exchanges se cifran en el servidor (`CREDENTIALS_ENCRYPTION_KEY`)
  y nunca vuelven al navegador (solo los últimos 4 caracteres).
- Solo lectura y trading. **Nunca habilites retiros** en el exchange.
