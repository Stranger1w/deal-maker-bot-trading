# Lo que te toca a ti

Todo lo que sigue lo tienes que hacer **tú** (porque toca tu cuenta de
Supabase, tu Binance, tu nube y tu máquina). Está en orden: cada paso
depende del anterior.

Si algo no te cuadra, no sigas: dime y lo miramos.

---

## 1. Aplicar las migraciones SQL (lo primero)

Hay **9 migraciones** en `supabase/migrations/`: las tres primeras ya las
tenías aplicadas a mano el 14-oct (están en el repo para que no se pierdan) y
**6 son nuevas y las tienes que aplicar**. **Las aplicas tú** en el SQL
Editor de Supabase (Project → SQL Editor → New query → pegar → Run). Son
idempotentes: si te equivocas y las repites, no se rompe nada.

**Aplica primero las 6 nuevas, en este orden**:

| #   | Fichero                                            | Qué hace                                                         | ¿Imprescindible?                                            |
| --- | -------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | `20261020000000_app_settings_registro_publico.sql` | Interruptor de registro público (cerrado por defecto)            | Sí                                                          |
| 2   | `20261021000000_engine_strategies_por_bot.sql`     | Indicadores y estrategia **por bot**                             | Sí (para usarlos)                                           |
| 3   | `20261022000000_bot_executions_senal.sql`          | Guardar qué señal produjo cada operación                         | Sí (sin esto, el panel de métricas no agrupa por indicador) |
| 4   | `20261023000000_realismo_ejecucion.sql`            | Tope por riesgo, filtro de régimen, límite por par, enfriamiento | Sí (el motor los usa)                                       |
| 5   | `20261024000000_auto_symbol_spread.sql`            | Filtro de spread en el selector automático                       | Opcional                                                    |
| 6   | `20261025000000_engine_cycles.sql`                 | Tabla del diario del motor                                       | Opcional (sin ella el motor va igual, pero no hay diario)   |

Estas tres las tenías ya aplicadas a mano el 14-oct, pero ahora también están
en el repo (para que no se pierdan y para que el código y la base encajen):

| #   | Fichero                                          | Qué hace                                                      |
| --- | ------------------------------------------------ | ------------------------------------------------------------- |
| 1   | `20261014000000_app_settings_admin_only.sql`     | `app_settings` solo para el administrador                     |
| 2   | `20261014100000_engine_sessions_por_usuario.sql` | `engine_sessions` con dueño y **una sesión viva por usuario** |
| 3   | `20261014200000_user_id_not_null.sql`            | `user_id` NOT NULL en las 15 tablas de una fila por usuario   |

Cada fichero lleva su propia **consulta de verificación** al final: pégala
después de aplicarlo y comprueba que sale lo que dice.

> **La app te dice qué falta**: en **Ajustes → Automatización → "Estado de la
> base de datos"** hay una comprobación real del esquema (no una lista fija):
> te marca cada migración como "aplicada" o "falta". Cuando las apliques,
> vuelve a mirarla y se pondrán todas en verde.

> **Ojo con la `20261014100000`**: cambia el índice de "una sesión viva" de
> global a **por usuario**. Si tienes el motor corriendo, para el cron antes
> de aplicarla.

**Comprobación rápida** de que todo está aplicado:

```sql
select count(*) as sesiones_vivas from public.engine_sessions
 where status in ('active','closing');
-- debe ser <= 1 por usuario

select column_name from information_schema.columns
 where table_name = 'bot_executions' and column_name like 'signal%';
-- signal_at, signal_indicators, signal_reason

select column_name from information_schema.columns
 where table_name = 'engine_strategies' and column_name in ('indicator_ids','strategy_id');
```

---

## 2. Probar que todo funciona (antes de tocar dinero)

```powershell
cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
$env:PATH = "C:\Users\Usuario\.bun\bin;" + $env:PATH

# Tipos, lint y tests: deben salir 0 errores y 309 tests en verde
node node_modules\typescript\bin\tsc --noEmit
node node_modules\eslint\bin\eslint.js .
bun test src

# Backtest con los datos que ya tienes descargados (funciona SIN internet)
bun run backtest -- --archivo datos/btcusdt-1h.json --indicadores close_price --capital 1000 --stop 2 --take 4 --aleatorio 30
```

Lo que estás mirando es la **honestidad del sistema**: la estrategia por
defecto pierde (−1,42 %) y solo gana al 3 % de las estrategias aleatorias.
No es un fallo del programa: es el resultado real, y por eso el motor
exige evidencia antes de dejarte pasar un bot a Real.

**Lo que ya está comprobado** (no hace falta que lo repitas):

| Qué                               | Cómo se comprobó                                                     |
| --------------------------------- | -------------------------------------------------------------------- |
| El endpoint del motor             | Llamada real: secreto incorrecto → 401, correcto → 200 y ciclo hecho |
| Las 6 migraciones pendientes      | Comprobación real del esquema (siguen pendientes: aplícalas tú)      |
| Aislamiento entre usuarios        | Con el 2º usuario: solo ve su bot, ni app_settings ni credenciales   |
| Las 11 páginas                    | Abiertas una a una con tu sesión: todas muestran los datos de verdad |
| Configuración del motor (guardar) | Upsert probado con `on_conflict=user_id` (y luego restaurado)        |
| Tipos, lint y tests               | 0 errores, 309 tests en verde                                        |

---

## 3. Configurar el motor (sin esto, el motor no abre posiciones)

En la app, pestaña **Motor** → tarjeta **Configuración del motor**:

1. Elige los **indicadores** (con su descripción al lado).
2. Elige la **estrategia** de tamaño.
3. **Horizonte**: 1, 5 o 15 minutos.
4. **Importe por operación** (base del cálculo de riesgo).
5. _Guardar configuración_.

Sin indicadores no hay señal, y sin señal **el motor no abre nada** (está
avisado en la propia pantalla).

Para que un bot use _sus_ indicadores y _su_ estrategia: en **Mis bots** →
botón **Motor**.

---

## 4. El `.exe` (ya está compilado)

**Ya lo he compilado por ti** con todo el código de arriba:

```
dist\Deal Maker Setup 1.0.0.exe   (107 MB, 19/10/2026)
```

Instálalo y ábrelo: es la app de escritorio (funciona en local, sin
internet). Para **recompilarlo** cuando haya cambios nuevos:

```powershell
cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
$env:PATH = "C:\Users\Usuario\.bun\bin;" + $env:PATH

# 1) El .env hace falta solo durante la compilación (se empaqueta dentro)
Copy-Item "C:\Users\Usuario\secrets\deal-maker.env" ".\.env"

# 2) Compilar (instala electron la primera vez: ~1 min)
bun install
bun run dist:win

# 3) Borrar el .env de la raíz (NUNCA se comitea: está en .gitignore)
Remove-Item ".\.env"

# 4) El instalador está en:
#    dist\Deal Maker Setup 1.0.0.exe
```

> **No uses `bun run build`**: sin `DESKTOP=1` el preset de Nitro cambia a
> `cloudflare-module` y el `.exe` sale roto. Usa siempre `dist:win`.

> El `.exe` **incluye el `.env`** (la service role key y la clave de
> cifrado) dentro de `app.asar`, que se puede extraer. Para uso familiar
> vale; **no lo repartas** con alguien que no sea de confianza.

---

## 5. Poner el motor a correr 24/7 (el cron)

El motor es un endpoint HTTP: `POST /api/public/automation-tick` con la
cabecera `Authorization: Bearer <secreto>`. Ya está hecho y **probado de
extremo a extremo** (llamada real → 200; llamada con secreto equivocado →
401). Solo falta quién lo llama cada minuto.

### Opción A: en tu PC (ya montada, funciona ya)

Como tu PC **ya tiene internet**, el motor puede correr aquí mismo: la app
de escritorio levanta el servidor en `127.0.0.1:3127` y una tarea programada
de Windows lo llama cada minuto.

```powershell
cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading

# Instalar la tarea (llama al motor cada minuto)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\instalar-cron-local.ps1

# Probar un ciclo a mano
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cron-local.ps1

# Quitarla (si la quieres en la nube)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\instalar-cron-local.ps1 -Desinstalar
```

**Ya la he instalado y probado en tu PC**: la tarea "DealMaker Motor" corre
cada minuto (`LastTaskResult 0`) y el motor avanza.

Además **es un watchdog**: si la app se cae (la cierras, se cuelga), el ciclo
siguiente la vuelve a levantar sola. Lo probé matando el servidor: la tarea
lo detectó ("el motor no estaba vivo; lo arranco"), lo levantó y Following cycle ✔

Todo queda anotado en un diario, porque la tarea corre en segundo plano:

```
C:\Users\Usuario\secrets\deal-maker-cron.log
```

> **Límite honesto de esta opción**: el motor depende de **tu PC encendido**.
> Con la sesión iniciada funciona también con la pantalla bloqueada; si
> reinicias el PC y no entras con tu usuario, la tarea no corre hasta que
> entres. Para que corra con el PC encendido y sin sesión iniciada, ejecuta
> el instalador **como administrador** (PowerShell → "Ejecutar como
> administrador"): la tarea queda como SYSTEM y no depende de la sesión.
>
> Y para 24/7 de verdad, sin depender de tu PC, mira la **opción B**.

### Opción B: en la nube (lo único que es 24/7 de verdad)

Despliega la app en un servidor con URL pública (Lovable Cloud, Cloudflare
Workers o un VPS) y pon el cron allí:

| Opción                                 | Coste                                                                  | Nota                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub Actions** (workflow del repo) | Gratis para repos públicos; 2.000 min/mes en privados                  | **Ya montado**: `.github/workflows/tick.yml`. Cada 5 minutos llama al motor con el secreto. Ojo: en el plan gratuito GitHub **aplasta los workflows programados a una ejecución por hora**, asi que úsalo como respaldo, no como motor principal. |
| **Cloudflare Workers + Cron Triggers** | Gratis (10 ejecuciones/día en el plan gratuito, 1/min en Workers Paid) | Es lo natural para un endpoint HTTP y ya lo conocías por Lovable. **Da minuto de verdad**, que es lo que necesita el motor.                                                                                                                       |
| **Un VPS barato** (Hetzner/Contabo)    | ~4 €/mes                                                               | Control total, sin límites de frecuencia.                                                                                                                                                                                                         |
| **Railway / Render / Fly.io**          | Plan gratuito muy limitado o de pago                                   | Con un proceso Node siempre vivo.                                                                                                                                                                                                                 |

> **No he podido verificar los límites actuales de los planes gratuitos**: en
> este entorno no hay acceso al buscador web, y no quiero darte cifras de
> memoria. Cuando tengas internet, confirmamos el límite exacto del servicio
> que elijas antes de montarlo.

### El secreto del cron (ya lo puedes hacer desde la app)

**Ajustes → Automatización → "Motor 24/7 (cron en la nube)" → "Generar
secreto"**. Sale un valor que **solo se muestra una vez**: cópialo y pégalo en
el cron.

El secreto se guarda en `app_settings` (clave `cron_secret`), que solo lee el
administrador. Si prefieres el entorno del servidor, también vale
`LOVABLE_CRON_SECRET` (tiene prioridad).

> Ya hay uno configurado en la base (lo generé al probar el motor). Puedes
> generar otro desde la app cuando quieras: el anterior deja de valer.

### El workflow de GitHub Actions ya está en el repo

`.github/workflows/tick.yml` llama a `POST /api/public/automation-tick` con el
secreto. Para activarlo:

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - `DEAL_MAKER_URL` = `https://tu-dominio/api/public/automation-tick`
   - `DEAL_MAKER_CRON_KEY` = el secreto que copiaste en el paso 1
2. Pestaña **Actions → Motor Deal Maker → Run workflow** para probarlo a mano.

Si el workflow falla, te lo dice en el log de la ejecución (no se traga el
error: responde con el código HTTP y el cuerpo).

**Lo que hay que tener listo** (sea cual sea la opción):

- El secreto en el entorno del cron (nunca en el repo).
- La URL pública de tu app (el `.exe` sirve en local, pero el cron en la nube
  necesita una URL accesible desde internet).
- Un aviso si el motor deja de hablar: el propio motor escribe logs
  estructurados (JSON) y, si configuras `TELEGRAM_BOT_TOKEN` y
  `TELEGRAM_CHAT_ID` en el entorno, te avisa por Telegram de los límites y
  errores críticos.

### Antes de esperar 24/7: el motor necesita indicadores

Ahora mismo **`engine_config` está vacío**: sin indicadores configurados el
motor **no abre posiciones** (a propósito). Configúralos en **Motor →
Configuración** y comprueba que el bot genera señales. El backtest
(`BACKTEST.md`) dice si esa estrategia tiene ventaja: con la configuración
por defecto **no la tiene**, así que úsala para investigar, no para arriesgar
dinero real.

---

## 6. Prueba de aislamiento con dos usuarios (Fase A.6)

Crea un segundo usuario en Supabase (Authentication → Users → Add user) que
vaya a ser el de un familiar. Luego:

```powershell
cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
$env:PATH = "C:\Users\Usuario\.bun\bin;" + $env:PATH

$env:TEST_USUARIO_A = "tu-correo@ejemplo.com";  $env:TEST_PASSWORD_A = "..."
$env:TEST_USUARIO_B = "familiar@ejemplo.com";    $env:TEST_PASSWORD_B = "..."

bun scripts/prueba-aislamiento.ts
```

Comprueba 6 cosas (bots, credenciales, sesiones, auditoría y configuración):
que cada uno ve lo suyo y nada del otro. **Solo lee, no escribe nada.**

Si algo falla: **no abras el registro** ni repartas bots entre usuarios.

---

## 7. Modelo de alta de usuarios (tú decides)

El registro público está **cerrado por defecto** (interruptor en
`app_settings.public_signup_enabled` + variable `PUBLIC_SIGNUP`). Cuando
termines la prueba de aislamiento, decide cómo entran los familiares:

- **Invitación** (lo más limpio): cada usuario se crea a mano en Supabase y
  se le da de alta en `app_admins`/tabla de usuarios. El registro sigue
  cerrado.
- **Lista blanca**: los correos permitidos en `app_settings` y una server fn
  que solo deje registrarse a esos.
- **Registro abierto**: activa el interruptor y acepta que cualquiera pueda
  crear una cuenta (con RLS, cada uno vería solo lo suyo, pero entra
  cualquiera).

Mi recomendación: **invitación**. Es una app personal y familiar; abrir el
registro no aporta nada y te obliga a vigilar la tabla de usuarios.

---

## 8. Fase 7 (solo cuando D y E den resultados y tú lo autorices)

Re-cifrar las credenciales reales de Binance con la clave vigente
(`CREDENTIALS_ENCRYPTION_KEY`):

1. La fila de producción de `binance_credentials` está **huérfana** (cifrada
   con la clave vieja de Lovable, irrecuperable): hay que volver a guardar
   las API keys desde la UI (la app las cifra con la clave nueva).
2. Comprobar con **Probar** en `/binance` → `connection_status = ok`.
3. Decidir qué hacer con `binance_credentials_backup_qa` (contiene claves
   cifradas con la clave vieja) y con los bots QA.
4. **Apagar flags** de envío al terminar: `allow_real_trading`,
   `allow_live_orders`, `engine_enabled`.

El procedimiento ya está probado con credenciales de testnet (SQL → base de
datos → UI → `binancePing` → `connection_status='ok'`).

---

## 9. Lo que NO tienes que hacer

- No tocar `binance_trading_env` a `production` sin un motivo claro.
- No encender `allow_real_trading` / `allow_live_orders` por tu cuenta.
- No tocar el `.env` a mano: va fuera del repo (`C:\Users\Usuario\secrets`).
- No hacer `git push --force` ni reescribir commits ya subidos (Lovable se
  sincroniza desde `main`).
