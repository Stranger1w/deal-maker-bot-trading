-- ============================================================
-- Multiusuario (14-oct) · user_id NOT NULL en las 15 tablas
--
-- Reconstruccion en el repo de lo que se aplico a mano en la base
-- el 2026-10-14. Idempotente: se puede volver a pegar sin efecto.
--
-- Que hace:
--   Las 15 tablas que son "una fila por usuario" pasan a exigir
--   user_id: no se puede crear una fila huerfana (sin dueño).
--
--   automation_settings   engine_sessions     engine_config
--   binance_credentials   exchange_credentials market_favorites
--   bots                  alerts              fund_accounts
--   training_sandboxes    recon_bots          mining_workers
--   mining_payouts        mining_sandboxes    performance_reports
--
-- Tablas que quedan INTENCIONALMENTE sin NOT NULL:
--   - audit_events: su user_id es ON DELETE SET NULL (al borrar el
--     usuario, la auditoria se conserva y el dueño queda a null).
--   - engine_runs: historico de ejecuciones del motor; se documenta
--     como global hasta que el tick lo escriba (pendiente Fase 3).
--   - Tablas hijas (heredan el dueño del padre, no llevan user_id):
--     bot_logs, bot_executions, bot_performance_history,
--     fund_transactions, training_runs, mining_hashrate_history,
--     mining_training_runs, recon_findings, recon_observations.
--
-- AVISO (codigo): con esta migracion, todo INSERT de estas tablas
-- DEBE llevar user_id. Si no lo lleva, el insert falla con 23502.
-- Al_apply este SQL, el motor, las alertas y los reportes del cron
-- dejan de funcionar hasta que el codigo escriba el user_id.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Ninguna fila huerfana antes de poner NOT NULL.
-- ------------------------------------------------------------
do $$
declare
  t text;
  huerfanas bigint;
begin
  foreach t in array array[
    'automation_settings','engine_sessions','engine_config',
    'binance_credentials','exchange_credentials','market_favorites',
    'bots','alerts','fund_accounts','training_sandboxes','recon_bots',
    'mining_workers','mining_payouts','mining_sandboxes','performance_reports'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Falta la tabla public.%: no se puede aplicar la migracion.', t;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      raise exception 'La tabla public.% no tiene columna user_id: aplicala antes la migracion de la Fase 1.', t;
    end if;

    execute format('select count(*) from public.%I where user_id is null', t) into huerfanas;
    if huerfanas > 0 then
      raise exception 'La tabla public.% tiene % filas sin user_id: asigna un dueño antes de continuar.', t, huerfanas;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2) NOT NULL en las 15 tablas.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'automation_settings','engine_sessions','engine_config',
    'binance_credentials','exchange_credentials','market_favorites',
    'bots','alerts','fund_accounts','training_sandboxes','recon_bots',
    'mining_workers','mining_payouts','mining_sandboxes','performance_reports'
  ] loop
    execute format('alter table public.%I alter column user_id set not null', t);
  end loop;
end $$;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select table_name, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and column_name = 'user_id'
--     and table_name in (
--       'automation_settings','engine_sessions','engine_config',
--       'binance_credentials','exchange_credentials','market_favorites',
--       'bots','alerts','fund_accounts','training_sandboxes','recon_bots',
--       'mining_workers','mining_payouts','mining_sandboxes','performance_reports')
--   order by table_name;
--
-- Lo esperado: 15 filas, todas con is_nullable = 'NO'.
-- Y ademas (opcional, contraste de que el indice de sesiones es
-- por usuario y no global):
--
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'engine_sessions';
-- ------------------------------------------------------------
