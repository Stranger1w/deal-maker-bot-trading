-- Riesgo por bot
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS take_profit_pct numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_weekly_drawdown_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS weekly_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_week date NOT NULL DEFAULT date_trunc('week', current_date)::date,
  ADD COLUMN IF NOT EXISTS demo_since date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS demo_trades integer NOT NULL DEFAULT 0;

-- Riesgo global / motor / capital / notificaciones
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS global_max_capital numeric NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS max_pair_concentration_pct numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS global_max_weekly_drawdown_pct numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS global_weekly_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_week date NOT NULL DEFAULT date_trunc('week', current_date)::date,
  ADD COLUMN IF NOT EXISTS min_demo_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS min_demo_trades integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS require_benchmark_outperformance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profit_policy text NOT NULL DEFAULT 'reinvest',
  ADD COLUMN IF NOT EXISTS profit_reserve_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS last_profit_sweep_on date,
  ADD COLUMN IF NOT EXISTS notify_email text,
  ADD COLUMN IF NOT EXISTS notify_email_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kill_switch_reason text,
  ADD COLUMN IF NOT EXISTS kill_switch_actor text,
  ADD COLUMN IF NOT EXISTS kill_switch_at timestamptz;

-- Alertas in-app (con estado de entrega por email/push)
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
GRANT SELECT ON public.alerts TO anon;
GRANT SELECT ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerts_read ON public.alerts;
CREATE POLICY alerts_read ON public.alerts FOR SELECT TO anon, authenticated USING (true);

-- Reportes periódicos de performance
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
GRANT SELECT ON public.performance_reports TO anon;
GRANT SELECT ON public.performance_reports TO authenticated;
GRANT ALL ON public.performance_reports TO service_role;
ALTER TABLE public.performance_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS performance_reports_read ON public.performance_reports;
CREATE POLICY performance_reports_read ON public.performance_reports FOR SELECT TO anon, authenticated USING (true);

-- Datos demo claramente marcados
INSERT INTO public.alerts (category, severity, title, message, entity, is_demo)
VALUES
  ('engine', 'info', 'Motor en modo demo', 'Datos demo: el motor de automatización está detenido y el trading real permanece bloqueado.', 'automation', true),
  ('binance', 'warning', 'Binance sin verificar', 'Datos demo: verifica tus API Keys de Binance (sin permisos de retiro) y la whitelist de IP.', 'binance', true),
  ('funds', 'info', 'Movimiento registrado', 'Datos demo: se registró un depósito pendiente en Fondos.', 'fund_transaction', true)
ON CONFLICT DO NOTHING;
