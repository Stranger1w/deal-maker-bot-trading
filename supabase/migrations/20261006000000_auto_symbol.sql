-- ============================================================
-- Fase 3 · Selección automática de activo (auto_symbol por bot)
-- Orden de aplicación:
--   1. 20261003000000_engine_foundation.sql (Fase 0: crea engine_config
--      con auto_symbol_min_volume y engine_strategies con auto_symbol)
--   2. ESTA migración (solo añade columnas de resultado/trazabilidad)
-- No toca ningún flag de trading: ni allow_real_trading,
-- ni allow_live_orders, ni engine_enabled, ni kill_switch,
-- ni app_settings.binance_trading_env.
-- ============================================================

ALTER TABLE public.engine_strategies
  ADD COLUMN IF NOT EXISTS auto_symbol_score numeric,
  ADD COLUMN IF NOT EXISTS auto_symbol_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_symbol_updated_at timestamptz;

-- La RLS y los GRANT ya vienen de la Fase 0 (service_role vía server
-- functions; la UI nunca consulta esta tabla desde el navegador).
