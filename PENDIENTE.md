# Pendientes

Estado verificado el **20/10/2026** (contra la base de datos y la app, no de
memoria). Todo lo de la sección 1 es tuyo; lo de la 2 son decisiones; lo de
la 3 son extras.

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

**Cómo saber si están**: _Ajustes → Automatización → "Estado de la base de
datos"_ → la app comprueba el esquema real y te marca cada una. Cuando
apliques la 7 y la 8, la minería y el sandbox cambiarán de behave.

> Ojo con la 7: además de columnas, **cambia la precisión** de
> `estimated_daily_earnings` de `numeric(12,2)` a `numeric(24,10)`. Con 2
> decimales la ganancia real de un PC de casa (0,0000000066 USD/día) se
> guardaba como 0,00.

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
| La app                     | `tsc` 0, **362 tests** en verde, eslint sin errores, `.exe` compilado           |

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
- **El copy trading** (seguir a los traders grandes) está medido con datos
  reales: −0,22 % (percentil 10 % de la referencia aleatoria). No hay
  ventaja demostrada, y la app lo dice.

---

## 5. Mapa de los ficheros

- **Tú**: este fichero y `PARA-TI.md` (paso a paso).
- **Yo**: el código, los tests y las migraciones (`supabase/migrations/`).
- **Medir estrategias**: `BACKTEST.md`.
- **Estado por fases**: `roadmap.md`.
