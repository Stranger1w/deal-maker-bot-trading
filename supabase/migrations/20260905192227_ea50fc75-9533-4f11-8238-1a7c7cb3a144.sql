ALTER TABLE public.binance_credentials DROP CONSTRAINT IF EXISTS binance_credentials_connection_status_check;
ALTER TABLE public.binance_credentials ADD CONSTRAINT binance_credentials_connection_status_check CHECK (connection_status IN ('untested','ok','failed','geo_restricted'));
ALTER TABLE public.binance_credentials ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE public.binance_credentials ADD COLUMN IF NOT EXISTS last_error_message text;
ALTER TABLE public.binance_credentials ADD COLUMN IF NOT EXISTS geo_restricted boolean NOT NULL DEFAULT false;
GRANT SELECT (last_error_code, last_error_message, geo_restricted) ON public.binance_credentials TO anon, authenticated;

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