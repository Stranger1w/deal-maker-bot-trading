# Deal Maker

Panel de control para bots de trading (Binance) y workers de minería.
Funciona como **aplicación web** (TanStack Start) y como **aplicación de escritorio** (Electron).

## Desarrollo web

```sh
npm i
npm run dev        # http://localhost:8080
npm run build      # build web/cloud (sin cambios)
```

## Desarrollo de escritorio

Con el servidor de desarrollo web ya corriendo (`npm run dev`), en otra terminal:

```sh
npm run electron:dev
```

La ventana de Electron carga `http://localhost:8080` (configurable con `DEAL_MAKER_DEV_URL`).

## Build de escritorio

```sh
npm run build:desktop        # macOS/Linux
npm run build:desktop:win    # Windows (cmd)
```

`DESKTOP=1` hace que el bundle del servidor se genere con el preset **node-server** de Nitro,
para que la app de escritorio pueda arrancar el servidor localmente en `127.0.0.1` con un puerto
libre. Sin esa variable el build sigue siendo exactamente el build web/cloud de siempre.

> Nota: dentro del entorno de build gestionado de Lovable el preset queda fijado a Cloudflare;
> el preset `node-server` se aplica al ejecutar `build:desktop` en tu máquina o en tu CI.

## Instaladores

```sh
npm run dist:win     # Windows: instalador NSIS (.exe)
npm run dist:mac     # macOS: DMG (x64 + arm64)
npm run dist:linux   # Linux: AppImage
```

Los artefactos se generan en `release/`.

- **Windows (NSIS)**: instalador asistido, permite elegir carpeta, crea acceso directo en el
  escritorio y en el menú Inicio, y registra un desinstalador en “Aplicaciones instaladas”.
- **macOS (DMG)**: ventana con el icono de la app y un alias de `/Applications` para arrastrar;
  la app queda visible en `/Applications`.

### Requisitos por plataforma (limitación importante)

electron-builder **no compila instaladores nativos de forma fiable entre sistemas operativos**:

| Instalador | Se debe generar en | Requisitos |
| --- | --- | --- |
| `.exe` NSIS | Windows (recomendado) | Node.js 20+, Windows 10/11. Firma opcional con certificado Authenticode. |
| `.dmg` | **macOS obligatorio** | Xcode Command Line Tools; para distribuir fuera de tu equipo, cuenta de Apple Developer para firmar y notarizar. |
| `.AppImage` | Linux | Node.js 20+. |

El DMG requiere herramientas exclusivas de macOS (`hdiutil`, firma/notarización), así que no puede
generarse en Windows ni en Linux ni en este entorno en la nube. La configuración
(`electron-builder.yml`) y los scripts ya están listos: basta ejecutar `npm run dist:mac` en un Mac
y `npm run dist:win` en Windows, o usar una matriz de CI (`windows-latest` y `macos-latest`) que
ejecute esos mismos comandos.

Icono de la app: `build/icon.png` (1024×1024). electron-builder deriva `.ico` y `.icns` a partir de él.

## Seguridad en escritorio

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`.
- El `preload` solo expone `window.dealMakerDesktop` con `isDesktop`, `platform` y `version`.
- Las API Keys de Binance y la clave de cifrado **nunca** llegan al renderer: viven en el proceso
  principal / servidor bundleado y solo se descifran allí para firmar peticiones.
- Los enlaces externos se abren en el navegador del sistema; la navegación fuera del origen local
  está bloqueada; instancia única de la app.
- Variables de entorno del servidor (p. ej. `CREDENTIALS_ENCRYPTION_KEY`, claves de backend) se leen
  de un archivo `.env` en la carpeta de datos de usuario de la app o del entorno del sistema; no se
  empaquetan secretos en el instalador.

## Stack

TanStack Start · React · TypeScript · Tailwind CSS · Electron

## Ejecución 24/7 (motor de automatización)

Los bots se ejecutan mediante un worker durable en la nube, **no** en tu PC ni en la app Electron:

1. Publica el proyecto (despliegue Cloud activo).
2. Programa un cron que llame cada minuto a:
   `POST https://<tu-dominio>/api/public/automation-tick`
   con la cabecera `Authorization: Bearer $LOVABLE_CRON_SECRET`.
3. Activa el motor en **Automatización** (por defecto está apagado).

El motor aplica en cada ciclo: kill switch global, límite global de pérdida diaria,
y por bot: pérdida diaria máxima, stop-loss por operación, drawdown máximo, límite de
capital asignado y máximo de operaciones diarias. Al alcanzarse un límite el bot se detiene
automáticamente, se registra auditoría y se muestra alerta. Las órdenes usan clave de
idempotencia por bot y ciclo para evitar duplicados, con reintentos y logs de ejecución.

## Mantenimiento programado (reportes y capital)

Programa un segundo cron diario y semanal:

`POST https://<tu-dominio>/api/public/maintenance` con `Authorization: Bearer $LOVABLE_CRON_SECRET`
y cuerpo `{"scope":"daily"}` o `{"scope":"weekly"}`.

- **daily**: reporte de rendimiento de Escuadrón y Enjambre.
- **weekly**: reporte semanal + aplicación de la política de capital (reinvertir o reservar
  un % de la ganancia semanal como saldo disponible en Fondos). Nunca realiza retiros externos.

## Autenticación y 2FA

`/acceso` implementa sesión real con correo y contraseña más TOTP (autenticador). Los flujos
sensibles —**retiro de fondos** y **paso Demo→Real**— se validan en el backend exigiendo nivel de
seguridad `aal2` (segundo factor verificado en la sesión actual). Sin ello quedan bloqueados: no se
simula seguridad. Los flujos antiguos sin 2FA están deshabilitados en el backend.

## Alertas y notificaciones

Las alertas in-app cubren parada/error de bot, breach de drawdown, desconexión de Binance y
depósitos/retiros, y aparecen en Dashboard, Escuadrón, Enjambre y Fondos. La entrega por email
requiere un dominio de envío verificado; mientras no exista, las alertas se marcan como
*pendientes de configuración* y **no** se simulan entregas.

## Binance: permisos y whitelist de IP

Al guardar o probar claves se muestra el checklist obligatorio: activar solo lectura y trading,
**nunca** permiso de retiro, y restringir la clave por whitelist de IP a las salidas del despliegue
Cloud. Solo se guarda configuración no sensible en claro; el secreto se cifra en reposo y se
descifra únicamente en el backend para firmar solicitudes.

## Región del backend y restricción geográfica de Binance

Las llamadas firmadas a Binance salen del backend desplegado (`src/lib/dealmaker.functions.ts`
y el motor de automatización), nunca del navegador ni de Electron. **La región efectiva la
determina la plataforma de alojamiento gestionada**: el proyecto no expone —ni puede exponer— un
selector de región por proyecto, así que no se ha añadido ninguno falso. En `vite.config.ts` el
build web usa el preset gestionado (Cloudflare) y `supabase/config.toml` solo contiene el
identificador del proyecto: no hay ajuste de región disponible.

Para obtener evidencia real, en **Binance → Ubicación del backend** hay una comprobación que
consulta la traza del borde (plataforma, centro de datos y país de salida) y el endpoint público
`api/v3/ping`, y guarda el resultado en `backend_region_probes` (sin secretos).

Si Binance responde con ubicación restringida (HTTP 451/403 o el mensaje
*"Service unavailable from a restricted location according to b. Eligibility"*), la app:

- detecta el caso en la prueba de conexión y en cada ciclo del motor;
- guarda `connection_status = geo_restricted` con código y mensaje seguros (sin claves);
- pausa de forma segura los bots en modo Real antes de abrir nuevas posiciones, con auditoría,
  log y alerta;
- muestra: *"Binance no está disponible desde la ubicación del servidor actual. Esta es una
  restricción geográfica de Binance, no un problema con tus claves."*

Alternativas legales: revisar la lista oficial de países/territorios admitidos por Binance,
alojar el backend en una región o plataforma admitida oficialmente, o usar la entidad local de
Binance correspondiente a tu jurisdicción. **No uses VPN ni proxies para eludir la restricción**:
incumple los términos de Binance y puede bloquear la cuenta. Cambiar de región tampoco garantiza
disponibilidad.

## Demo→Real: criterios

Configurables en Escuadrón: mínimo de días en demo, mínimo de operaciones demo, stop-loss y
take-profit obligatorios, credenciales Binance verificadas y (opcional) superar el benchmark
buy-and-hold del mismo activo. El backend revalida todos los criterios y la 2FA.

## Advertencias de seguridad (trading real)

El trading real está **desactivado por defecto** y requiere, antes de habilitarlo:

- Sesión autenticada con 2FA verificada (implementada en `/acceso`; obligatoria en retiros y Demo→Real).
- Claves de Binance con permisos mínimos y **sin permiso de retiro**.
- Despliegue Cloud activo con el cron del motor funcionando y monitorizado.
- Revisión humana de los límites de riesgo y del kill switch.

Deal Maker no promete rentabilidad. No uses fondos reales sin estas salvaguardas.
