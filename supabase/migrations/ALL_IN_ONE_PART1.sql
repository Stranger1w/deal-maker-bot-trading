-- Deal Maker ALL IN ONE - PARTE 1/5: base (funds, binance, bots).
-- Pega PART1 -> PART2 -> PART3 -> PART4 -> PART5 en orden en Supabase SQL Editor.
-- Primero, una sola vez: CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.fund_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'Main',
  currency text NOT NULL DEFAULT 'USDT',
  available_balance numeric(18,2) NOT NULL DEFAULT 0,
  in_use_balance numeric(18,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fund_accounts TO anon, authenticated;
GRANT ALL ON public.fund_accounts TO service_role;
ALTER TABLE public.fund_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fund_accounts_read" ON public.fund_accounts;
CREATE POLICY "fund_accounts_read" ON public.fund_accounts FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.fund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.fund_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deposit','withdrawal')),
  method text NOT NULL CHECK (method IN ('transfer','wallet','onchain')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fund_transactions TO anon, authenticated;
GRANT ALL ON public.fund_transactions TO service_role;
ALTER TABLE public.fund_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fund_transactions_read" ON public.fund_transactions;
CREATE POLICY "fund_transactions_read" ON public.fund_transactions FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_events TO anon, authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_events_read" ON public.audit_events;
CREATE POLICY "audit_events_read" ON public.audit_events FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.binance_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_last4 text NOT NULL,
  api_secret_last4 text NOT NULL,
  api_key_cipher text NOT NULL,
  api_secret_cipher text NOT NULL,
  market_mode text NOT NULL DEFAULT 'spot',
  connection_status text NOT NULL DEFAULT 'untested',
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.binance_credentials TO service_role;
ALTER TABLE public.binance_credentials ENABLE ROW LEVEL SECURITY;
DROP VIEW IF EXISTS public.binance_credentials_public;
CREATE VIEW public.binance_credentials_public
WITH (security_invoker = off) AS
  SELECT id, api_key_last4, api_secret_last4, market_mode, connection_status, last_tested_at, updated_at
  FROM public.binance_credentials;
GRANT SELECT ON public.binance_credentials_public TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  strategy text NOT NULL,
  pair text NOT NULL,
  capital numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'paused',
  mode text NOT NULL DEFAULT 'demo',
  demo_engine text NOT NULL DEFAULT 'binance_testnet',
  exchange text NOT NULL DEFAULT 'binance',
  pnl numeric(18,2) NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bots TO anon, authenticated;
GRANT ALL ON public.bots TO service_role;
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bots_read" ON public.bots;
CREATE POLICY "bots_read" ON public.bots FOR SELECT TO anon, authenticated USING (true);
