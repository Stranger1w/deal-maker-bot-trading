-- FASE 1 · Motor Temporizador / 24-7
--
-- P&L por rango: el pnl_total de una sesion se calcula sumando bot_executions.pnl
-- sobre created_at en el rango [session_started_at, session_stopped_at]:
--   SELECT COALESCE(SUM(pnl), 0) FROM bot_executions
--    WHERE created_at >= <session_started_at> AND created_at <= <session_stopped_at>;
-- Verificado contra el esquema real de bot_executions (pnl numeric, created_at timestamptz).
-- La transicion closing->closed debe ser idempotente: UPDATE ... WHERE status = 'closing'.

CREATE TABLE IF NOT EXISTS public.engine_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                text NOT NULL CHECK (mode IN ('timer','24x7')),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','closing','closed')),
  session_started_at  timestamptz NOT NULL DEFAULT now(),
  session_ends_at     timestamptz,
  session_stopped_at  timestamptz,
  close_reason        text CHECK (close_reason IN ('timer','kill_switch','manual','error')),
  runs_count          integer NOT NULL DEFAULT 0,
  orders_count        integer NOT NULL DEFAULT 0,
  errors_count        integer NOT NULL DEFAULT 0,
  pnl_total           numeric NOT NULL DEFAULT 0,
  last_tick_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timer_needs_end CHECK (mode <> 'timer' OR session_ends_at IS NOT NULL),
  CONSTRAINT closed_has_reason CHECK (
    status <> 'closed' OR (close_reason IS NOT NULL AND session_stopped_at IS NOT NULL)
  )
);

ALTER TABLE public.engine_sessions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS engine_sessions_one_active
  ON public.engine_sessions ((true))
  WHERE status IN ('active','closing');

CREATE INDEX IF NOT EXISTS engine_sessions_range
  ON public.engine_sessions (session_started_at, session_stopped_at);

REVOKE ALL ON public.engine_sessions FROM anon, authenticated;
GRANT ALL ON public.engine_sessions TO service_role;
