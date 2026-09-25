-- ============================================================================
-- P2b — Trazabilidad de ordenes reales: columna exchange_order_id (ID real
-- devuelto por Binance) + flag explicito de ejecucion live apagado por defecto.
-- Requiere: allow_real_trading=true + allow_live_orders=true + env production
-- para enviar a Binance real. Sin el flag, Real opera en testnet/dry-run.
-- ============================================================================
ALTER TABLE public.bot_executions
  ADD COLUMN IF NOT EXISTS exchange_order_id text;

ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS allow_live_orders boolean NOT NULL DEFAULT false;
