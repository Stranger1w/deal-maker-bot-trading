-- ============================================================
-- FASE 0 · Cimientos del motor (indicadores + estrategias + config)
--
-- NO toca ningun flag de trading: ni allow_real_trading, ni
-- allow_live_orders, ni engine_enabled, ni app_settings.binance_trading_env.
-- El motor sigue leyendo esos valores igual que antes.
-- ============================================================

-- Configuracion de la pantalla Motor. El motor la lee en cada tick.
-- Se guarda en servidor para que la sesion sobreviva al cierre de la app.
CREATE TABLE IF NOT EXISTS public.engine_config (
  -- Fila unica por diseno: el motor lee siempre la misma configuracion.
  id                    text PRIMARY KEY DEFAULT 'default'
                          CHECK (id = 'default'),
  account_mode          text NOT NULL DEFAULT 'demo'
                          CHECK (account_mode IN ('demo','real')),
  execution_mode        text NOT NULL DEFAULT '24x7'
                          CHECK (execution_mode IN ('timer','24x7')),
  session_started_at    timestamptz,
  session_ends_at       timestamptz,
  session_closed_at     timestamptz,
  session_close_reason  text
                          CHECK (session_close_reason IN ('timer','manual','kill_switch','error')),
  amount_per_trade      numeric(18,2) NOT NULL DEFAULT 20
                          CHECK (amount_per_trade > 0),
  horizon_minutes       integer NOT NULL DEFAULT 15
                          CHECK (horizon_minutes IN (1,5,15)),
  indicator_ids         text[] NOT NULL DEFAULT ARRAY['close_price']::text[],
  indicator_params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_id           text NOT NULL DEFAULT 'fixed'
                          CHECK (strategy_id IN ('fixed','conservative','optimal','aggressive')),
  auto_symbol           boolean NOT NULL DEFAULT false,
  auto_symbol_min_volume numeric NOT NULL DEFAULT 500000,
  profit_limit_enabled  boolean NOT NULL DEFAULT false,
  profit_limit_amount   numeric(18,2),
  loss_limit_enabled    boolean NOT NULL DEFAULT false,
  loss_limit_amount     numeric(18,2),
  -- Al vencer el temporizador: cerrar las abiertas o solo dejar de abrir nuevas.
  on_timer_end          text NOT NULL DEFAULT 'close'
                          CHECK (on_timer_end IN ('close','keep')),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- El modo temporizador exige hora de fin; 24x7 no la lleva.
  CONSTRAINT timer_needs_end
    CHECK (execution_mode <> 'timer' OR session_ends_at IS NOT NULL)
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
  martingale_level    integer NOT NULL DEFAULT 0,
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
-- navegador.
ALTER TABLE public.engine_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_favorites  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.engine_config    TO service_role;
GRANT ALL ON public.engine_strategies TO service_role;
GRANT ALL ON public.market_favorites  TO service_role;

-- El motor lee la config en cada tick: indice trivial de una sola fila.
-- engine_strategies se indexa por bot_id (ya es PK).
CREATE INDEX IF NOT EXISTS engine_config_updated_at
  ON public.engine_config (updated_at);
