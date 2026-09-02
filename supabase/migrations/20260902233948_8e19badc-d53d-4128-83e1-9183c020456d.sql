
DROP VIEW IF EXISTS public.binance_credentials_public;

CREATE POLICY "binance_credentials_read_masked" ON public.binance_credentials
  FOR SELECT TO anon, authenticated USING (true);

-- Column-level grants: cipher columns are NOT readable by anon/authenticated.
GRANT SELECT (id, api_key_last4, api_secret_last4, market_mode, connection_status, last_tested_at, created_at, updated_at)
  ON public.binance_credentials TO anon, authenticated;
