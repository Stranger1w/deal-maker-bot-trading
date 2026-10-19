-- ============================================================
-- Diario del motor: un registro por ciclo con lo que hizo cada bot
--
-- Que anade
--   public.engine_cycles
--     id            uuid
--     user_id       uuid  (dueno de la plataforma: el motor es global)
--     started_at    timestamptz
--     finished_at   timestamptz
--     trigger       text  ('cron' | 'manual')
--     status        text  ('completed' | 'halted' | 'idle' | 'failed')
--     bots_processed integer
--     orders_created  integer
--     errors          integer
--     duration_ms     integer
--     notes           text
--     decisions       jsonb  (una linea por bot: accion, motivo y detalle)
--
-- Por que
-- "Mi bot no opera y no se por que" es la pregunta mas frustrante de las
-- que se le hacen a un bot. Sin este registro, los motivos estaban
-- dispersos en el log de cada bot y no se podian ver de una vez.
--
-- El motor escribe la fila SIEMPRE (best-effort): si esta tabla no existe
-- todavia (migracion sin aplicar), el motor sigue funcionando igual, solo
-- que no queda el diario.
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

begin;

create table if not exists public.engine_cycles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text not null default 'cron',
  status          text,
  bots_processed  integer not null default 0,
  orders_created  integer not null default 0,
  errors          integer not null default 0,
  duration_ms     integer,
  notes           text,
  decisions       jsonb not null default '[]'::jsonb
);

create index if not exists engine_cycles_finished_idx
  on public.engine_cycles (finished_at desc nulls last);

create index if not exists engine_cycles_user_idx
  on public.engine_cycles (user_id, finished_at desc nulls last);

-- Misma politica que el resto de tablas del motor: solo service_role.
alter table public.engine_cycles enable row level security;
revoke all on public.engine_cycles from anon;
revoke all on public.engine_cycles from authenticated;
grant all on public.engine_cycles to service_role;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select count(*) as ciclos, max(finished_at) as ultimo
--   from public.engine_cycles;
--
-- Lo esperado: 0 filas hasta que el motor corra un ciclo (la tabla se crea
-- vacia). Si el motor ya esta corriendo y aun asi sale 0, es que la
-- migracion no se ha aplicado.
-- ------------------------------------------------------------
