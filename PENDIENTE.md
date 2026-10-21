# Pendientes

Estado verificado el **20/10/2026** (contra la base de datos y la app, no de
memoria). Todo lo de la sección 1 es tuyo; lo de la 2 son decisiones; lo de
la 3 son extras.

> ✅ **Las 8 migraciones ya están aplicadas** (20-oct). La app lo confirma:
> _Ajustes → Automatización → "Estado de la base de datos"_ → 8/8 en verde.
> La auditoría de seguridad tambien: con la clave pública sin sesión, todo
> devuelve 401; con la sesión de otro usuario, 403 (y `app_settings` le da 0
> filas por no ser admin).

> 🆕 **Hay una migración nueva sin aplicar** (la 10, la del orden de los bots):
> bots): `supabase/migrations/20261029000000_bots_orden.sql`.
> La app **funciona sin ella** (los botones de mover avisan de que falta), pero sin
> ella no puedes ordenar el escuadrón a tu gusto.

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

### B. Los indicadores del motor — HECHO (21-oct)

Medido con el backtest real (BTCUSDT, 1 h, 3.000 velas, capital 1.000, stop 2 %,
take 4 %, walk-forward de 4 bloques y 30 estrategias aleatorias de referencia):

| Indicadores                              | Retorno | Ops  | Walk-forward | Percentil vs azar |
| --------------------------------------- | ------- | ---- | ------------ | ----------------- |
| close_price                              | −1,36 % | 271 | 0/4 bloques   | **3 %** (peor que el azar) |
| close_price + rsi                        | +0,03 % | 2    | 1/4 bloques   | 40 % (solo 2 ops: ruido) |
| **rsi** (el que hay puesto)              | **+0,19 %** | 24 | **2/4 bloques** | **67 %** |
| bollinger                                | −0,09 % | 55 | 1/4 bloques   | 53 % (indistinguible) |
| stochastic                               | −0,51 % | 75 | 1/4 bloques   | 20 % (peor que el azar) |
| los 6 de antes                           | 0,00 %  | **0** | 0/4 bloques | — (no abre NADA) |
| AI Indicator (el que tenias)             | 0,00 %  | **0** | 0/4 bloques | — (no abre NADA) |

**Por qué 0 operaciones**: el motor exige que **todos** los indicadores
coincidan a la vez (si uno dice compra y otro venta, no hay señal). Con 5-6
eso no pasa; y el *AI Indicator* es un **filtro**: no genera señal propia, así
que solo él tampoco abre nada.

**Decisión aplicada**: `indicator_ids = ["rsi"]`, estrategia `fixed` (cantidad
fija), horizonte 5 min, importe 20 USDT. Es el único que no pierde contra el
azar. Lo puedes cambiar en _Motor → Configuración del motor_.

> **Honestidad**: 24 operaciones en 4 meses son pocas (la app avisa de que por
> debajo de 100 el resultado es ruido). El RSI no es una máquina de dinero:
> es **el menos malo** de lo medido y sirve para acumular datos reales en
> demo. Antes de poner dinero real, mide con walk-forward y contra la
> referencia aleatoria (justo lo que está en `BACKTEST.md`).
### C. El motor 24/7 — DESCARTADO por ahora (20-oct)

**Decisión tuya**: el 24/7 automático se queda fuera (no tienes cuenta de
nube). Ya está hecho:

- La tarea programada de Windows "DealMaker Motor" está **desinstalada**.
- El workflow `.github/workflows/tick.yml` está **eliminado**.
- La app no muestra la tarjeta del cron 24/7 ni la pestaña 24/7: el motor
  se abre con un **temporizador** desde _Motor → Control de la sesión_.

El motor, el backtest y la minería siguen vivos: el motor opera mientras
la app esté abierta y haya una sesión con temporizador.

**Para volver a activarlo** (cuando tengas cuenta de nube):

```powershell
cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
# El cron local de tu PC (vuelve a instalarlo)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\instalar-cron-local.ps1
```

Y para el 24/7 de verdad, desplegar la app y poner un cron en la nube que
llame a `POST /api/public/automation-tick` con `Authorization: Bearer
<secreto>`. El endpoint sigue vivo; solo falta quién lo llama.
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
| 10  | `20261029000000_bots_orden.sql` 🆕             | No puedes **ordenar los bots** (moverlos arriba/abajo); el resto funciona igual            |

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

Ahora mismo el motor **vive dentro de la app**: abre y cierra posiciones
mientras la app esté abierta y haya una **sesión con temporizador** iniciada
desde _Motor → Control de la sesión_. Nada corre solo.

- **Manual (lo de ahora)**: abres la app, inicias una sesión de 15 min / 1 h /
  6 h y el motor opera mientras dure. Al cerrarla, deja de abrir posiciones.
- **Volver al 24/7 automático**: está todo en el repo (tarea de Windows,
  scripts y endpoint). Ver la sección C.
- **En la nube (24/7 de verdad)**: hace falta tu cuenta (Lovable Cloud,
  Cloudflare o un VPS). Es el único 24/7 que no depende de tu PC.

### 2.2 Los indicadores del motor

`engine_config` está **vacío**: sin indicadores el motor **no abre
posiciones** (a propósito). Se eligen en _Motor → Configuración del motor_
(indicadores, estrategia, horizonte, importe) → _Guardar configuración_.

> ⚠ Con los **6 indicadores** que tienes ahora el motor **no abre nada**: el
> motor exige que **todos** coincidan a la vez y eso no pasa. Empieza con **1 o
> 2** (Precio de cierre, o Precio + RSI). El campo de entrenamiento te dice
> cuántos dio cada uno por separado.

### 2.3 El dinero (decidido el 21-oct)

- **Real trading**: **te quedas en DEMO** (decidido el 21-oct). `allow_real_trading`
  y `allow_live_orders` siguen **apagados** y el entorno es **testnet**. El
  interruptor de arriba existe, pero pasará a REAL pide que enciendas esas dos
  banderas.
- **Fase 7**: **HECHO (21-oct)**. La clave de cifrado de las credenciales se
  rotó (la nueva está en el fichero de secretos y dentro del `.exe` nuevo) y se
  apagó lo que sobraba: `cron_secret` borrado, `allow_real_trading` y
  `allow_live_orders` en false, entorno testnet. Comprobado: Binance testnet
  responde 200 con la clave nueva. **Reinstala el `.exe`**. Detalle en
  `PARA-TI.md` §8.
- **¿Minamos?** El enjambre sigue encendido (decidido el 21-oct): la luz **ya no
  se resta** (es ingreso pasivo), pero la ganancia real es de **0,00000004 USD/día**
  con 5 equipos: la verdad es que en un PC de casa no sale. Para pararlo:
  _Minería → Detener enjambre_.

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
- **La clave de cifrado de tus credenciales se rotó** (Fase 7): la nueva está
  en el fichero de secretos y en el `.exe` recién compilado. La vieja se
  borró. Si al abrir el `.exe` viejo la página de Binance dijera que no hay
  clave guardada, es eso: **reinstala el `.exe`**. El secreto del cron (que
  abría el endpoint del motor a cualquiera) también está borrado.
- **El interruptor DEMO/REAL está arriba**, en la barra superior: verde en
  demo (testnet), rojo en real, con animación y confirmación. **El interruptor
  NO enciende el trading real**: hace falta que las dos banderas
  (`allow_real_trading` y `allow_live_orders`) estén puestas; si faltan, el
  servidor lo rechaza con un mensaje claro. Ahora mismo seguimos en **demo**.
- **Cada bot se puede mover (arriba/abajo) y borrar** desde su tarjeta. Borrarlo
  borra también sus logs, ejecuciones y configuración; si tiene una posición
  abierta en Binance, **no se borra** (se quedaría sin TP/SL).
- **La minería ya no descuenta la luz**: la ganancia es lo que da la red menos la
  comisión del pool, y la luz se informa aparte como lo que consume el equipo
  (decisión tuya: es ingreso pasivo).
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
