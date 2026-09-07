CREATE TABLE public.market_data_sources (
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
CREATE POLICY "market_data_sources_read" ON public.market_data_sources FOR SELECT USING (true);

CREATE TABLE public.recon_bots (
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
CREATE POLICY "recon_bots_read" ON public.recon_bots FOR SELECT USING (true);

CREATE TABLE public.recon_observations (
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
CREATE INDEX recon_observations_symbol_idx ON public.recon_observations (symbol, observed_at DESC);
GRANT SELECT ON public.recon_observations TO anon, authenticated;
GRANT ALL ON public.recon_observations TO service_role;
ALTER TABLE public.recon_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recon_observations_read" ON public.recon_observations FOR SELECT USING (true);

CREATE TABLE public.recon_findings (
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
CREATE INDEX recon_findings_created_idx ON public.recon_findings (created_at DESC);
GRANT SELECT ON public.recon_findings TO anon, authenticated;
GRANT ALL ON public.recon_findings TO service_role;
ALTER TABLE public.recon_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recon_findings_read" ON public.recon_findings FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_market_data_sources_updated_at BEFORE UPDATE ON public.market_data_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER update_recon_bots_updated_at BEFORE UPDATE ON public.recon_bots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.market_data_sources (name, kind, enabled, status, notes, is_demo) VALUES
  ('Binance Spot Klines', 'exchange', true, 'connected', 'OHLCV normalizado (público, sin credenciales)', false),
  ('Binance Futures Funding', 'exchange', true, 'connected', 'Funding rate y open interest', false),
  ('Order Book Depth (demo)', 'orderbook', true, 'demo', 'Profundidad simulada para entrenamiento', true),
  ('Crypto News Feed (demo)', 'news', false, 'demo', 'Titulares agregados, pendiente de conectar', true);

INSERT INTO public.recon_bots (name, status, sources, symbols, focus, interval_seconds, last_run_at, observations_count, findings_count) VALUES
  ('Scout BTC', 'active', ARRAY['Binance Spot Klines','Order Book Depth (demo)'], ARRAY['BTCUSDT'], 'price', 300, now() - interval '4 minutes', 480, 6),
  ('Scout ETH Volumen', 'active', ARRAY['Binance Spot Klines'], ARRAY['ETHUSDT'], 'volume', 600, now() - interval '9 minutes', 310, 4),
  ('Scout Noticias', 'paused', ARRAY['Crypto News Feed (demo)'], ARRAY['BTCUSDT','ETHUSDT'], 'news', 1800, now() - interval '2 hours', 90, 1);

INSERT INTO public.recon_findings (recon_bot_id, bot_name, symbol, kind, severity, headline, detail, confidence, sources)
SELECT b.id, b.name, 'BTCUSDT', 'volume_spike', 'warning', 'Pico de volumen 2.4x sobre la media de 24h en BTCUSDT',
  'El volumen de la última hora superó 2.4 veces la media móvil de 24h mientras el precio subió 1.8%. Señal de continuación con posible volatilidad.', 0.72,
  ARRAY['Binance Spot Klines']
FROM public.recon_bots b WHERE b.name = 'Scout BTC';

INSERT INTO public.recon_findings (recon_bot_id, bot_name, symbol, kind, severity, headline, detail, confidence, sources)
SELECT b.id, b.name, 'ETHUSDT', 'trend_change', 'info', 'Cambio de tendencia a alcista en ETHUSDT (cruce de medias)',
  'La media de 20 periodos cruzó por encima de la de 50 con volumen creciente en las últimas 6 velas.', 0.58,
  ARRAY['Binance Spot Klines']
FROM public.recon_bots b WHERE b.name = 'Scout ETH Volumen';

INSERT INTO public.recon_observations (recon_bot_id, source, symbol, metric, value, meta, observed_at)
SELECT b.id, 'Binance Spot Klines', 'BTCUSDT', m.metric, m.value, '{"normalized":"ohlcv_v1"}'::jsonb, now() - (m.mins || ' minutes')::interval
FROM public.recon_bots b,
  (VALUES ('close', 64210.5, 5), ('volume', 1840.2, 5), ('close', 63980.1, 65), ('volume', 760.9, 65)) AS m(metric, value, mins)
WHERE b.name = 'Scout BTC';

INSERT INTO public.recon_observations (recon_bot_id, source, symbol, metric, value, meta, observed_at)
SELECT b.id, 'Binance Spot Klines', 'ETHUSDT', m.metric, m.value, '{"normalized":"ohlcv_v1"}'::jsonb, now() - (m.mins || ' minutes')::interval
FROM public.recon_bots b,
  (VALUES ('close', 3120.4, 10), ('volume', 9820.5, 10), ('close', 3088.7, 70), ('volume', 7410.3, 70)) AS m(metric, value, mins)
WHERE b.name = 'Scout ETH Volumen';