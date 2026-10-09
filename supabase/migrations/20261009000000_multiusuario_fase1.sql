-- ============================================================
-- Multiusuario · Fase 1: dueño por fila y lectura por usuario
-- Aplicada a mano en la base el 2026-10-09. Idempotente.
-- No toca flags de trading ni binance_trading_env.
-- Todo lo que ya existia se asigna al primer admin de app_admins.
-- Las columnas user_id quedan SIN NOT NULL hasta la fase 2 (cuando
-- el codigo del servidor rellene user_id en cada insercion).
-- ============================================================

do $$
declare
  v_admin uuid;
  t text;
  x text[];
begin
  select user_id into v_admin from public.app_admins order by created_at limit 1;
  if v_admin is null then
    raise exception 'No hay ningun admin en app_admins: abortado';
  end if;

  -- 1) Dueño por fila y asignacion de lo existente al admin
  foreach t in array array[
    'bots','fund_accounts','alerts','audit_events','automation_settings',
    'binance_credentials','exchange_credentials','engine_sessions','engine_runs',
    'engine_config','mining_workers','mining_payouts','mining_sandboxes',
    'training_sandboxes','recon_bots','performance_reports','market_favorites'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format(
      'alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete %s',
      t, case when t = 'audit_events' then 'set null' else 'cascade' end);
    execute format('update public.%I set user_id = %L where user_id is null', t, v_admin);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);
  end loop;

  -- 2) Lectura: lo propio, o todo si eres admin
  foreach t in array array[
    'bots','fund_accounts','alerts','audit_events','automation_settings','engine_runs',
    'mining_workers','mining_payouts','mining_sandboxes','training_sandboxes',
    'recon_bots','performance_reports'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid() or public.is_app_admin())',
      t || '_read', t);
    execute format('revoke select on public.%I from anon', t);
  end loop;

  -- 3) Tablas hijas: heredan el dueño de su tabla padre
  foreach x slice 1 in array array[
    array['bot_logs','bots','bot_id'],
    array['bot_executions','bots','bot_id'],
    array['bot_performance_history','bots','bot_id'],
    array['fund_transactions','fund_accounts','account_id'],
    array['training_runs','training_sandboxes','sandbox_id'],
    array['mining_training_runs','mining_sandboxes','sandbox_id'],
    array['mining_hashrate_history','mining_workers','worker_id'],
    array['recon_findings','recon_bots','recon_bot_id'],
    array['recon_observations','recon_bots','recon_bot_id']
  ] loop
    if to_regclass('public.' || x[1]) is null or to_regclass('public.' || x[2]) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', x[1] || '_read', x[1]);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_app_admin() or exists (select 1 from public.%I p where p.id = %I and p.user_id = auth.uid()))',
      x[1] || '_read', x[1], x[2], x[3]);
    execute format('revoke select on public.%I from anon', x[1]);
  end loop;
end $$;

-- 4) Vistas de credenciales: cada uno ve solo las suyas
do $$
begin
  if to_regclass('public.binance_credentials') is not null then
    drop view if exists public.binance_credentials_public;
    create view public.binance_credentials_public with (security_invoker = off) as
      select id, api_key_last4, api_secret_last4, market_mode, connection_status,
             last_tested_at, geo_restricted, last_error_code, last_error_message,
             created_at, updated_at, user_id
      from public.binance_credentials
      where user_id = auth.uid() or public.is_app_admin();
    revoke all on public.binance_credentials_public from anon, authenticated;
    grant select on public.binance_credentials_public to authenticated;
  end if;

  if to_regclass('public.exchange_credentials') is not null then
    drop view if exists public.exchange_credentials_public;
    create view public.exchange_credentials_public with (security_invoker = off) as
      select id, exchange, label, api_key_last4, api_secret_last4, market_mode,
             connection_status, last_error_code, last_error_message,
             last_tested_at, created_at, updated_at, user_id
      from public.exchange_credentials
      where user_id = auth.uid() or public.is_app_admin();
    revoke all on public.exchange_credentials_public from anon, authenticated;
    grant select on public.exchange_credentials_public to authenticated;
  end if;
end $$;

-- 5) Funciones SECURITY DEFINER: solo service_role puede ejecutarlas
do $$
begin
  if to_regprocedure('public.bot_apply_execution(uuid,numeric,numeric,boolean,date,date)') is not null then
    revoke execute on function public.bot_apply_execution(uuid,numeric,numeric,boolean,date,date)
      from public, anon, authenticated;
    grant execute on function public.bot_apply_execution(uuid,numeric,numeric,boolean,date,date)
      to service_role;
  end if;
  if to_regprocedure('public.is_app_admin()') is not null then
    grant execute on function public.is_app_admin() to authenticated;
  end if;
end $$;

-- Las funciones futuras no nacen ejecutables por todos
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
