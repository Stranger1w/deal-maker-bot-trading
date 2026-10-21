# Lo que te toca a ti

> **Antes de nada, mira [`PENDIENTE.md`](./PENDIENTE.md)**: es la lista corta
> y actualizada de lo que falta (con el estado verificado de hoy). Este
> documento es la guía paso a paso.

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
| 7   | `20261026000000_mineria_real.sql`                  | Hash rate real, ganancia neta y precio de la luz por equipo      | Sí (para la minería; sin ella va con las cifras básicas)    |
| 8   | `20261027000000_cache_mercado.sql`                 | Cache local de velas y de datos de traders (no medir cada vez)   | Sí (sin ella se descarga cada vez, pero funciona)           |

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

### Qué hace ahora la minería (para que sepas qué esperas)

La minería **ya no es de adorno**: mide el hash rate real de tu PC (SHA-256 de
verdad), reparte ese hash rate entre los equipos que estén minando (todos
usan el mismo CPU), saca la recompensa de la red de datos vivos
(mempool.space) y el precio de Binance, y **resta el coste de la luz**.

En esta máquina el resultado es: **233-295 KH/s, 0,000000008 USD al día de
bruto y 0,70 USD al día de luz → −0,70 USD al día**. O sea: en un PC de casa
minar no sale a cuenta, y la app te lo dice con tus números, no con una
estimación optimista. El botón **"Medir ahora"** repeatsa la medición cuando
quieras.

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

## 5. El motor 24/7: DESCARTADO por ahora

> **Decisión tuya (20-oct): el motor 24/7 automático se queda fuera por
> ahora.** No tienes cuenta de nube, así que no hay 24/7 real. Ya no hay
> nada corriendo solo:
>
> - La tarea programada de Windows "DealMaker Motor" está **desinstalada**
>   (antes llamaba al motor cada minuto).
> - El workflow `.github/workflows/tick.yml` (el reloj de GitHub Actions)
>   está **eliminado**.
> - La app ya no enseña la tarjeta "Motor 24/7 (cron en la nube)" ni la
>   pestaña 24/7: el motor solo se abre con un **temporizador** desde
>   _Motor → Control de la sesión_.
>
> **Lo que sigue vivo**: el motor, el backtest, la minería y todo lo demás.
> El motor funciona **mientras la app esté abierta** y hayas iniciado una
> sesión con temporizador (15 min, 1 h, 6 h o los minutos que quieras).
>
> **Para volver a activarlo** (cuando tengas cuenta de nube), todo sigue
> en el repo:
>
> ```powershell
> # El cron local de tu PC (vuelve a instalarlo)
> powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\instalar-cron-local.ps1
> ```
>
> Y para el 24/7 de verdad: desplegar la app (Lovable Cloud, Cloudflare o
> un VPS) y poner un cron allí que llame a
> `POST /api/public/automation-tick` con la cabecera
> `Authorization: Bearer <secreto>`. El endpoint sigue funcionando; lo que
> falta es quién lo llama.

### El secreto del cron

El endpoint sigue vivo, así que el secreto se puede volver a generar:
está en `app_settings` con la clave `cron_secret` (o en el entorno del
servidor como `LOVABLE_CRON_SECRET`). Se genera con
`scripts/cron-local.ps1` o desde el servidor; la app ya no lo muestra
porque el 24/7 está descartado.
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

## 8. Fase 7 — HECHO (21-oct)

La has autorizado y ya esta hecha. Lo que se hizo:

1. **Clave de cifrado rotada**: las credenciales de Binance se descifraron con
   la clave vieja y se volvieron a cifrar con una **clave nueva** (32 bytes
   aleatorios). La nueva esta en `C:\Users\Usuario\secrets\deal-maker.env`
   (`CREDENTIALS_ENCRYPTION_KEY`) y dentro del `.exe` recien compilado.
   **Comprobado**: la conexion contra Binance **testnet** responde HTTP 200 con
   las credenciales cifradas con la clave nueva.
2. **Llave de dos claves** en el codigo: `CREDENTIALS_ENCRYPTION_KEY` (la que
   cifra) y `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS` (la vieja, que solo sirve
   para descifrar). Si alguna vez hay que volver atras, se pone la clave
   vieja en esa variable y la app sigue leyendo lo que habia.
3. **Apagado lo que sobra**:
   - `app_settings.cron_secret` **borrado**: el endpoint publico del motor
     (`/api/public/automation-tick`) ahora rechaza TODAS las llamadas. Con el
     24/7 descartado no hace falta y era una puerta abierta.
   - `allow_real_trading` = **false**, `allow_live_orders` = **false**,
     `binance_trading_env` = **testnet**, `public_signup_enabled` = **false**.
   - El motor sigue con `engine_enabled` = true, pero **sin sesion no abre
     posiciones**: por eso el panel te avisa.

> **Reinstala el `.exe`**: el instalador lleva la clave nueva dentro. Si usas
> el `.exe` viejo, no podra descifrar las credenciales (y la pagina de
> Binance te dira que no hay clave guardada).

### Si algun dia hay que rotar la clave otra vez

1. Genera una clave nueva (32 bytes en base64) y ponla en
   `CREDENTIALS_ENCRYPTION_KEY` del entorno; deja la vieja en
   `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`.
2. Descifra y vuelve a cifrar las filas de `binance_credentials` con la
   nueva (el texto plano no sale del servidor).
3. Verifica la conexion contra testnet antes de borrar la vieja.
## 10. Correo — HECHO (21-oct)

Ya esta todo:

- El interruptor esta en _Seguridad > Notificaciones por correo_: activas y
  desactivas los avisos cuando quieras.
- Van al **correo con el que creaste la cuenta**
  (`andrew.paulino.reyes@gmail.com`). Ya esta activado.
- El proveedor (Resend) esta configurado con tu clave: los limites de
  riesgo, las ordenes rechazadas y los reportes **llegan a tu Gmail**.
  Probado con un correo real y con un aviso de prueba.

La clave esta en `C:\Users\Usuario\secrets\deal-maker.env` (
`RESEND_API_KEY=...`) y dentro del `.exe` compilado.

> **El `.exe` lleva las claves dentro** (Supabase, la de cifrado y la del
> correo): no lo compartas con nadie que no seas tu.

### Si algun dia hay que cambiar el proveedor o la clave

```powershell
# Cambiar la clave en el fichero de secretos y reiniciar la app
(Get-Content "C:\Users\Usuario\secrets\deal-maker.env") -replace
  "RESEND_API_KEY=.*", "RESEND_API_KEY=re_NUEVA" |
  Set-Content "C:\Users\Usuario\secrets\deal-maker.env"
```
## 9. Lo que NO tienes que hacer

- No tocar `binance_trading_env` a `production` sin un motivo claro.
- No encender `allow_real_trading` / `allow_live_orders` por tu cuenta.
- No tocar el `.env` a mano: va fuera del repo (`C:\Users\Usuario\secrets`).
- No hacer `git push --force` ni reescribir commits ya subidos (Lovable se
  sincroniza desde `main`).
