-- ============================================================
-- Realismo de ejecucion: riesgo por operacion, regimen, par y enfriamiento
--
-- Que anade a automation_settings (la configuracion de la plataforma):
--   riesgo_por_operacion      numeric  % del capital que se arriesga por
--                                     operacion (0,01 = 1 %). El tamano de
--                                     la posicion sale de aqui y de la
--                                     distancia del stop, no de un 2 % fijo.
--   stop_por_atr             numeric  Multiplicador del ATR para la
--                                     distancia del stop (1,5 = el stop
--                                     es 1,5 veces el ATR). NULL = se
--                                     usa el stop configurado del bot.
--   filtro_regimen           boolean  Bloquear entradas cuando el mercado
--                                     esta en tendencia fuerte (para
--                                     estrategias de reversion) o con
--                                     volatilidad extrema.
--   max_trades_per_pair      integer  Maximo de operaciones por PAR y dia
--                                     (0 = sin limite).
--   cooldown_minutes_after_losses integer  Minutos de espera tras una racha
--                                     de perdidas (0 = sin enfriamiento).
--   cooldown_losses           integer  Cuantas perdidas seguidas activan el
--                                     enfriamiento.
--
-- Todas con valor por defecto sensato: si el dueno no las toca, el
-- motor se comporta como hasta ahora (2 % fijo, sin filtro de regimen,
-- sin limites por par, sin enfriamiento) MENOS el tamano por riesgo, que
-- solo se aplica si riesgo_por_operacion > 0.
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

begin;

alter table public.automation_settings
  add column if not exists riesgo_por_operacion numeric not null default 0.01,
  add column if not exists stop_por_atr numeric,
  add column if not exists filtro_regimen boolean not null default false,
  add column if not exists max_trades_per_pair integer not null default 0,
  add column if not exists cooldown_minutes_after_losses integer not null default 0,
  add column if not exists cooldown_losses integer not null default 0;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'automation_settings'
--     and column_name in ('riesgo_por_operacion','stop_por_atr','filtro_regimen',
--                         'max_trades_per_pair','cooldown_minutes_after_losses','cooldown_losses')
--   order by column_name;
--
-- Lo esperado: las 6 columnas con sus valores por defecto.
--
-- Para ACTIVAR el filtro de regimen (recomendado solo con datos):
--   update public.automation_settings
--      set filtro_regimen = true, riesgo_por_operacion = 0.01
--    where id = (select id from public.app_settings limit 1);
--
-- Ojo: riesgo_por_operacion = 0.01 con un stop del 2 % implica posiciones
-- del 50 % del capital. Si prefieres Conservadora, bajalo a 0.005 (5 % del
-- capital por operacion como maximo, con el tope de la estrategia).
-- ------------------------------------------------------------
