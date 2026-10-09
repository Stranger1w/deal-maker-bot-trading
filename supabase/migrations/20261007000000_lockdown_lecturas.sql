-- Cierre de lecturas publicas y escrituras (aplicado a mano en la base el 2026-10-07).
-- Idempotente y segura en una base nueva. No toca flags de trading ni binance_trading_env.

do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated',
      r.relname);
  end loop;
end $$;

do $$ begin
  if to_regclass('public.binance_credentials') is not null then
    revoke all on public.binance_credentials from anon, authenticated;
  end if;
end $$;

do $$ begin
  if to_regclass('public.app_admins') is not null then
    revoke all on public.app_admins from anon, authenticated;
  end if;
end $$;

do $$ begin
  if to_regclass('public.binance_credentials_public') is not null then
    revoke all on public.binance_credentials_public from anon, authenticated;
    grant select on public.binance_credentials_public to authenticated;
  end if;
end $$;

do $$ begin
  if to_regclass('public.exchange_credentials_public') is not null then
    revoke select on public.exchange_credentials_public from anon;
    grant select on public.exchange_credentials_public to authenticated;
  end if;
end $$;

do $$ begin
  if to_regclass('public.exchange_credentials') is not null then
    drop policy if exists exchange_credentials_read_safe on public.exchange_credentials;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'bots','bot_logs','bot_executions','bot_performance_history',
    'fund_accounts','fund_transactions','audit_events','alerts',
    'automation_settings','performance_reports','engine_runs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_read', t);
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.is_app_admin())',
        t || '_read', t);
      execute format('revoke select on public.%I from anon', t);
    end if;
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon, authenticated;