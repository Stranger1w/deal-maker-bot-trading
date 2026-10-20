# Pendiente para mañana

Estado a día **20/10/2026** (verificado contra la base de datos y la app, no
supuesto). Todo lo que está aquí **depende de ti**, no de código.

Hay una cosa que sí puedo hacer yo cuando me digas: montar el despliegue en
la nube, conectar la app con más fuentes o rematar la interfaz.

---

## 1. Aplicar las 7 migraciones SQL (lo primero, 15 min)

En Supabase → **SQL Editor → New query** → pega → **Run**. Son idempotentes:
si te equivocas y las repites, no se rompe nada. **En este orden**:

| #   | Fichero (en `supabase/migrations/`)                | Qué pasa si no la aplicas                                    |
| --- | -------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `20261020000000_app_settings_registro_publico.sql` | El registro de usuarios queda cerrado por defecto (va bien)  |
| 2   | `20261021000000_engine_strategies_por_bot.sql`     | Cada bot usa la configuración de la plataforma, no la suya   |
| 3   | `20261022000000_bot_executions_senal.sql`          | El panel de métricas no agrupa por indicador                 |
| 4   | `20261023000000_realismo_ejecucion.sql`            | El motor no calcula el tamaño por riesgo ni filtra regímenes |
| 5   | `20261024000000_auto_symbol_spread.sql`            | El selector automático no descarta los pares con spread alto |
| 6   | `20261025000000_engine_cycles.sql`                 | No hay diario del motor (lo demás va igual)                  |
| 7   | `20261026000000_mineria_real.sql`                  | La minería va con cifras básicas, sin hash rate real ni neto |

**Cómo saber si están**: _Ajustes → Automatización → "Estado de la base de
datos"_. La app comprueba el esquema real y te marca cada una. Cuando estén
las 7, todas en verde.

> Cada fichero trae su propia consulta de verificación al final. Si te
> aparece un error, pásamelo tal cual y lo miramos.

---

## 2. Configurar los indicadores del motor (10 min)

**Motor → Configuración del motor**: elige indicadores, estrategia, horizonte
e importe → **Guardar configuración**.

Ahora mismo `engine_config` está **vacío**: sin indicadores el motor **no
abre posiciones** (a propósito). Hasta que lo configures, el motor da ciclos
completos pero no opera.

> El backtest con la configuración por defecto da **−1,42 %** y solo gana al
> 13 % de las estrategias aleatorias: úsalo para investigar, no para arriesgar
> dinero real.

---

## 3. Decidir dónde vive el motor (10 min, o déjalo así)

Ahora mismo el motor **ya corre en tu PC**: tarea programada de Windows
("DealMaker Motor") cada minuto, con watchdog (si la app se cae, la levanta).
Y el de minería también entra por ahí.

| Opción                    | Qué entails                                                                                                                               | Cuándo                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Dejarlo en el PC**      | Nada más. Funciona mientras el PC esté encendido y con tu sesión iniciada (también con la pantalla bloqueada).                            | Si el PC está siempre encendido                                   |
| **SYSTEM (sin sesión)**   | Ejecuta el instalador **como administrador**: `.\scripts\instalar-cron-local.ps1`                                                         | Si quieres que corra con el PC encendido pero sin sesión iniciada |
| **Nube (24/7 de verdad)** | Desplegar la app con URL pública + cron allí (Cloudflare Workers da minuto real; GitHub Actions en plan gratuito lo aplasta a 1 vez/hora) | Si quieres que no dependa de tu PC                                |

**Para la nube necesito tu cuenta**: Lovable Cloud, Cloudflare o un VPS. Yo
dejo el workflow de GitHub Actions listo (`tick.yml`, llama a los dos motores:
trading y minería).

---

## 4. Decisiones sobre el dinero (solo tú)

- **¿Minamos?** Ahora el enjambre está **encendido**: te mide ~100 KH/s por
  equipo y te dice la verdad, **−0,70 USD/día** (la luz se come lo que se
  mina). Si no lo quieres corriendo: **Minería → Detener enjambre**.
- **¿Real trading?** `allow_real_trading` y `allow_live_orders` están
  **apagados** y el entorno es **testnet**. Encenderlos es irreversible y
  **no lo hago sin que me lo digas**.
- **Fase 7** (re-cifrar las credenciales con la clave nueva y apagar flags):
  necesita tu autorización explícita.

---

## 5. Extras (opcionales, cuando haya tiempo)

- **Telegram**: si me pasas `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (en el
  entorno del servidor, nunca en el repo), te aviso por Telegram de los
  límites y errores críticos del motor.
- **Correo**: los reportes diario/semanal salen sin enviar porque falta un
  dominio de envío verificado.
- **Minería, moneda KAS**: no hay API pública fiable para su red, así que
  sale "sin datos de la red". Si me pegas los números de tu pool (hash rate
  de la red, recompensa por bloque y tiempo de bloque) los meto en el worker
  y ya calcula.
- **Campo de entrenamiento**: ya no inventa cifras (ver más abajo). Falta
  decidir si lo dejamos solo para Trading o lo ampliamos a comparar monedas
  con tus números reales de minado.

---

## 5-bis. Lo que he cambiado y conviene que sepas

**El "Campo de entrenamiento" fabricaba los resultados.** Generaba el retorno,
el drawdown y el win rate con `Math.random()` (y lo vestía de "simulación
acelerada ×25"). Los números que había en la base (8,29 %, 16,62 %, 23,41 %…)
**no venían de ninguna simulación**: eran azar con apariencia de resultado.

Ahora:

- Descarga las **velas reales de Binance** y corre el **mismo motor de
  backtest** que el CLI (`bun run backtest`) y que el motor en vivo, con sus
  costes (0,1 % + 0,05 % de slippage por lado) y el tamaño de la estrategia.
- Si no hay datos, **no se inventa**: el bot queda sin evaluar y se explica por
  qué.
- Añade el aviso que faltaba: en un mercado a la baja, "perder menos que
  comprar y mantener" **no es tener ventaja** (los dos pierden).
- He borrado los 8 runs inventados y reiniciado las cifras de los 3
  sandboxes (ahora están a `null` y dicen que hay que lanzarlos).

Medido de verdad en tu sandbox (2025-01-01 → 2025-03-31, BTC cayó un 13 %):
los bots pierden entre **−0,85 % y −4,16 %**.

### Los datos ya no se miden cada vez (nuevo)

El sandbox y el backtest leen de una **cache local** (`market_candles` y
`trader_metrics`): solo se descarga lo que falta. Y los datos vienen de
**varias plataformas**, no solo de Binance:

| Plataforma      | Mercado | ¿Datos de traders?                             |
| --------------- | ------- | ---------------------------------------------- |
| Binance Futures | futuros | Sí (posiciones de las cuentas grandes y flujo) |
| Binance         | spot    | No                                             |
| Bybit           | futuros | No                                             |
| OKX             | futuros | No                                             |
| Hyperliquid     | futuros | No                                             |
| Kraken          | spot    | No                                             |
| Coinbase        | spot    | No                                             |

En _Mis bots → Campo de entrenamiento → "Datos y plataformas"_ ves el mismo
par en los 7 exchanges y cuánto se diferencian entre sí (ahora mismo: ±0,07 %,
o sea que ninguno se está desviando del resto). Con el botón **"Actualizar
datos"** se llena la cache.

> Los datos de traders (posicionamiento de las cuentas grandes) **solo los
> publica Binance Futures**: las demas plataformas se usan para precios.

### El hash rate es real, y el campo de entrenamiento lo mide en serio

El hash rate **no es simulado**: se mide con SHA-256 de verdad (el mismo
algoritmo que usan los mineros de CPU), contando los hashes reales. Pero
hasta ahora se medía en **un solo núcleo** de tu i7-5600U (4 núcleos), así
que la app se quedaba en ~300 KH/s cuando la máquina da bastante más.

Ahora hay un **campo de entrenamiento de mineros** en _Minería_:

- Mide la curva real (1, 2, 3 y 4 hilos) con workers reales.
- Cada equipo guarda sus hilos y el motor **reparte la capacidad real** de la
  máquina según los hilos de cada uno (nunca más de lo que la máquina da).
- Medido en tu PC: 284 → 557 → 641 → **673 KH/s** (x2,37 que con un hilo).

> Hasta que apliques la migración `20261026000000` (que añade la tabla
> `mining_entrenamientos` y las columnas `hilos` / `hash_rate_max`), la
> medición se enseña pero **no se guarda**: la app te lo avisa.

### Las monedas y los pools ya no se escriben a mano

En _Minería → Agregar worker_, la **moneda** y el **pool** son listas con datos
reales, leídos en el momento:

- **Monedas minables con CPU (23)**: sacadas del sitemap de 2miners y de la
  configuración de nanopool (son las listas reales de esos pools), con su
  nombre de verdad ("Bitcoin", "Zcash", "Ravencoin"…) y en qué pool se minan.
- **Monedas del mercado (512)**: el `exchangeInfo` de Binance.
- **Pools (12)**: 2miners, Nanopool, ViaBTC, HeroMine, WoolyPooly, Zpool,
  F2Pool, MiningPool.io, ProHashing, Flexpool, Foundry USA y LuckyMining, cada
  uno con su web. De 2miners y nanopool se ven las monedas que ofrecen en
  vivo; de los demás, la app no se inventa qué monedas tienen y te enlaza a
  su web.

Si usas un pool privado, eliges "Otro pool (escribirlo)" y lo escribes.

### El histórico también era de ejemplo (arreglado)

`market_prices` (272 filas "demo-seed": BTC a 70.954 cuando el mercado estaba
a 82.700) y `bot_performance_history` (272 curvas inventadas) estaban
sembradas con datos de ejemplo. Y no era solo decoración: **los precios de
ejemplo se usaban para el benchmark de comprar-y-mantener del gate de
promoción**, o sea, para decidir si un bot se merecía dinero real con números
falsos.

Ahora:

- Los precios se descargan de **Binance** (400 días reales por par) y la
  fuente queda escrita en cada fila.
- Las curvas de los bots se rehacen con sus **ejecuciones reales**. Un bot que
  no ha operado no tiene curva (antes se le dibujaba una línea plana).
- El mantenimiento diario (el cron) lo refresca solo, y hay un botón
  **"Refrescar histórico real"** en _Métricas_.

**Auditoría final: 0 tablas con datos de ejemplo** (las que tienen `is_demo`
están todas a `false` y con datos reales).

> Aviso: `bot_executions` **no tiene columna `user_id`** en tu base (esa
> migración de multiusuario no está aplicada ahí). No es un problema: el
> aislamiento se hace por bot, que sí tiene dueño. Pero si quieres que el
> filtro por dueño sea también en las ejecuciones, hay que aplicar
> `20261009000000_multiusuario_fase1.sql`.

### Copy trading de traders REALES (nuevo)

Dos indicadores que no salen del precio sino de **traders reales** de Binance
Futures (datos públicos):

- **`top_traders`**: el posicionamiento de las cuentas con las posiciones más
  grandes.
- **`taker_flow`**: el volumen agresivo de compra frente a venta (dinero real).

Se miden en _Mis bots → Campo de entrenamiento → "Copy trading de traders
REALES" → Medir ahora_, y también por CLI:

```powershell
bun run backtest -- --simbolo BTCUSDT --intervalo 1h --velas 700 --indicadores top_traders --capital 1000 --stop 2 --take 4 --aleatorio 20
```

**El resultado de hoy**: copiar a los traders grandes da −0,22 % (percentil 10
% de la referencia aleatoria) y seguir el flujo −0,31 % (percentil 0 %). O
sea, **no se distinguen de entrar al azar**. No hay ventaja demostrada, y la
app lo dice tal cual.

> Ojo con el límite de datos: la API pública de traders da unos **30 días**,
> así que el backtest de copy trading es corto (unas 700 velas de 1 h). Con
> pocas operaciones el resultado es ruido: por eso la app enseña el
> percentil dentro de la referencia aleatoria.

---

## 6. Lo que YA está hecho y comprobado (no hace falta repetirlo)

| Qué                        | Cómo se comprobó                                                                |
| -------------------------- | ------------------------------------------------------------------------------- |
| El endpoint del motor      | Secreto incorrecto → 401; correcto → 200 y ciclo hecho                          |
| El endpoint de minería     | 3 equipos actualizados, hash rate medido (233-305 KH/s)                         |
| Las 11 páginas             | Abiertas una a una con tu sesión: muestran los datos de verdad                  |
| Credenciales de Binance    | **Conexión verificada contra testnet** (HTTP 200)                               |
| Región                     | Salida por MIA (DO), Binance accesible, sin restricción geográfica              |
| Aislamiento entre usuarios | Con tu 2º usuario: solo ve su bot, ni app_settings ni credenciales              |
| El cron local              | Tarea "DealMaker Motor" corriendo cada minuto, `LastTaskResult 0`, con watchdog |
| La app                     | `tsc` 0, **322 tests** en verde, eslint 0, `.exe` compilado                     |

---

## 7. Mapa de lo que toca

- **Tú**: `PARA-TI.md` (paso a paso de lo tuyo) y este fichero.
- **Yo**: el código, los tests y las migraciones (`supabase/migrations/`).
- **El repo**: `BACKTEST.md` (cómo medir una estrategia), `roadmap.md` (estado
  real por fases), `README.md`.
