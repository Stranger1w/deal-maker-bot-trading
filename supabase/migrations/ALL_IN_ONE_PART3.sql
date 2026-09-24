-- Deal Maker ALL IN ONE - PARTE 3/5: riesgo por bot, motor, alertas.

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_daily_loss numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS stop_loss_pct numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS take_profit_pct numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_drawdown_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_weekly_drawdown_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS max_capital numeric NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS trades_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_stop_reason text,
  ADD COLUMN IF NOT EXISTS demo_since date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS demo_trades integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  allow_real_trading boolean NOT NULL DEFAULT false,
  tick_interval_seconds integer NOT NULL DEFAULT 60,
  global_max_daily_loss numeric NOT NULL DEFAULT 500,
  global_max_capital numeric NOT NULL DEFAULT 5000,
  global_max_drawdown_pct numeric NOT NULL DEFAULT 15,
  global_max_weekly_drawdown_pct numeric NOT NULL DEFAULT 25,
  engine_status text NOT NULL DEFAULT 'stopped',
  last_heartbeat_at timestamptz,
  last_error text,
  notify_email text,
  notify_email_enabled boolean NOT NULL DEFAULT false,
  profit_policy text NOT NULL DEFAULT 'reinvest',
  profit_reserve_pct numeric NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.automation_settings TO anon, authenticated;
GRANT ALL ON public.automation_settings TO service_role;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_settings_read ON public.automation_settings;
CREATE POLICY automation_settings_read ON public.automation_settings FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.automation_settings (id)
SELECT '44444444-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM public.automation_settings);

CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text NOT NULL,
  entity text,
  entity_id text,
  acknowledged boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  delivery_status text NOT NULL DEFAULT 'in_app_only',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.alerts TO anon, authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerts_read ON public.alerts;
CREATE POLICY alerts_read ON public.alerts FOR SELECT TO anon, authenticated USING (true);
