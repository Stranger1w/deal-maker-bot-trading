-- ============================================================================
-- P1.1 — Lockdown de exchange_credentials: la tabla base queda solo para
-- service_role; anon/authenticated solo ven la vista publica sin cifrados.
-- ============================================================================
REVOKE SELECT ON public.exchange_credentials FROM anon, authenticated;
REVOKE ALL ON public.exchange_credentials FROM anon, authenticated;
GRANT ALL ON public.exchange_credentials TO service_role;

DROP POLICY IF EXISTS "exchange_credentials_read_safe" ON public.exchange_credentials;

DROP VIEW IF EXISTS public.exchange_credentials_public;
CREATE VIEW public.exchange_credentials_public
WITH (security_invoker = off) AS
  SELECT
    id,
    exchange,
    label,
    api_key_last4,
    api_secret_last4,
    market_mode,
    connection_status,
    last_error_code,
    last_error_message,
    last_tested_at,
    created_at,
    updated_at
  FROM public.exchange_credentials;

REVOKE ALL ON public.exchange_credentials_public FROM anon, authenticated;
GRANT SELECT ON public.exchange_credentials_public TO anon, authenticated;
