-- Deal Maker: campo de entrenamiento para bots de MINERÍA (opción B).
-- Los workers son simulados/estrategia (rentabilidad), no hardware real.
-- Tablas separadas del training de trading (training_sandboxes/training_runs).

CREATE TABLE IF NOT EXISTS public.mining_sandboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coins text[] NOT NULL DEFAULT ARRAY['BTC']::text[],
  pools text[] NOT NULL DEFAULT ARRAY['Foundry USA']::text[],
  simulated_hash_rate numeric(14,2) NOT NULL DEFAULT 100,
  simulated_hash_unit text NOT NULL DEFAULT 'TH/s',
  power_cost_usd_kwh numeric(8,4) NOT NULL DEFAULT 0.12,
  date_from date NOT NULL,
  date_to date NOT NULL,
  speed integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'ready',
  best_coin text,
  best_pool text,
  estimated_daily_usd numeric(12,2),
  ai_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mining_sandboxes TO anon, authenticated;
GRANT ALL ON public.mining_sandboxes TO service_role;
ALTER TABLE public.mining_sandboxes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mining_sandboxes_read" ON public.mining_sandboxes;
CREATE POLICY "mining_sandboxes_read" ON public.mining_sandboxes FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.mining_training_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id uuid NOT NULL REFERENCES public.mining_sandboxes(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.mining_workers(id) ON DELETE SET NULL,
  worker_name text NOT NULL,
  coin text NOT NULL,
  pool text NOT NULL,
  hash_rate numeric(14,2) NOT NULL DEFAULT 0,
  hash_unit text NOT NULL DEFAULT 'TH/s',
  gross_daily_usd numeric(12,2) NOT NULL DEFAULT 0,
  power_daily_usd numeric(12,2) NOT NULL DEFAULT 0,
  net_daily_usd numeric(12,2) NOT NULL DEFAULT 0,
  promoted boolean NOT NULL DEFAULT false,
  suggested_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mining_training_runs TO anon, authenticated;
GRANT ALL ON public.mining_training_runs TO service_role;
ALTER TABLE public.mining_training_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mining_training_runs_read" ON public.mining_training_runs;
CREATE POLICY "mining_training_runs_read" ON public.mining_training_runs FOR SELECT TO anon, authenticated USING (true);