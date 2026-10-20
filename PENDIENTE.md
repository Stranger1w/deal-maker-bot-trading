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
- **Campo de entrenamiento de minería**: la tabla `mining_sandboxes` sigue
  con los números de ejemplo antiguos (120 TH/s, que es una máquina
  dedicada, no tu PC). O lo conecto a tus cifras reales o lo quito, para que
  no engañe a nadie.

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
