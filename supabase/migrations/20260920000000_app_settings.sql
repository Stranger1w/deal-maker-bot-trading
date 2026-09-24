-- ============ APP SETTINGS (estado/persitencia app) ============
-- Tabla genérica de configuración de app y estado ligero.
-- `key` único para upserts simples. RLS abierto para lectura; escritura via RPC service_role.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_read" ON public.app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "app_settings_write" ON public.app_settings FOR ALL TO authenticated USING (true);

-- Estado del entorno de trading: 'testnet' (default) | 'production'.
INSERT INTO public.app_settings (key, value, notes)
  VALUES ('binance_trading_env', 'testnet', 'Entorno de trading real. Testnet por defecto; production requiere doble confirmación.')
  ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS app_settings_key_idx ON public.app_settings (key);