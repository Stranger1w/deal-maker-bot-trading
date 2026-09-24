-- Punto 2: limites de riesgo reales por defecto (conservadores).
-- Solo aplica a filas todavia con los valores semilla (500/15/25/5000):
-- no pisa limites que el operador ya personalizo.
UPDATE public.automation_settings
SET global_max_daily_loss = 100,
    global_max_capital = 1000,
    global_max_drawdown_pct = 8,
    global_max_weekly_drawdown_pct = 12,
    tick_interval_seconds = 60,
    engine_enabled = false,
    allow_real_trading = false,
    updated_at = now()
WHERE global_max_daily_loss = 500
  AND global_max_capital = 5000;
