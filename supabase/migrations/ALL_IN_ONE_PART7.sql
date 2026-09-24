-- Deal Maker ALL IN ONE - PARTE 7/7: reparacion de desfase nube <-> codigo.
-- La nube se creo solo con PART1-5 y nunca recibio estas tablas/columnas
-- que el codigo ya usa. Todo es IF NOT EXISTS: seguro de pegar completo.
-- Pegalo en Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Debe decir "Success. No rows returned".

-- 1. Columnas faltantes en bots (el motor las escribe en cada tick)
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS risk_week date NOT NULL DEFAULT date_trunc('week', current_date)::date,
  ADD COLUMN IF NOT EXISTS risk_day date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS peak_pnl numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS take_profit_pct numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_weekly_drawdown_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS weekly_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demo_since date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS demo_trades integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_daily_loss numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS stop_loss_pct numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS max_drawdown_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_capital numeric NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS trades_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_stop_reason text;

-- 2. Columnas faltantes en automation_settings (riesgo global, capital, kill)
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS global_max_capital numeric NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS max_pair_concentration_pct numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS global_max_weekly_drawdown_pct numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS global_weekly_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_week date NOT NULL DEFAULT date_trunc('week', current_date)::date,
  ADD COLUMN IF NOT EXISTS min_demo_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS min_demo_trades integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS require_benchmark_outperformance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profit_policy text NOT NULL DEFAULT 'reinvest',
  ADD COLUMN IF NOT EXISTS profit_reserve_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS last_profit_sweep_on date,
  ADD COLUMN IF NOT EXISTS notify_email text,
  ADD COLUMN IF NOT EXISTS notify_email_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kill_switch_reason text,
  ADD COLUMN IF NOT EXISTS kill_switch_actor text,
  ADD COLUMN IF NOT EXISTS kill_switch_at timestamptz;

-- 3. Historial de ciclos del motor (salud del worker, pagina /automatizacion)
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

-- 4. Series historicas para las graficas (datos demo/seed)
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

-- 5. Observaciones crudas del escuadron de reconocimiento (dataset compartido)
CREATE TABLE IF NOT EXISTS public.recon_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_bot_id uuid REFERENCES public.recon_bots(id) ON DELETE CASCADE,
  source text NOT NULL,
  symbol text NOT NULL,
  metric text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recon_observations_symbol_idx ON public.recon_observations (symbol, observed_at DESC);
GRANT SELECT ON public.recon_observations TO anon, authenticated;
GRANT ALL ON public.recon_observations TO service_role;
ALTER TABLE public.recon_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon_observations_read" ON public.recon_observations;
CREATE POLICY "recon_observations_read" ON public.recon_observations FOR SELECT TO anon, authenticated USING (true);

-- 6. Semillas demo de 60 dias (solo si hay workers/bots; no duplica por UNIQUE)
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
