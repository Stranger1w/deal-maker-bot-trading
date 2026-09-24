-- Deal Maker ALL IN ONE - PARTE 2/5: logs, training, mining.

CREATE TABLE IF NOT EXISTS public.bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bot_logs TO anon, authenticated;
GRANT ALL ON public.bot_logs TO service_role;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bot_logs_read" ON public.bot_logs;
CREATE POLICY "bot_logs_read" ON public.bot_logs FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.training_sandboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  dataset text NOT NULL DEFAULT 'binance-klines-1h',
  date_from date NOT NULL,
  date_to date NOT NULL,
  pairs text[] NOT NULL DEFAULT ARRAY['BTCUSDT']::text[],
  simulated_capital numeric(18,2) NOT NULL DEFAULT 10000,
  speed integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'ready',
  return_pct numeric(8,2),
  drawdown_pct numeric(8,2),
  win_rate numeric(5,2),
  ai_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.training_sandboxes TO anon, authenticated;
GRANT ALL ON public.training_sandboxes TO service_role;
ALTER TABLE public.training_sandboxes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_sandboxes_read" ON public.training_sandboxes;
CREATE POLICY "training_sandboxes_read" ON public.training_sandboxes FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.training_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id uuid NOT NULL REFERENCES public.training_sandboxes(id) ON DELETE CASCADE,
  bot_id uuid REFERENCES public.bots(id) ON DELETE SET NULL,
  bot_name text NOT NULL,
  return_pct numeric(8,2) NOT NULL DEFAULT 0,
  drawdown_pct numeric(8,2) NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  promoted boolean NOT NULL DEFAULT false,
  suggested_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.training_runs TO anon, authenticated;
GRANT ALL ON public.training_runs TO service_role;
ALTER TABLE public.training_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_runs_read" ON public.training_runs;
CREATE POLICY "training_runs_read" ON public.training_runs FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.mining_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coin text NOT NULL,
  pool text NOT NULL,
  rig_id text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  hash_rate numeric(12,2) NOT NULL DEFAULT 0,
  hash_unit text NOT NULL DEFAULT 'MH/s',
  uptime_seconds bigint NOT NULL DEFAULT 0,
  estimated_daily_earnings numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mining_workers TO anon, authenticated;
GRANT ALL ON public.mining_workers TO service_role;
ALTER TABLE public.mining_workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mining_workers_read" ON public.mining_workers;
CREATE POLICY "mining_workers_read" ON public.mining_workers FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.mining_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coin text NOT NULL,
  pool text NOT NULL,
  amount numeric(18,8) NOT NULL,
  usd_value numeric(12,2) NOT NULL DEFAULT 0,
  paid_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mining_payouts TO anon, authenticated;
GRANT ALL ON public.mining_payouts TO service_role;
ALTER TABLE public.mining_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mining_payouts_read" ON public.mining_payouts;
CREATE POLICY "mining_payouts_read" ON public.mining_payouts FOR SELECT TO anon, authenticated USING (true);
