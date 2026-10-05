-- ============================================================
-- FASE 0 · Cimientos del motor (indicadores + estrategias + config)
--
-- NO toca ningun flag de trading: ni allow_real_trading, ni
-- allow_live_orders, ni engine_enabled, ni app_settings.binance_trading_env.
-- El motor sigue leyendo esos valores igual que antes.
--
-- Aislamiento de account_mode: aqui solo guarda el modo preferido de la
-- pestana Motor (demo/real) para crear sesiones; NO autoriza ni desbloquea
-- trading. En codigo, src/ no referencia engine_config (git grep engine_config
-- -> 0 hits): los cortes de trading real siguen siendo allow_real_trading +
-- allow_live_orders + credenciales verificadas + geo (automation.server.ts) y
-- app_settings.binance_trading_env, y engine_enabled solo lo escriben
-- iniciarMotor y detenerMotor. Cambiar account_mode no altera ninguno de
-- esos flags ni envia ninguna orden por si solo.
-- ============================================================

-- Configuracion de la pestana Motor. NO guarda estado de sesion: los tiempos
-- y motivos de sesion viven en public.engine_sessions (migracion
-- 20261005000000_engine_sessions.sql), que es la fuente de verdad.
-- Se guarda en servidor para que la configuracion sobreviva al cierre de la app.
CREATE TABLE IF NOT EXISTS public.engine_config (
  -- Fila unica por diseno: el motor lee siempre la misma configuracion.
  id                    text PRIMARY KEY DEFAULT 'default'
                          CHECK (id = 'default'),
  account_mode          text NOT NULL DEFAULT 'demo'
                          CHECK (account_mode IN ('demo','real')),
  execution_mode        text NOT NULL DEFAULT '24x7'
                          CHECK (execution_mode IN ('timer','24x7')),
  amount_per_trade      numeric(18,2) NOT NULL DEFAULT 20
                          CHECK (amount_per_trade > 0),
  horizon_minutes       integer NOT NULL DEFAULT 15
                          CHECK (horizon_minutes IN (1,5,15)),
  indicator_ids         text[] NOT NULL DEFAULT ARRAY['close_price']::text[],
  indicator_params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_id           text NOT NULL DEFAULT 'fixed'
                          CHECK (strategy_id IN ('fixed','conservative','optimal','aggressive')),
  -- Filtro de mercado para la seleccion automatica de par (volumen minimo):
  -- parametro global, no estado por bot. El flag auto_symbol es POR BOT y
  -- vive en engine_strategies.
  auto_symbol_min_volume numeric NOT NULL DEFAULT 500000,
  profit_limit_enabled  boolean NOT NULL DEFAULT false,
  profit_limit_amount   numeric(18,2),
  loss_limit_enabled    boolean NOT NULL DEFAULT false,
  loss_limit_amount     numeric(18,2),
  -- Al vencer el temporizador la sesion pasa sola a 'closing' (deja de abrir
  -- y mantiene TP/SL hasta cerrar): politica unica, sin 'keep'; ver
  -- 20261005000000_engine_sessions.sql y el corte del tick en
  -- automation.server.ts.
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Estado operativo de la estrategia por bot (rachas y escalado).
-- Deliberadamente aparte de bots.strategy, que sigue siendo texto libre
-- con valores existentes ('momentum', 'Mean Reverter', ...).
--
-- NO guarda la estrategia elegida: esa vive solo en
-- engine_config.strategy_id. Aqui solo el estado que depende de cada bot.
CREATE TABLE IF NOT EXISTS public.engine_strategies (
  bot_id              uuid PRIMARY KEY REFERENCES public.bots(id) ON DELETE CASCADE,
  params              jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_losses  integer NOT NULL DEFAULT 0,
  consecutive_wins    integer NOT NULL DEFAULT 0,
  -- Escalon de martingala: tope duro 0..3, alineado con MAX_NIVEL de
  -- src/lib/strategies/aggressive.ts (factor = 2^nivel, nunca mas de 8x).
  martingale_level    integer NOT NULL DEFAULT 0
                        CHECK (martingale_level BETWEEN 0 AND 3),
  -- Selector de par automatico POR BOT (antes global en engine_config).
  auto_symbol         boolean NOT NULL DEFAULT false,
  -- La agresiva exige escribir "ACEPTO"; sin esto, no aplica en Real.
  locked_accepted_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Favoritos de la pestana Mercados (solo UI, no afecta al motor).
CREATE TABLE IF NOT EXISTS public.market_favorites (
  symbol     text NOT NULL,
  exchange   text NOT NULL DEFAULT 'binance',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, symbol)
);

-- RLS activo en las tres. Solo service_role accede: la UI siempre pasa por
-- server functions con el cliente admin, nunca consulta directa desde el
-- navegador. Ademas del RLS sin politicas, REVOKE explicito: anon y
-- authenticated ni siquiera pueden leer estas tablas (defense in depth).
ALTER TABLE public.engine_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_favorites  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.engine_config     FROM anon, authenticated;
REVOKE ALL ON public.engine_strategies FROM anon, authenticated;
REVOKE ALL ON public.market_favorites  FROM anon, authenticated;
GRANT ALL ON public.engine_config     TO service_role;
GRANT ALL ON public.engine_strategies TO service_role;
GRANT ALL ON public.market_favorites  TO service_role;

-- Sin indice sobre engine_config: es una sola fila y el indice no aporta.
-- engine_strategies se indexa por bot_id (ya es PK).

-- Orden de topes sobre el dinero (verificado en el codigo):
--  1. Kill Switch: automation.server.ts corta el ciclo ANTES de calcular
--     ningun monto y antes de recorrer los bots; no depende del escalado.
--  2. global_max_capital y concentracion por par: se evaluan en cada tick
--     sobre el capital asignado (suma de bots.capital) ANTES de calcular el
--     monto de la operacion y detienen al bot incumplidor (stopBot), asi que
--     no llega a emitirse ninguna orden.
--  3. Tope por operacion sobre el monto YA ESCALADO: src/lib/strategies
--     (decidir) primero aplica el factor de la estrategia (p. ej. martingala
--     1x..8x) y luego recorta `base*factor` a `capital * topeFraccionCapital`
--     (10% del saldo, 5% en Optima); si queda por debajo de minNotional se
--     OMITE la operacion, nunca se agranda el monto. Ningun escalado puede
--     eludir los topes 1 ni 2 porque se evaluan antes (y sobre capital), y
--     el tope 3 recorta siempre el monto resultante.
