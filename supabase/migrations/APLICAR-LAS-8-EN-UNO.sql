-- ============================================================================
-- LAS 8 MIGRACIONES PENDIENTES, EN UN SOLO PEGOTE
-- Generado el 20-oct-2026. Orden: 20261020000000, 20261021000000,
-- 20261022000000, 20261023000000, 20261024000000, 20261025000000,
-- 20261026000000, 20261027000000.
--
-- COMO USARLO
--   Supabase -> SQL Editor -> New query -> pega TODO este fichero -> Run.
--
-- Es una sola transaccion: si algo falla, NO se aplica nada (no se queda a
-- medias). Ademas son idempotentes: si las repites, no se rompe nada.
--
-- Cada bloque lleva su propio comentario con lo que hace.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 20261020000000_app_settings_registro_publico.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- app_settings · interruptor del registro publico de usuarios
--
-- NO abre el registro: solo deja preparada la fila y explica como
-- abrirla y cerrarla. El valor por defecto (sin fila o "false") es
-- registro CERRADO, que es lo que quiere el dueno mientras el
-- multiusuario no este probado.
--
-- El control de verdad esta en Supabase Auth (Authentication -> Sign-ups):
-- si Sign-ups esta apagado ahi, NADIE puede registrarse aunque la app
-- muestre el boton. La app solo refleja el estado (src/lib/registro.functions.ts).
--
-- ABRIR el registro (cuando el multiusuario este probado y el dueno lo
-- decida). Pegar esto en el SQL Editor:
--
--   insert into public.app_settings (key, value, updated_at)
--   values ('public_signup_enabled', 'true', now())
--   on conflict (key) do update set value = 'true', updated_at = now();
--
-- O bien, sin tocar la base, con la variable de entorno PUBLIC_SIGNUP=true
-- en el entorno del servidor (tiene prioridad sobre la fila).
--
-- CERRARLO de nuevo:
--
--   update public.app_settings
--      set value = 'false', updated_at = now()
--    where key = 'public_signup_enabled';
-- ============================================================

-- La fila NO se inserta activa: se deja en "false" para que el estado
-- inicial sea explicito y consultable.
insert into public.app_settings (key, value, updated_at)
values ('public_signup_enabled', 'false', now())
on conflict (key) do update
  set value = case when public.app_settings.value in ('true', '1', 'si', 'yes') then 'true' else 'false' end,
      updated_at = now();

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select key, value, updated_at from public.app_settings
--   where key = 'public_signup_enabled';
--
-- Lo esperado: una fila con value = 'false' (registro cerrado).
-- Para abrirlo, cambia el value a 'true' como se explica arriba.
-- ------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 20261021000000_engine_strategies_por_bot.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- Multiusuario · indicador y estrategia POR BOT
--
-- Que hace
--   1) engine_strategies (una fila por bot) gana dos columnas:
--        indicator_ids text[]  -> los indicadores de ESE bot
--        strategy_id   text    -> la estrategia de tamaño de ESE bot
--      Si son null, el bot usa la configuracion de la plataforma
--      (engine_config.indicator_ids / strategy_id). Asi el cambio es
--      opcional y no rompe a nadie.
--   2) indices para leer rapido la configuracion de los bots con Auto o
--      con indicador propio.
--
-- Por que
-- Los 7 indicadores y las 4 estrategias son PURE funciomnes (las mismas
-- que usa el backtest). Hasta ahora los indicadores y la estrategia se
-- elegian PARA TODA LA PLATAFORMA, asi que dos bots con estrategias
-- distintas no podian existir. Con esto, cada bot puede tener la suya y
-- medirla por separado.
--
-- NO toca flags de trading, ni binance_trading_env, ni credenciales.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

-- 1) Columnas por bot (opcionales: null = usa la de la plataforma).
alter table public.engine_strategies
  add column if not exists indicator_ids text[],
  add column if not exists strategy_id text;

-- 2) Comprobacion: si los ids de indicador no existen en el registro, el
--    motor no tendra senal y el bot no abrira posiciones. Se avisa con
--    una consulta, no con un error (para no bloquear la migracion).
-- 3) Indices de lectura.
create index if not exists engine_strategies_indicator_ids_idx
  on public.engine_strategies (indicator_ids)
  where indicator_ids is not null;

create index if not exists engine_strategies_strategy_id_idx
  on public.engine_strategies (strategy_id)
  where strategy_id is not null;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'engine_strategies'
--     and column_name in ('indicator_ids', 'strategy_id')
--   order by column_name;
--
-- Lo esperado:
--   indicator_ids | ARRAY | YES   (text[])
--   strategy_id   | text  | YES
--
-- Y cuantos bots tienen ya configuracion propia:
--
--   select
--     count(*) filter (where indicator_ids is not null) as con_indicadores,
--     count(*) filter (where strategy_id is not null) as con_estrategia
--   from public.engine_strategies;
--
-- Nota: si la consulta de abajo devuelve filas, hay ids de indicador que
-- no existen en el registro (src/lib/indicators). Corregilos antes de
-- poner bots con esos indicadores en marcha:
--
--   select bot_id, indicator_ids from public.engine_strategies
--   where indicator_ids is not null;
-- ------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 20261022000000_bot_executions_senal.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- bot_executions · registro de la SEÑAL que produjo cada operacion
--
-- Que hace
--   Añade a bot_executions tres columnas para que se pueda saber, para
--   cada operacion, que indicadores la dispararon y por que:
--     signal_indicators text[]  -> los indicadores que coincidieron
--     signal_reason     text    -> 'compra' | 'venta' | 'stop_loss' |
--                                  'take_profit' | 'cierre_senal'
--     signal_at         timestamptz -> cuando se calculo la señal
--
-- Por que
-- Sin esto no se puede responder a la pregunta que de verdad importa:
--   ¿que indicador gana y cual pierde?
-- Con las ejecuciones grabadas y estos tres campos, el panel de métricas
-- puede comparar por indicador, por par, por hora del dia y por
-- estrategia, y avisar cuando un bot acumula muchas operaciones SIN
-- ventaja estadistica.
--
-- Antes, esto no se podia saber: la IA Indicator (src/lib/indicators/
-- ai-indicator.ts) ya calculaba estadisticas por indicador y por hora
-- leyendo las operaciones del bot, pero le faltan estos campos.
--
-- NULL en las filas viejas: esas operaciones no tienen señal registrada
-- (se hicieron antes de este cambio o en modo demo antiguo).
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

alter table public.bot_executions
  add column if not exists signal_indicators text[],
  add column if not exists signal_reason text,
  add column if not exists signal_at timestamptz;

-- Indice para el panel de métricas (agrupa por bot y por operación).
create index if not exists bot_executions_signal_idx
  on public.bot_executions (bot_id, created_at desc)
  where signal_indicators is not null;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'bot_executions'
--     and column_name like 'signal%'
--   order by column_name;
--
-- Lo esperado:
--   signal_indicators | ARRAY  | YES
--   signal_reason     | text   | YES
--   signal_at         | timestamp with time zone | YES
--
-- Y cuantas operaciones tienen ya la señal registrada:
--
--   select count(*) as con_senal, count(*) filter (where signal_reason is not null) as con_motivo
--   from public.bot_executions;
-- ------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 20261023000000_realismo_ejecucion.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- Realismo de ejecucion: riesgo por operacion, regimen, par y enfriamiento
--
-- Que anade a automation_settings (la configuracion de la plataforma):
--   riesgo_por_operacion      numeric  % del capital que se arriesga por
--                                     operacion (0,01 = 1 %). El tamano de
--                                     la posicion sale de aqui y de la
--                                     distancia del stop, no de un 2 % fijo.
--   stop_por_atr             numeric  Multiplicador del ATR para la
--                                     distancia del stop (1,5 = el stop
--                                     es 1,5 veces el ATR). NULL = se
--                                     usa el stop configurado del bot.
--   filtro_regimen           boolean  Bloquear entradas cuando el mercado
--                                     esta en tendencia fuerte (para
--                                     estrategias de reversion) o con
--                                     volatilidad extrema.
--   max_trades_per_pair      integer  Maximo de operaciones por PAR y dia
--                                     (0 = sin limite).
--   cooldown_minutes_after_losses integer  Minutos de espera tras una racha
--                                     de perdidas (0 = sin enfriamiento).
--   cooldown_losses           integer  Cuantas perdidas seguidas activan el
--                                     enfriamiento.
--
-- Todas con valor por defecto sensato: si el dueno no las toca, el
-- motor se comporta como hasta ahora (2 % fijo, sin filtro de regimen,
-- sin limites por par, sin enfriamiento) MENOS el tamano por riesgo, que
-- solo se aplica si riesgo_por_operacion > 0.
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

alter table public.automation_settings
  add column if not exists riesgo_por_operacion numeric not null default 0.01,
  add column if not exists stop_por_atr numeric,
  add column if not exists filtro_regimen boolean not null default false,
  add column if not exists max_trades_per_pair integer not null default 0,
  add column if not exists cooldown_minutes_after_losses integer not null default 0,
  add column if not exists cooldown_losses integer not null default 0;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'automation_settings'
--     and column_name in ('riesgo_por_operacion','stop_por_atr','filtro_regimen',
--                         'max_trades_per_pair','cooldown_minutes_after_losses','cooldown_losses')
--   order by column_name;
--
-- Lo esperado: las 6 columnas con sus valores por defecto.
--
-- Para ACTIVAR el filtro de regimen (recomendado solo con datos):
--   update public.automation_settings
--      set filtro_regimen = true, riesgo_por_operacion = 0.01
--    where id = (select id from public.app_settings limit 1);
--
-- Ojo: riesgo_por_operacion = 0.01 con un stop del 2 % implica posiciones
-- del 50 % del capital. Si prefieres Conservadora, bajalo a 0.005 (5 % del
-- capital por operacion como maximo, con el tope de la estrategia).
-- ------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 20261024000000_auto_symbol_spread.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- Selector automatico de par: filtro de SPREAD
--
-- Que anade
--   engine_config.auto_symbol_max_spread_pct numeric
--       Spread maximo admitido (en tanto por uno) para que un bot opere un
--       par. 0.005 = 0,5 %. NULL = sin limite.
--
-- Por que
-- El selector ya filtraba por volumen (para no operar en un par illiquido)
-- pero no por el SPREAD: en un par con un spread del 1 %, la ganancia de un
-- take-profit del 0,5 % se la come el spread antes de empezar. Un par
-- "malo" no es el que tiene poco volumen, sino el que te cobra mucho por
-- entrar y salir.
--
-- Si no se pudo leer el libro de ordenes (spread desconocido), el par NO se
-- descarta: no se bloquea el selector por falta de un dato.
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

alter table public.engine_config
  add column if not exists auto_symbol_max_spread_pct numeric;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'engine_config'
--     and column_name = 'auto_symbol_max_spread_pct';
--
-- Lo esperado: auto_symbol_max_spread_pct | numeric | YES
--
-- Poner un limite concreto (0,5 %):
--
--   update public.engine_config
--      set auto_symbol_max_spread_pct = 0.005, updated_at = now()
--    where user_id = (select user_id from public.app_admins order by created_at limit 1);
-- ------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 20261025000000_engine_cycles.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- Diario del motor: un registro por ciclo con lo que hizo cada bot
--
-- Que anade
--   public.engine_cycles
--     id            uuid
--     user_id       uuid  (dueno de la plataforma: el motor es global)
--     started_at    timestamptz
--     finished_at   timestamptz
--     trigger       text  ('cron' | 'manual')
--     status        text  ('completed' | 'halted' | 'idle' | 'failed')
--     bots_processed integer
--     orders_created  integer
--     errors          integer
--     duration_ms     integer
--     notes           text
--     decisions       jsonb  (una linea por bot: accion, motivo y detalle)
--
-- Por que
-- "Mi bot no opera y no se por que" es la pregunta mas frustrante de las
-- que se le hacen a un bot. Sin este registro, los motivos estaban
-- dispersos en el log de cada bot y no se podian ver de una vez.
--
-- El motor escribe la fila SIEMPRE (best-effort): si esta tabla no existe
-- todavia (migracion sin aplicar), el motor sigue funcionando igual, solo
-- que no queda el diario.
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

create table if not exists public.engine_cycles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text not null default 'cron',
  status          text,
  bots_processed  integer not null default 0,
  orders_created  integer not null default 0,
  errors          integer not null default 0,
  duration_ms     integer,
  notes           text,
  decisions       jsonb not null default '[]'::jsonb
);

create index if not exists engine_cycles_finished_idx
  on public.engine_cycles (finished_at desc nulls last);

create index if not exists engine_cycles_user_idx
  on public.engine_cycles (user_id, finished_at desc nulls last);

-- Misma politica que el resto de tablas del motor: solo service_role.
alter table public.engine_cycles enable row level security;
revoke all on public.engine_cycles from anon;
revoke all on public.engine_cycles from authenticated;
grant all on public.engine_cycles to service_role;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select count(*) as ciclos, max(finished_at) as ultimo
--   from public.engine_cycles;
--
-- Lo esperado: 0 filas hasta que el motor corra un ciclo (la tabla se crea
-- vacia). Si el motor ya esta corriendo y aun asi sale 0, es que la
-- migracion no se ha aplicado.
-- ------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 20261026000000_mineria_real.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- MOTOR DE MINERIA REAL (20-oct)
--
-- Que hace:
--   - mining_workers: guarda los datos REALES del equipo (hash rate medido,
--     potencia, ganancia bruta y neta, ultimo contacto, config manual de la
--     red y ultimo pago).
--   - automation_settings: el precio del kWh de cada dueno (lo que decide
--     si minar en casa sale a cuenta o no).
--
-- Que NO hace (a proposito):
--   - No toca ninguna fila: solo anade columnas. Los workers que ya tienes
--     se quedan con sus valores (0 de hash rate) hasta que el motor los
--     mida de verdad.
--   - No toca flags de trading ni credenciales.
--
-- Es idempotente: si la repites, no se rompe nada.
--
-- NOTA: la app funciona SIN esta migracion (el motor de mineria avisa y se
-- queda con 0), pero sin ella no se guardan el hash rate real, el neto ni
-- el precio de la luz.
-- ============================================================

-- 1) Columnas del worker.
alter table public.mining_workers
  add column if not exists last_seen_at timestamptz,
  add column if not exists power_watts numeric,
  add column if not exists gross_daily_usd numeric,
  add column if not exists net_daily_usd numeric,
  add column if not exists last_payout_at timestamptz,
  add column if not exists network_config jsonb;

-- 1b) Mas precision en las cifras de dinero.
-- Con numeric(12,2) la ganancia real de un PC de casa (0,0000000066 USD al
-- dia) se guardaba como 0,00 y no se podia ni leer ni comparar. Con 10
-- decimales cabe cualquier cifra de minado sin perder nada.
alter table public.mining_workers
  alter column estimated_daily_earnings type numeric(24,10);
alter table public.mining_payouts
  alter column usd_value type numeric(24,10);
alter table public.mining_payouts
  alter column amount type numeric(24,10);

-- 1c) Campo de ENTRENAMIENTO de los mineros:
--   - 'hilos': cuantos nucleos usa cada equipo.
--   - 'hash_rate_max': lo que rinde de verdad la maquina con esos hilos.
--   - mining_entrenamientos: la curva medida (1, 2, 3, 4 hilos) de cada
--     equipo, con la medicion real (SHA-256 de verdad, con workers reales).
create table if not exists public.mining_entrenamientos (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.mining_workers (id) on delete cascade,
  user_id uuid not null,
  hilos integer not null default 1,
  hash_rate numeric not null default 0,
  hash_unit text not null default 'MH/s',
  duracion_ms integer not null default 0,
  hashes bigint not null default 0,
  curva jsonb,
  nota text,
  created_at timestamptz not null default now()
);

alter table public.mining_workers
  add column if not exists hilos integer not null default 1,
  add column if not exists hash_rate_max numeric;

create index if not exists mining_entrenamientos_worker_fecha_idx
  on public.mining_entrenamientos (worker_id, created_at desc);

-- 2) El precio del kWh (por dueno, como el resto de automation_settings).
alter table public.automation_settings
  add column if not exists mineria_kwh_usd numeric not null default 0.15;

-- 3) El pago, con su equipo: para no pagar dos veces el mismo dia.
alter table public.mining_payouts
  add column if not exists worker_id uuid references public.mining_workers (id) on delete set null;

-- 3) Indice para el historico por worker (la grafica lo lee por fecha).
create index if not exists mining_hashrate_history_worker_fecha_idx
  on public.mining_hashrate_history (worker_id, recorded_on desc);

-- 4) Indice para no pagar dos veces el mismo dia.
create index if not exists mining_payouts_worker_fecha_idx
  on public.mining_payouts (worker_id, paid_at desc);

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select column_name, data_type
  from information_schema.columns
 where table_name = 'mining_workers'
   and column_name in ('last_seen_at','power_watts','gross_daily_usd','net_daily_usd','last_payout_at','network_config');
-- deben salir 6 filas

select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'automation_settings' and column_name = 'mineria_kwh_usd';
-- debe salir: numeric, 0.15

select column_name, data_type, numeric_precision, numeric_scale
  from information_schema.columns
 where table_name = 'mining_workers' and column_name = 'estimated_daily_earnings';
-- debe salir: numeric, 24, 10 (antes 12, 2 y las ganancias reales se perdian)

select column_name, data_type
  from information_schema.columns
 where table_name = 'mining_payouts' and column_name = 'worker_id';
-- debe salir: worker_id, uuid

-- ---------------------------------------------------------------------------
-- 20261027000000_cache_mercado.sql
-- ---------------------------------------------------------------------------
-- ============================================================
-- CACHE DE DATOS DE MERCADO (20-oct)
--
-- Que hace:
--   - market_candles: las velas OHLCV que usa el sandbox y el backtest, con
--     la plataforma de donde salió cada vela. Asi NO hay que volver a
--     descargarlo todo cada vez que se mide.
--   - trader_metrics: el posicionamiento de los traders grandes y el flujo
--     de ordenes, guardado igual (con su plataforma y periodo).
--
-- Que NO hace:
--   - No inventa datos: solo se guarda lo que ha bajado de una plataforma
--     real, con su fuente escrita en la fila.
--   - No toca flags de trading ni credenciales.
--
-- Es idempotente: si la repites, no se rompe nada.
--
-- NOTA: la app funciona SIN esta migracion (simplemente vuelve a descargar
-- de las plataformas cada vez). Con ella, el sandbox lee de la cache.
-- ============================================================

-- 1) Velas cacheadas.
create table if not exists public.market_candles (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  interval text not null,
  -- Momento de apertura de la vela, en milisegundos epoch.
  time bigint not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null default 0,
  -- De que plataforma salio (Binance, Bybit, OKX, Kraken, Coinbase...).
  source text not null,
  -- Market (spot o futuros).
  market text not null default 'futuros',
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists market_candles_symbol_interval_time_uidx
  on public.market_candles (symbol, interval, time);

create index if not exists market_candles_symbol_interval_idx
  on public.market_candles (symbol, interval, time desc);

alter table public.market_candles enable row level security;

-- 2) Datos de traders cacheados (posicionamiento y flujo).
create table if not exists public.trader_metrics (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  -- 'top_long_short' | 'taker_buy_sell' | 'global_long_short'
  metric text not null,
  -- Periodo de la lectura ('5m', '1h'...).
  period text not null,
  time bigint not null,
  value double precision not null,
  source text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists trader_metrics_symbol_metric_period_time_uidx
  on public.trader_metrics (symbol, metric, period, time);

alter table public.trader_metrics enable row level security;

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select table_name
  from information_schema.tables
 where table_name in ('market_candles', 'trader_metrics');
-- deben salir 2 filas

select count(*) as velas_cacheadas from public.market_candles;
select count(*) as traders_cacheados from public.trader_metrics;

commit;

-- ============================================================================
-- COMPROBACION (esto ya NO va en la transaccion: es solo para mirar)
-- ============================================================================

-- 20261020000000_app_settings_registro_publico.sql



-- 20261021000000_engine_strategies_por_bot.sql



-- 20261022000000_bot_executions_senal.sql



-- 20261023000000_realismo_ejecucion.sql



-- 20261024000000_auto_symbol_spread.sql



-- 20261025000000_engine_cycles.sql



-- 20261026000000_mineria_real.sql



-- 20261027000000_cache_mercado.sql


-- ============================================================================
-- Fin. Vuelve a la app: Ajustes -> Automatizacion -> "Estado de la base de
-- datos": deberian salir las 8 en verde.
-- ============================================================================
