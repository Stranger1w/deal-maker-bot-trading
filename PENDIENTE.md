# Pendientes

Estado verificado el **20/10/2026** (contra la base de datos y la app, no de
memoria). Todo lo de la sección 1 es tuyo; lo de la 2 son decisiones; lo de
la 3 son extras.

> ✅ **Las 8 migraciones ya están aplicadas** (20-oct). La app lo confirma:
> _Ajustes → Automatización → "Estado de la base de datos"_ → 8/8 en verde.
> La auditoría de seguridad tambien: con la clave pública sin sesión, todo
> devuelve 401; con la sesión de otro usuario, 403 (y `app_settings` le da 0
> filas por no ser admin).

> 🆕 **Hay una migración nueva sin aplicar** (la 9, la de la comisión del
> pool): `supabase/migrations/20261028000000_mineria_comision_pool.sql`.
> La app **funciona sin ella** (usa 0 % de comisión y avisa), pero sin ella tu
> pool no descuenta su parte del cálculo.

---

## 0. CÓMO RESOLVER CADA PENDIENTE (paso a paso)

### A. Las 8 migraciones ✅ HECHO (20-oct)

Las 8 están aplicadas y la app lo confirma: _Ajustes → Automatización →
"Estado de la base de datos"_ → 8/8 en verde.

Si algún dia hay que volver a aplicarlas (por ejemplo si recreas la base), el
fichero sigue en `supabase/migrations/APLICAR-LAS-8-EN-UNO.sql`: un solo
pegote, una sola transacción (o entran todas o ninguna), idempotente.

Comprobado después de aplicarlas:

- La **cache local** ya funciona: 1000 velas y 1000 lecturas de traders
  guardadas (el sandbox mide sin volver a descargar).
- El **entrenamiento** de mineros ya se guarda: _tjada → 1,61 MH/s con 4
  hilos, x1,99_.
- La **precisión** del dinero ya es la buena: las ganancias se guardan como
  0,00000002 USD/día en vez de 0,00.
- El motor de minería reparte la capacidad real: 225 KH/s por equipo (los
  4 equipos con 1 hilo cada uno sobre 4 núcleos).
- La **seguridad** aguanta: con la clave pública sin sesión, todo devuelve
  401; con la sesión de otro usuario, 403.

### B. Los indicadores del motor (5 minutos)

> ⚠ **Ojo: con los 6 indicadores que tienes ahora el motor NO ABRE NADA.**
> No es un fallo: el motor exige que **todos** los indicadores coincidan a la
> vez (si uno dice compra y otro venta, no hay señal). Con 6 indicadores
> eso no pasa: medido sobre 2.000 velas reales de Q1-2025, **0 operaciones**.
> El campo de entrenamiento te lo dice ahora mismo, indicador por indicador:
> `close_price` 470 oper. (-4,0 %), `stochastic` 223 (-2,13 %), `bollinger`
> 112 (-1,34 %), `rsi` 89 (-1,13 %), `ai_indicator` 0.
> **Empieza con 1 o 2 indicadores** (Precio de cierre, o Precio + RSI).

1. _Motor → Configuración del motor_.
2. Empieza por **un solo indicador** (Precio de cierre) y la estrategia
   _Fija_, horizonte 15 min, importe 20 USDT → **Guardar configuración**.
3. Mídelo antes de dejarlo correr:
   ```powershell
   cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
   $env:PATH = "C:\Users\Usuario\.bun\bin;" + $env:PATH
   bun run backtest -- --simbolo BTCUSDT --intervalo 1h --velas 3000 --indicadores close_price --capital 1000 --stop 2 --take 4 --walk-forward 4 --aleatorio 30
   ```
4. Si el resultado no aguanta (walk-forward con bloques negativos, o no
   gana a las aleatorias), **no añadas más indicadores**: casi nunca mejora.
5. Cuando te convence → _Motor → Iniciar 24/7_ (abre la sesión del motor).

> Los bots se tienen que poner en marcha uno a uno: _Mis bots → botón del
> bot → Iniciar_. El motor solo opera los que estén `running` y con
> automatización activada.

### C. El motor 24/7 (3 opciones, todas montadas)

| Opción                        | Qué haces                                                                                                               | Cuándo                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **A. Tu PC**                  | Nada. Ya corre (tarea de Windows, cada minuto, con watchdog).                                                           | Si el PC está siempre encendido                |
| **B. Tu PC sin sesión**       | Ejecuta **como administrador**: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\instalar-cron-local.ps1` | Si quieres que arranque solo al encender el PC |
| **C. En la nube (24/7 real)** | Ver abajo                                                                                                               | Si quieres que no dependa de tu PC             |

**Opción C, paso a paso** (la que de verdad no depende de tu PC):

1. Publica la app. Ya está preparado: `wrangler.toml` está en el repo.
   ```powershell
   cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
   $env:PATH = "C:\Users\Usuario\.bun\bin;" + $env:PATH
   bunx wrangler login          # abres el navegador y entras en tu cuenta
   bun run deploy:cloud         # compila y publica
   ```
   Te dará una URL tipo `https://deal-maker.<tu-usuario>.workers.dev`.
2. Mete las variables de entorno **como secretos** (nunca en el repo):
   ```powershell
   bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   bunx wrangler secret put CREDENTIALS_ENCRYPTION_KEY
   bunx wrangler secret put SUPABASE_PUBLISHABLE_KEY
   bunx wrangler secret put LOVABLE_CRON_SECRET
   ```
   (y las que falten: `SUPABASE_URL`, `SUPABASE_PROJECT_ID`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`).
3. El cron que llama al motor cada minuto: en el VPS/Railway, un cron del
   sistema; en Cloudflare, hace falta un handler `scheduled` (esta app no lo
   exporta todavía: lo digo en `wrangler.toml`).
4. Copia el secreto en _Ajustes → Automatización → Motor 24/7_ (botón
   **Generar secreto**) y pégalo en el cron.

**Límites verificados** (docs oficiales, oct-2026):

- **Cloudflare Workers gratis**: 100.000 peticiones/día, **10 ms de CPU por
  cron trigger**, 5 cron triggers por cuenta. El motor de trading cabe
  (es casi todo llamadas de red, que no cuentan como CPU); el **benchmark de
  minería no** (es CPU pura). Plan de pago (5 $/mes): 30 s de CPU por cron →
  ya cabe todo.
- **GitHub Actions**: el intervalo mínimo es **5 minutos**, y el workflow
  "can be delayed... some queued jobs may be dropped". Es un **respaldo**,
  no un motor de minuto. En repos públicos se desactiva solo si hay 60 días
  sin actividad.

### D. El dinero (solo cuando lo tengas claro)

- **Real trading**: `allow_real_trading` y `allow_live_orders` están
  apagados y el entorno es testnet. Dime "ya está" y te los enciendo; hazlo
  solo con la compuerta de promoción satisfied (P&L real positivo, drawdown
  dentro del límite, mínimo de operaciones y superar al mercado).
- **Fase 7**: re-cifrar las credenciales y apagar flags definitivos. Dime
  cuándo y lo hacemos.
- **¿Minamos?** El enjambre está encendido y dice la verdad: **−0,70 USD/día**.
  Si no lo quieres: _Minería → Detener enjambre_.

### E. Los extras (pásame esto y los hago)

| Extra                  | Qué necesito                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Avisos por Telegram    | `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (en el entorno del servidor)                          |
| Correo de los reportes | Un dominio con el remitente verificado (o te dejo el aviso de "pendiente de dominio")           |
| Red de KAS para minar  | Hash rate de la red, recompensa por bloque y tiempo de bloque (los tienes en la web de tu pool) |
| Cron propio en la nube | Tu VPS/Railway/Cloudflare (o dime cuál y te doy los ficheros)                                   |

---

## 1. Lo único que bloquea: 8 migraciones SQL

Las aplicas tú en **Supabase → SQL Editor → New query → pegar → Run**. Son
idempotentes (si te equivocas y las repites, no se rompe nada). **En este
orden**:

| #   | Fichero (`supabase/migrations/`)                   | Qué pasa si NO la aplicas                                                                              |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | `20261020000000_app_settings_registro_publico.sql` | El registro de usuarios queda cerrado por defecto (va bien)                                            |
| 2   | `20261021000000_engine_strategies_por_bot.sql`     | Todos los bots usan la configuración de la plataforma, no la suya                                      |
| 3   | `20261022000000_bot_executions_senal.sql`          | El panel de métricas no agrupa por indicador                                                           |
| 4   | `20261023000000_realismo_ejecucion.sql`            | El motor no calcula el tamaño por riesgo ni filtra regímenes                                           |
| 5   | `20261024000000_auto_symbol_spread.sql`            | El selector automático no descarta los pares con spread alto                                           |
| 6   | `20261025000000_engine_cycles.sql`                 | No hay diario del motor (lo demás va igual)                                                            |
| 7   | `20261026000000_mineria_real.sql`                  | La minería va con cifras básicas: **no guarda** el hash rate real, el neto, la luz ni el entrenamiento |
| 8   | `20261027000000_cache_mercado.sql`                 | El sandbox **vuelve a descargar** los datos cada vez (funciona igual, pero sin cache)                  |
| 9   | `20261028000000_mineria_comision_pool.sql` 🆕      | Tu pool **no descuenta su comisión** (0 % por defecto) ni se guarda el hash rate sostenido             |

**Cómo saber si están**: _Ajustes → Automatización → "Estado de la base de
datos"_ → la app comprueba el esquema real y te marca cada una. Cuando
apliques la 7 y la 8, la minería y el sandbox cambiarán de behave.

> Ojo con la 7: además de columnas, **cambia la precisión** de
> `estimated_daily_earnings` de `numeric(12,2)` a `numeric(24,10)`. Con 2
> decimales la ganancia real de un PC de casa (0,0000000066 USD/día) se
> guardaba como 0,00.

> La 9 es la más pequeña de todas (dos columnas). **Si te da miedo aplicarla,
> no la apliques**: la app funciona igual, solo que tu pool se queda el 0 %.

---

## 2. Decisiones que son tuyas

### 2.1 ¿Dónde vive el motor?

Ahora mismo el motor **ya corre en tu PC**: la tarea programada de Windows
"DealMaker Motor" lo llama cada minuto (con watchdog: si la app se cae, la
levanta). Funciona mientras el PC esté encendido.

- **PC tal cual**: nada más que hacer. Límite: si apagas el PC, el motor
  calla.
- **Como SYSTEM** (para que corra con el PC encendido sin sesión iniciada):
  ejecuta el instalador **como administrador**:
  ```powershell
  cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\instalar-cron-local.ps1
  ```
- **En la nube (24/7 de verdad)**: hace falta tu cuenta (Lovable Cloud,
  Cloudflare o un VPS). Yo dejo listos el workflow de GitHub Actions
  (`.github/workflows/tick.yml`, llama a los dos motores) y el resto es
  desplegar.

### 2.2 Los indicadores del motor

`engine_config` está **vacío**: sin indicadores el motor **no abre
posiciones** (a propósito). Se eligen en _Motor → Configuración del motor_
(indicadores, estrategia, horizonte, importe) → _Guardar configuración_.

> El backtest con la configuración por defecto da **−1,42 %** y solo gana al
> 13 % de las estrategias aleatorias: mídelo antes de arriesgar nada.

### 2.3 El dinero

- **Real trading**: `allow_real_trading` y `allow_live_orders` están
  **apagados** y el entorno es **testnet**. Encenderlos es irreversible y
  **no lo hago sin que me lo digas**.
- **Fase 7** (re-cifrar las credenciales con la clave nueva y apagar flags
  definitivos): necesita tu autorización.
- **¿Minamos?** El enjambre está encendido: te dice la verdad,
  **−0,70 USD/día** (la luz se come lo que se gana). Si no lo quieres
  corriendo: _Minería → Detener enjambre_.

---

## 3. Extras (cuando haya tiempo)

- **Telegram**: pásame `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (en el
  entorno del servidor, nunca en el repo) y te aviso por Telegram de los
  límites y errores críticos del motor.
- **Correo**: los reportes diario/semanal salen sin enviar porque falta un
  dominio de envío verificado.
- **Minería, moneda KAS**: no hay API pública fiable para su red, así que
  sale "sin datos de la red". Si me pegas los números de tu pool (hash rate
  de la red, recompensa por bloque y tiempo de bloque) los meto en el equipo
  y ya calcula.
- **Datos de miners en la nube**: el hash rate se mide en la máquina donde
  corre la app. Si el motor vive en la nube, el hash rate medido será el de
  la nube, no el de tu PC. Para que el campo de entrenamiento mida TU
  equipo, la app de escritorio es la que tiene que estar abierta.

---

## 4. Lo que ya está hecho (y comprobado)

| Qué                        | Cómo se comprobó                                                                |
| -------------------------- | ------------------------------------------------------------------------------- |
| El endpoint del motor      | Secreto incorrecto → 401; correcto → 200 y ciclo hecho                          |
| El endpoint de minería     | 4 equipos actualizados con hash rate medido                                     |
| Las 11 páginas             | Abiertas una a una con tu sesión: muestran los datos de verdad                  |
| Credenciales de Binance    | **Conexión verificada contra testnet** (HTTP 200)                               |
| Región                     | Salida por MIA (DO), Binance accesible, sin restricción geográfica              |
| Aislamiento entre usuarios | Con tu 2º usuario: solo ve su bot, ni app_settings ni credenciales              |
| El cron local              | Corriendo cada minuto, con watchdog                                             |
| El hash rate               | **Real**: SHA-256 de verdad. Medido: 1 hilo 284 KH/s → 4 hilos 673 KH/s (x2,37) |
| Las monedas y los pools    | Listas reales leídas en vivo (2miners, nanopool, Binance)                       |
| Los datos simulados        | **Cero tablas con datos de ejemplo** (auditoría de `is_demo` completa)          |
| La app                     | `tsc` 0, **375 tests** en verde, eslint sin errores, `.exe` compilado           |

### Lo que Changed y hay que saber

- **El campo de entrenamiento de mineros** mide SHA-256 real con workers
  reales y reparte la capacidad real de la máquina según los hilos de cada
  equipo. Hasta que apliques la migración 7, la medición **se enseña pero no
  se guarda** (la app lo avisa).
- **El enjambre cuenta las ganancias** (lo que da la red), no el neto: el
  coste de la luz se informa aparte, en su propia línea, para que el número
  no engañe.
- **El sandbox no mide de cero**: usa la cache local (migración 8) y las
  velas vienen de 7 plataformas (Binance, Bybit, OKX, Hyperliquid, Kraken,
  Coinbase, 2miners/nanopool para los datos de traders).
- El botón del sandbox ya no dice «simulación acelerada»: mide con velas reales.
- **El sandbox mide el periodo que eliges** (antes medía los últimos minutos
  mientras decía medir el rango pedido: era un fallo real, ya corregido). Además
  compara con **20 estrategias con la señal al azar** y te dice el percentil:
  «¿gana al 60 % de las aleatorias o no se distingue del azar?».
- **El sandbox mide el periodo que eliges** (antes medía los últimos minutos
  mientras decía medir el rango pedido: era un fallo real, ya corregido). Además
  compara con **20 estrategias con la señal al azar** y te dice el percentil:
  «¿gana al 60 % de las aleatorias o no se distingue del azar?».
- **El hash rate que ves es el real de tu máquina** (SHA-256 de verdad con
  workers reales), medido en dos rondas y quedándose con la mejor: si el PC
  está ocupado (una compilación, el antivirus) la medición baja y ya no
  envenena el cáche 10 minutos. Antes pasaba: 36 KH/s en vez de 1,6 MH/s, y
  las ganancias salían 45 veces más bajas de lo real.
- **La comparativa de minería acepta cualquier moneda**: en _Mínería →
  «Compara monedas con TU equipo» puedes elegir la que quieras (las
  listas reales, leídas en vivo de los pools y de Binance) y ver la cuenta con
  TU hash rate: lo que da, lo que se lleva el pool y lo que cuesta la luz.
- **El sandbox dice por qué no hay resultado**: si con tus indicadores no se
  abre ni una operación, mide cada uno por separado y te lo enseña. Antes
  solo decía «no hay resultado que mostrar» y te dejabas sin saber.
- **Cada bot se mide con SUS indicadores**, no con los del primero (antes todos
  los bots se medían con la configuración del primero de la lista).
- **La minería ya descuenta la comisión de tu pool** (la puedes poner en
  _Minería → el botón de engranaje de cada equipo_) y usa el hash rate
  **sostenido** (10 s, no el pico de 1,5 s): minar es de horas, y el PC se calienta.
- **El copy trading** (seguir a los traders grandes) está medido con datos
  reales: −0,22 % (percentil 10 % de la referencia aleatoria). No hay
  ventaja demostrada, y la app lo dice.

---

## 5. Mapa de los ficheros

- **Tú**: este fichero y `PARA-TI.md` (paso a paso).
- **Yo**: el código, los tests y las migraciones (`supabase/migrations/`).
- **Medir estrategias**: `BACKTEST.md`.
- **Estado por fases**: `roadmap.md`.
