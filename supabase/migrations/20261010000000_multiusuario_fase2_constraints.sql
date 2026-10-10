-- Multiusuario, Fase 2: restricciones de unicidad por usuario.
--
-- Que hace:
--   exchange_credentials   UNIQUE(exchange)            -> UNIQUE(user_id, exchange)
--   market_favorites       PK(exchange, symbol)        -> PK(user_id, exchange, symbol)
--   bot_performance_history UNIQUE(bot_name, recorded_on) -> UNIQUE(bot_id, recorded_on)
--   engine_config          quita CHECK(id='default')   + UNIQUE(user_id)
--   automation_settings    UNIQUE(user_id)
--   binance_credentials    UNIQUE(user_id)
--
-- Que NO hace (a proposito, va en Fase 3 junto con el codigo):
--   * NOT NULL en user_id: varios inserts del codigo aun no lo escriben.
--   * engine_sessions: su indice unico "una sesion viva" sigue global hasta que
--     engine-sessions.server.ts escriba user_id.
--   * No crea filas para otros usuarios (el codigo lee estas tablas con limit(1)).
--
-- Idempotente y atomica: si algo falla, no se aplica nada.

begin;

-- Guarda 1: aborta si alguna funcion SQL usa ON CONFLICT sobre una tabla cuyo
-- constraint se cambia aqui (se romperia en silencio en tiempo de ejecucion).
do $$
declare
  r record;
begin
  for r in
    select p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~* 'on\s+conflict'
      and p.prosrc ~* '(exchange_credentials|market_favorites|bot_performance_history|engine_config)'
  loop
    raise exception 'La funcion public.% usa ON CONFLICT sobre una tabla que esta migracion cambia. Revisala antes de continuar.', r.proname;
  end loop;
end
$$;

-- Guarda 2: market_favorites pasa a clave primaria con user_id; no puede haber nulos.
do $$
begin
  if exists (select 1 from public.market_favorites where user_id is null) then
    raise exception 'market_favorites tiene filas sin user_id; asignalas antes de continuar.';
  end if;
end
$$;

-- 1. exchange_credentials: una conexion por exchange y por usuario.
alter table public.exchange_credentials
  drop constraint if exists exchange_credentials_exchange_key;
create unique index if not exists exchange_credentials_user_exchange_uidx
  on public.exchange_credentials (user_id, exchange);
-- Filas heredadas sin dueno: conservan la unicidad por exchange de antes.
create unique index if not exists exchange_credentials_sin_dueno_uidx
  on public.exchange_credentials (exchange) where user_id is null;

-- 2. market_favorites: favoritos propios de cada usuario.
alter table public.market_favorites
  alter column user_id set not null;
alter table public.market_favorites
  drop constraint if exists market_favorites_pkey;
alter table public.market_favorites
  add constraint market_favorites_pkey primary key (user_id, exchange, symbol);

-- 3. bot_performance_history: un registro por bot y dia (no por nombre).
alter table public.bot_performance_history
  drop constraint if exists bot_performance_history_bot_name_recorded_on_key;
create unique index if not exists bot_performance_history_bot_day_uidx
  on public.bot_performance_history (bot_id, recorded_on) where bot_id is not null;
-- Filas heredadas sin bot_id: conservan la unicidad por nombre y dia de antes.
create unique index if not exists bot_performance_history_legacy_uidx
  on public.bot_performance_history (bot_name, recorded_on) where bot_id is null;

-- 4. engine_config: una fila por usuario (ya no solo id = 'default').
-- Las filas nuevas deben usar id = user_id::text.
alter table public.engine_config
  drop constraint if exists engine_config_id_check;
create unique index if not exists engine_config_user_id_uidx
  on public.engine_config (user_id);
drop index if exists public.engine_config_user_id_idx;

-- 5. automation_settings: una fila de limites por usuario.
create unique index if not exists automation_settings_user_id_uidx
  on public.automation_settings (user_id);
drop index if exists public.automation_settings_user_id_idx;

-- 6. binance_credentials: una fila por usuario.
create unique index if not exists binance_credentials_user_id_uidx
  on public.binance_credentials (user_id);
drop index if exists public.binance_credentials_user_id_idx;

commit;

-- Verificacion: debe listar los indices y claves nuevos (y ningun UNIQUE(exchange)
-- ni UNIQUE(bot_name, recorded_on) viejo).
select 'indice' as tipo, tablename as tabla, indexname as nombre, indexdef as definicion
from pg_indexes
where schemaname = 'public'
  and tablename in ('exchange_credentials','market_favorites','bot_performance_history',
                    'engine_config','automation_settings','binance_credentials')
  and indexname ~ '(uidx|pkey)$'
order by 2, 3;
