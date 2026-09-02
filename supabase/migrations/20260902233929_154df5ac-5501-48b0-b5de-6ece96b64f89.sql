
-- ============ FUNDS ============
CREATE TABLE public.fund_accounts (
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
CREATE POLICY "fund_accounts_read" ON public.fund_accounts FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.fund_transactions (
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
CREATE POLICY "fund_transactions_read" ON public.fund_transactions FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.audit_events (
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
CREATE POLICY "audit_events_read" ON public.audit_events FOR SELECT TO anon, authenticated USING (true);

-- ============ BINANCE CREDENTIALS (secret encrypted, backend only) ============
CREATE TABLE public.binance_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_last4 text NOT NULL,
  api_secret_last4 text NOT NULL,
  api_key_cipher text NOT NULL,
  api_secret_cipher text NOT NULL,
  market_mode text NOT NULL DEFAULT 'spot' CHECK (market_mode IN ('spot','futures','both')),
  connection_status text NOT NULL DEFAULT 'untested' CHECK (connection_status IN ('untested','ok','failed')),
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.binance_credentials TO service_role;
ALTER TABLE public.binance_credentials ENABLE ROW LEVEL SECURITY;

-- Safe public view: never exposes cipher columns
CREATE VIEW public.binance_credentials_public
WITH (security_invoker = off) AS
  SELECT id, api_key_last4, api_secret_last4, market_mode, connection_status, last_tested_at, updated_at
  FROM public.binance_credentials;
GRANT SELECT ON public.binance_credentials_public TO anon, authenticated;

-- ============ TRADING BOTS ============
CREATE TABLE public.bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  strategy text NOT NULL,
  pair text NOT NULL,
  capital numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('running','paused','training','stopped')),
  mode text NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo','real')),
  demo_engine text NOT NULL DEFAULT 'binance_testnet' CHECK (demo_engine IN ('binance_testnet','internal_simulator')),
  exchange text NOT NULL DEFAULT 'binance',
  pnl numeric(18,2) NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bots TO anon, authenticated;
GRANT ALL ON public.bots TO service_role;
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bots_read" ON public.bots FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bot_logs TO anon, authenticated;
GRANT ALL ON public.bot_logs TO service_role;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bot_logs_read" ON public.bot_logs FOR SELECT TO anon, authenticated USING (true);

-- ============ TRAINING GROUND ============
CREATE TABLE public.training_sandboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  dataset text NOT NULL DEFAULT 'binance-klines-1h',
  date_from date NOT NULL,
  date_to date NOT NULL,
  pairs text[] NOT NULL DEFAULT ARRAY['BTCUSDT']::text[],
  simulated_capital numeric(18,2) NOT NULL DEFAULT 10000,
  speed integer NOT NULL DEFAULT 10 CHECK (speed BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','running','completed','failed')),
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
CREATE POLICY "training_sandboxes_read" ON public.training_sandboxes FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.training_runs (
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
CREATE POLICY "training_runs_read" ON public.training_runs FOR SELECT TO anon, authenticated USING (true);

-- ============ MINING SWARM ============
CREATE TABLE public.mining_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coin text NOT NULL,
  pool text NOT NULL,
  rig_id text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('mining','idle','offline')),
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
CREATE POLICY "mining_workers_read" ON public.mining_workers FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.mining_payouts (
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
CREATE POLICY "mining_payouts_read" ON public.mining_payouts FOR SELECT TO anon, authenticated USING (true);

-- ============ SEED DATA ============
INSERT INTO public.fund_accounts (id, label, currency, available_balance, in_use_balance) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Main Treasury', 'USDT', 48250.75, 21400.00);

INSERT INTO public.fund_transactions (account_id, kind, method, amount, status, reference, created_at) VALUES
  ('11111111-1111-1111-1111-111111111111','deposit','transfer',25000.00,'completed','WIRE-8841', now() - interval '21 days'),
  ('11111111-1111-1111-1111-111111111111','deposit','onchain',18500.00,'completed','0xa91f...c4', now() - interval '14 days'),
  ('11111111-1111-1111-1111-111111111111','withdrawal','wallet',5000.00,'completed','WD-2201', now() - interval '9 days'),
  ('11111111-1111-1111-1111-111111111111','deposit','wallet',32000.00,'completed','WL-5512', now() - interval '5 days'),
  ('11111111-1111-1111-1111-111111111111','withdrawal','onchain',1250.00,'pending','WD-2288', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111','deposit','transfer',900.00,'failed','WIRE-8902', now() - interval '1 day');

INSERT INTO public.audit_events (action, entity, entity_id, details, created_at) VALUES
  ('deposit.created','fund_transaction','WIRE-8841','{"amount":25000,"method":"transfer"}', now() - interval '21 days'),
  ('withdrawal.created','fund_transaction','WD-2201','{"amount":5000,"method":"wallet"}', now() - interval '9 days'),
  ('bot.mode_changed','bot','Momentum Alpha','{"from":"demo","to":"real"}', now() - interval '6 days'),
  ('withdrawal.created','fund_transaction','WD-2288','{"amount":1250,"method":"onchain"}', now() - interval '2 days');

INSERT INTO public.bots (id, name, strategy, pair, capital, status, mode, demo_engine, pnl, win_rate) VALUES
  ('22222222-0000-0000-0000-000000000001','Momentum Alpha','momentum','BTCUSDT',12000,'running','real','binance_testnet',3184.20,63.40),
  ('22222222-0000-0000-0000-000000000002','Grid Titan','grid','ETHUSDT',6400,'running','demo','binance_testnet',842.15,58.10),
  ('22222222-0000-0000-0000-000000000003','Mean Reverter','mean_reversion','SOLUSDT',3000,'paused','demo','internal_simulator',-215.40,47.20),
  ('22222222-0000-0000-0000-000000000004','Breakout Hawk','breakout','BTCUSDT',5000,'training','demo','internal_simulator',0,0),
  ('22222222-0000-0000-0000-000000000005','Scalper Nine','scalping','BNBUSDT',2500,'stopped','demo','internal_simulator',126.80,51.90);

INSERT INTO public.bot_logs (bot_id, level, message, created_at) VALUES
  ('22222222-0000-0000-0000-000000000001','info','Orden LONG BTCUSDT ejecutada a 64,180.50', now() - interval '3 hours'),
  ('22222222-0000-0000-0000-000000000001','warn','Slippage por encima del umbral (0.18%)', now() - interval '2 hours'),
  ('22222222-0000-0000-0000-000000000002','info','Rejilla recalculada: 12 niveles activos', now() - interval '5 hours'),
  ('22222222-0000-0000-0000-000000000003','error','Conexión de datos interrumpida, bot pausado', now() - interval '1 day'),
  ('22222222-0000-0000-0000-000000000004','info','Entrenamiento acelerado 10x en curso', now() - interval '30 minutes');

INSERT INTO public.training_sandboxes (id, name, dataset, date_from, date_to, pairs, simulated_capital, speed, status, return_pct, drawdown_pct, win_rate, ai_sources, ai_notes) VALUES
  ('33333333-0000-0000-0000-000000000001','Sandbox Q1 Volatilidad','binance-klines-1h','2025-01-01','2025-03-31', ARRAY['BTCUSDT','ETHUSDT'], 25000, 25, 'completed', 14.80, 6.20, 61.50,
   '[{"source":"Binance Spot Klines","range":"2025-01-01 → 2025-03-31"},{"source":"Binance Futures Funding","range":"2025-01-01 → 2025-03-31"},{"source":"On-chain flows (agregado)","range":"2025-01-01 → 2025-03-31"}]'::jsonb,
   'La capa de IA normalizó velas 1h de 3 fuentes y ajustó el stop dinámico de 1.8% a 1.2% tras detectar clusters de volatilidad.'),
  ('33333333-0000-0000-0000-000000000002','Sandbox Rango Lateral','binance-klines-15m','2024-09-01','2024-12-31', ARRAY['SOLUSDT'], 10000, 50, 'ready', NULL, NULL, NULL,
   '[{"source":"Binance Spot Klines","range":"2024-09-01 → 2024-12-31"}]'::jsonb, NULL);

INSERT INTO public.training_runs (sandbox_id, bot_id, bot_name, return_pct, drawdown_pct, win_rate, promoted, suggested_params) VALUES
  ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000004','Breakout Hawk',18.40,7.10,64.20,false,'{"stop_loss":"1.2%","take_profit":"3.4%","timeframe":"1h"}'::jsonb),
  ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000003','Mean Reverter',9.10,5.30,57.80,true,'{"z_score":2.1,"lookback":48}'::jsonb);

INSERT INTO public.mining_workers (name, coin, pool, rig_id, status, hash_rate, hash_unit, uptime_seconds, estimated_daily_earnings) VALUES
  ('Rig-Norte-01','BTC','Foundry USA','RIG-N01','mining',118.40,'TH/s',864000,42.30),
  ('Rig-Norte-02','BTC','Foundry USA','RIG-N02','mining',96.20,'TH/s',432000,34.10),
  ('Rig-Sur-01','ETC','2Miners','RIG-S01','idle',480.00,'MH/s',216000,6.80),
  ('Rig-Sur-02','KAS','Kaspa Pool','RIG-S02','offline',0,'GH/s',0,0),
  ('Rig-Este-01','KAS','Kaspa Pool','RIG-E01','mining',1.85,'GH/s',604800,11.50);

INSERT INTO public.mining_payouts (coin, pool, amount, usd_value, paid_at) VALUES
  ('BTC','Foundry USA',0.01240000,812.40, now() - interval '1 day'),
  ('BTC','Foundry USA',0.01185000,776.10, now() - interval '8 days'),
  ('ETC','2Miners',3.42000000,88.90, now() - interval '3 days'),
  ('KAS','Kaspa Pool',9820.00000000,412.60, now() - interval '2 days'),
  ('KAS','Kaspa Pool',10140.00000000,438.20, now() - interval '9 days');
