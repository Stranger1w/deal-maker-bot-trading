
-- 1. Controles de riesgo por bot
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_daily_loss numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS stop_loss_pct numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS max_drawdown_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_capital numeric NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS trades_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peak_pnl numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_stop_reason text,
  ADD COLUMN IF NOT EXISTS risk_day date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz;

-- 2. Ajustes globales del motor (singleton)
CREATE TABLE IF NOT EXISTS public.automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  allow_real_trading boolean NOT NULL DEFAULT false,
  tick_interval_seconds integer NOT NULL DEFAULT 60,
  global_max_daily_loss numeric NOT NULL DEFAULT 500,
  global_max_drawdown_pct numeric NOT NULL DEFAULT 15,
  engine_status text NOT NULL DEFAULT 'stopped',
  last_heartbeat_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.automation_settings TO anon, authenticated;
GRANT ALL ON public.automation_settings TO service_role;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_settings_read ON public.automation_settings;
CREATE POLICY automation_settings_read ON public.automation_settings FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.automation_settings (id)
SELECT '44444444-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM public.automation_settings);

-- 3. Ejecuciones de órdenes con clave de idempotencia
CREATE TABLE IF NOT EXISTS public.bot_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES public.bots(id) ON DELETE CASCADE,
  bot_name text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  mode text NOT NULL DEFAULT 'demo',
  side text NOT NULL,
  symbol text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  pnl numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'simulated',
  attempts integer NOT NULL DEFAULT 1,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bot_executions TO anon, authenticated;
GRANT ALL ON public.bot_executions TO service_role;
ALTER TABLE public.bot_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_executions_read ON public.bot_executions;
CREATE POLICY bot_executions_read ON public.bot_executions FOR SELECT TO anon, authenticated USING (true);

-- 4. Historial de ciclos del motor (salud del worker)
CREATE TABLE IF NOT EXISTS public.engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  trigger text NOT NULL DEFAULT 'cron',
  bots_processed integer NOT NULL DEFAULT 0,
  orders_created integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  notes text
);
GRANT SELECT ON public.engine_runs TO anon, authenticated;
GRANT ALL ON public.engine_runs TO service_role;
ALTER TABLE public.engine_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS engine_runs_read ON public.engine_runs;
CREATE POLICY engine_runs_read ON public.engine_runs FOR SELECT TO anon, authenticated USING (true);

-- 5. Series históricas para las gráficas (datos demo/seed)
CREATE TABLE IF NOT EXISTS public.mining_hashrate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.mining_workers(id) ON DELETE CASCADE,
  worker_name text NOT NULL,
  coin text NOT NULL,
  recorded_on date NOT NULL,
  hash_rate numeric NOT NULL,
  hash_unit text NOT NULL DEFAULT 'MH/s',
  is_demo boolean NOT NULL DEFAULT true,
  UNIQUE (worker_name, recorded_on)
);
GRANT SELECT ON public.mining_hashrate_history TO anon, authenticated;
GRANT ALL ON public.mining_hashrate_history TO service_role;
ALTER TABLE public.mining_hashrate_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mining_hashrate_history_read ON public.mining_hashrate_history;
CREATE POLICY mining_hashrate_history_read ON public.mining_hashrate_history FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  recorded_on date NOT NULL,
  price numeric NOT NULL,
  source text NOT NULL DEFAULT 'demo-seed',
  is_demo boolean NOT NULL DEFAULT true,
  UNIQUE (symbol, recorded_on)
);
GRANT SELECT ON public.market_prices TO anon, authenticated;
GRANT ALL ON public.market_prices TO service_role;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_prices_read ON public.market_prices;
CREATE POLICY market_prices_read ON public.market_prices FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.bot_performance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES public.bots(id) ON DELETE CASCADE,
  bot_name text NOT NULL,
  recorded_on date NOT NULL,
  pnl numeric NOT NULL,
  return_pct numeric NOT NULL,
  capital numeric NOT NULL,
  is_demo boolean NOT NULL DEFAULT true,
  UNIQUE (bot_name, recorded_on)
);
GRANT SELECT ON public.bot_performance_history TO anon, authenticated;
GRANT ALL ON public.bot_performance_history TO service_role;
ALTER TABLE public.bot_performance_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_performance_history_read ON public.bot_performance_history;
CREATE POLICY bot_performance_history_read ON public.bot_performance_history FOR SELECT TO anon, authenticated USING (true);

-- 6. Semillas demo de 60 días
INSERT INTO public.mining_hashrate_history (worker_id, worker_name, coin, recorded_on, hash_rate, hash_unit)
SELECT w.id, w.name, w.coin, d::date,
       round((w.hash_rate * (0.82 + 0.30 * abs(sin((extract(epoch from d)/86400)::numeric + length(w.name)))))::numeric, 2),
       w.hash_unit
FROM public.mining_workers w
CROSS JOIN generate_series(current_date - interval '59 days', current_date, interval '1 day') d
ON CONFLICT (worker_name, recorded_on) DO NOTHING;

INSERT INTO public.market_prices (symbol, recorded_on, price)
SELECT s.symbol, d::date,
       round((s.base * (0.88 + 0.22 * abs(sin((extract(epoch from d)/86400)::numeric * 0.35 + s.offs))))::numeric, 2)
FROM (VALUES ('BTCUSDT', 68000::numeric, 0.4::numeric),
             ('ETHUSDT', 3500, 1.1),
             ('SOLUSDT', 175, 2.3),
             ('BNBUSDT', 600, 3.7)) AS s(symbol, base, offs)
CROSS JOIN generate_series(current_date - interval '59 days', current_date, interval '1 day') d
ON CONFLICT (symbol, recorded_on) DO NOTHING;

INSERT INTO public.bot_performance_history (bot_id, bot_name, recorded_on, pnl, return_pct, capital)
SELECT b.id, b.name, d::date,
       round((b.pnl * (0.25 + 0.75 * (1 - (current_date - d::date)::numeric / 60)) * (0.8 + 0.4 * abs(sin((extract(epoch from d)/86400)::numeric + length(b.name)))))::numeric, 2),
       round((b.pnl / nullif(b.capital,0) * 100 * (0.3 + 0.7 * (1 - (current_date - d::date)::numeric / 60)))::numeric, 2),
       round((b.capital * (0.95 + 0.10 * abs(sin((extract(epoch from d)/86400)::numeric + length(b.name)))))::numeric, 2)
FROM public.bots b
CROSS JOIN generate_series(current_date - interval '59 days', current_date, interval '1 day') d
ON CONFLICT (bot_name, recorded_on) DO NOTHING;
