-- Deal Maker ALL IN ONE - PARTE 4/5: reportes, ejecuciones, region, multi-exchange.

CREATE TABLE IF NOT EXISTS public.performance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,
  scope text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  email_status text NOT NULL DEFAULT 'not_configured',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, scope, period_start)
);
GRANT SELECT ON public.performance_reports TO anon, authenticated;
GRANT ALL ON public.performance_reports TO service_role;
ALTER TABLE public.performance_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS performance_reports_read ON public.performance_reports;
CREATE POLICY performance_reports_read ON public.performance_reports FOR SELECT TO anon, authenticated USING (true);

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

ALTER TABLE public.binance_credentials ADD COLUMN IF NOT EXISTS geo_restricted boolean NOT NULL DEFAULT false;
ALTER TABLE public.binance_credentials ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE public.binance_credentials ADD COLUMN IF NOT EXISTS last_error_message text;

CREATE TABLE IF NOT EXISTS public.backend_region_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  colo text,
  country text,
  binance_status integer,
  binance_restricted boolean NOT NULL DEFAULT false,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.backend_region_probes TO anon, authenticated;
GRANT ALL ON public.backend_region_probes TO service_role;
ALTER TABLE public.backend_region_probes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backend_region_probes_read ON public.backend_region_probes;
CREATE POLICY backend_region_probes_read ON public.backend_region_probes FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE IF NOT EXISTS public.exchange_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange text NOT NULL UNIQUE,
  label text NOT NULL,
  api_key_last4 text NOT NULL,
  api_secret_last4 text NOT NULL,
  api_key_cipher text NOT NULL,
  api_secret_cipher text NOT NULL,
  passphrase_cipher text,
  market_mode text NOT NULL DEFAULT 'spot',
  connection_status text NOT NULL DEFAULT 'untested',
  last_error_code text,
  last_error_message text,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exchange_credentials TO anon, authenticated;
GRANT ALL ON public.exchange_credentials TO service_role;
ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exchange_credentials_read_safe" ON public.exchange_credentials;
CREATE POLICY "exchange_credentials_read_safe" ON public.exchange_credentials FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.market_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'exchange',
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown',
  last_sync_at timestamptz,
  notes text,
  is_demo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_data_sources TO anon, authenticated;
GRANT ALL ON public.market_data_sources TO service_role;
ALTER TABLE public.market_data_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "market_data_sources_read" ON public.market_data_sources;
CREATE POLICY "market_data_sources_read" ON public.market_data_sources FOR SELECT USING (true);

-- Seed mínimo (todo marcado is_demo donde aplica)
INSERT INTO public.fund_accounts (id, label, currency, available_balance, in_use_balance) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Main Treasury', 'USDT', 48250.75, 21400.00)
ON CONFLICT (id) DO NOTHING;
