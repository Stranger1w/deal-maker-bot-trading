-- ============================================================
-- Multiusuario (14-oct) · app_settings solo para el administrador
--
-- Reconstruccion en el repo de lo que se aplico a mano en la base
-- el 2026-10-14. Idempotente: se puede volver a pegar sin efecto.
--
-- Que hace:
--   - Activa RLS en public.app_settings.
--   - anon y authenticated NO pueden leer ni escribir: el unico que
--     entra es service_role (el servidor). El panel de Supabase
--     (SQL Editor) es service_role, asi que el dueno sigue pudiendo
--     consultar y cambiar el entorno de trading a mano.
--   - La politica de lectura queda para el administrador de la app
--     (is_app_admin()), por si algun dia se abre a usuarios.
--
-- Que NO hace (a proposito):
--   - No toca binance_trading_env ni ningun flag de trading: solo
--     cambia QUIEN puede leer la tabla.
--
-- app_settings NO tiene user_id: es una tabla global de la plataforma
-- (clave/valor), no una fila por usuario. Por eso va en REVOKE, no en
-- la lista de "una fila por usuario".
-- ============================================================

begin;

-- 1) RLS activo: sin politica, nadie entra por la puerta de al lado.
alter table public.app_settings enable row level security;

-- 2) Se quitan las politicas anteriores (idempotencia).
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'app_settings'
  loop
    execute format('drop policy if exists %I on public.app_settings', r.policyname);
  end loop;
end $$;

-- 3) Politica: solo el administrador de la app (y service_role, que
--    ignora RLS). El service_role es el que usa el motor desde el servidor.
create policy app_settings_admin_read
  on public.app_settings
  for select
  to authenticated
  using (public.is_app_admin());

-- 4) Sin escritura desde el navegador: el motor y las server functions
--    escriben con service_role.
revoke all on public.app_settings from anon;
revoke all on public.app_settings from authenticated;
grant all on public.app_settings to service_role;

-- 5) Las funciones futuras no nacen ejecutables por todos.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select tablename, policyname, cmd, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'app_settings';
--
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'app_settings'
--   order by grantee, privilege_type;
--
-- Lo esperado:
--   * 1 sola politica: app_settings_admin_read (select, authenticated).
--   * anon: sin privilegios. authenticated: sin privilegios.
--     service_role: ALL.
--   * La lectura manual desde el SQL Editor sigue funcionando
--     (el SQL Editor usa service_role).
-- ------------------------------------------------------------
