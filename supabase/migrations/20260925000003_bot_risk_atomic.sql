-- ============================================================================
-- P5 — Contadores de riesgo atomicos: evita leer-calcular-escribir entre el
-- cron y ticks manuales. Un solo UPDATE por ejecucion.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bot_apply_execution(
  p_bot_id uuid,
  p_pnl_delta numeric,
  p_loss_delta numeric,
  p_is_demo boolean,
  p_today date,
  p_week_start date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bots
  SET
    pnl = pnl + p_pnl_delta,
    peak_pnl = GREATEST(peak_pnl, pnl + p_pnl_delta),
    daily_loss = CASE WHEN risk_day <> p_today THEN p_loss_delta ELSE daily_loss + p_loss_delta END,
    weekly_loss = CASE WHEN risk_week <> p_week_start THEN p_loss_delta ELSE weekly_loss + p_loss_delta END,
    trades_today = CASE WHEN risk_day <> p_today THEN 1 ELSE trades_today + 1 END,
    demo_trades = CASE WHEN p_is_demo THEN demo_trades + 1 ELSE demo_trades END,
    risk_day = p_today,
    risk_week = p_week_start,
    last_tick_at = now(),
    updated_at = now()
  WHERE id = p_bot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bot_apply_execution(uuid, numeric, numeric, boolean, date, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_apply_execution(uuid, numeric, numeric, boolean, date, date) TO service_role;
