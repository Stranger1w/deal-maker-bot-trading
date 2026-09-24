-- Deal Maker ALL IN ONE - PARTE 5/5: recon + seed demo final.
-- Si pegaste PART1-4 con Run, pega este archivo completo igual.
INSERT INTO public.market_data_sources (name, kind, enabled, status, notes, is_demo) VALUES
  ('Binance Spot Klines', 'exchange', true, 'connected', 'OHLCV normalizado (publico, sin credenciales)', false),
  ('Binance Futures Funding', 'exchange', true, 'connected', 'Funding rate y open interest', false)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.recon_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'paused',
  sources text[] NOT NULL DEFAULT '{}',
  symbols text[] NOT NULL DEFAULT '{}',
  focus text NOT NULL DEFAULT 'price',
  interval_seconds integer NOT NULL DEFAULT 300,
  last_run_at timestamptz,
  observations_count integer NOT NULL DEFAULT 0,
  findings_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recon_bots TO anon, authenticated;
GRANT ALL ON public.recon_bots TO service_role;
ALTER TABLE public.recon_bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon_bots_read" ON public.recon_bots;
CREATE POLICY "recon_bots_read" ON public.recon_bots FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.recon_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_bot_id uuid REFERENCES public.recon_bots(id) ON DELETE CASCADE,
  bot_name text NOT NULL DEFAULT '',
  symbol text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  headline text NOT NULL,
  detail text NOT NULL DEFAULT '',
  confidence numeric NOT NULL DEFAULT 0,
  sources text[] NOT NULL DEFAULT '{}',
  is_demo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recon_findings TO anon, authenticated;
GRANT ALL ON public.recon_findings TO service_role;
ALTER TABLE public.recon_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon_findings_read" ON public.recon_findings;
CREATE POLICY "recon_findings_read" ON public.recon_findings FOR SELECT USING (true);

INSERT INTO public.alerts (category, severity, title, message, entity, is_demo)
SELECT 'engine', 'info', 'Motor en modo demo', 'Datos demo: motor detenido y trading real bloqueado.', 'automation', true
WHERE NOT EXISTS (SELECT 1 FROM public.alerts WHERE title = 'Motor en modo demo');
