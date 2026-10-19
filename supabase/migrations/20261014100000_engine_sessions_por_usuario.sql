-- ============================================================
-- Multiusuario (14-oct) · engine_sessions por usuario
--
-- Reconstruccion en el repo de lo que se aplico a mano en la base
-- el 2026-10-14. Idempotente: se puede volver a pegar sin efecto.
--
-- Que hace:
--   1) engine_sessions.user_id pasa a NOT NULL (una sesion SIEMPRE
--      tiene dueño).
--   2) El indice unico de "una sesion viva" deja de ser global:
--      pasa a ser POR USUARIO. Antes era
--          create unique index ... on engine_sessions ((true))
--          where status in ('active','closing')
--      o sea: como maximo UNA sesion viva en TODA la base. Con dos
--      usuarios, el segundo recibia la sesion del primero (error
--      23505 -> el codigo devolvia la fila ajena).
--      Ahora: una sesion viva por usuario.
--
-- Que NO hace (a proposito):
--   - No toca flags de trading ni binance_trading_env.
--   - No borra historial: solo ajusta el indice y la columna.
--   - No abre la tabla al navegador: sigue siendo service_role
--     (la UI pasa por server functions).
--
-- NOTA IMPORTANTE (codigo): con esta migracion, engine_sessions.user_id
-- es NOT NULL. El codigo que inserta sesiones DEBE escribir user_id
-- (src/lib/engine-sessions.server.ts -> iniciarSesion). Si no lo hace,
-- el insert falla con 23502 y "Iniciar motor" deja de funcionar.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Ninguna sesion huerfana antes de poner NOT NULL.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.engine_sessions') is null then
    raise exception 'Falta la tabla public.engine_sessions (migracion 20261005000000_engine_sessions.sql).';
  end if;

  if exists (select 1 from public.engine_sessions where user_id is null) then
    raise exception 'engine_sessions tiene filas sin user_id: asigna un dueño antes de continuar.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) user_id NOT NULL + indice por usuario.
-- ------------------------------------------------------------
alter table public.engine_sessions
  alter column user_id set not null;

-- El indice global se va (una sesion viva para toda la plataforma).
drop index if exists public.engine_sessions_one_active;

-- Una sesion viva (active/closing) por usuario.
create unique index if not exists engine_sessions_one_active
  on public.engine_sessions (user_id)
  where status in ('active', 'closing');

-- Historial por usuario (lecturas del panel del Motor).
create index if not exists engine_sessions_user_range_idx
  on public.engine_sessions (user_id, session_started_at desc);

-- RLS: activa, sin filas para anon/authenticated. El motor y las
-- server functions leen con service_role filtrando por user_id.
alter table public.engine_sessions enable row level security;

revoke all on public.engine_sessions from anon;
revoke all on public.engine_sessions from authenticated;
grant all on public.engine_sessions to service_role;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'engine_sessions';
--
--   select column_name, is_nullable, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'engine_sessions'
--     and column_name = 'user_id';
--
-- Lo esperado:
--   * engine_sessions_one_active -> UNIQUE (user_id) WHERE status IN
--     ('active','closing')   [NO debe verse "ON ((true))"]
--   * user_id -> is_nullable = 'NO'
-- ------------------------------------------------------------
