-- ============================================================
-- Selector automatico de par: filtro de SPREAD
--
-- Que anade
--   engine_config.auto_symbol_max_spread_pct numeric
--       Spread maximo admitido (en tanto por uno) para que un bot opere un
--       par. 0.005 = 0,5 %. NULL = sin limite.
--
-- Por que
-- El selector ya filtraba por volumen (para no operar en un par illiquido)
-- pero no por el SPREAD: en un par con un spread del 1 %, la ganancia de un
-- take-profit del 0,5 % se la come el spread antes de empezar. Un par
-- "malo" no es el que tiene poco volumen, sino el que te cobra mucho por
-- entrar y salir.
--
-- Si no se pudo leer el libro de ordenes (spread desconocido), el par NO se
-- descarta: no se bloquea el selector por falta de un dato.
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

begin;

alter table public.engine_config
  add column if not exists auto_symbol_max_spread_pct numeric;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'engine_config'
--     and column_name = 'auto_symbol_max_spread_pct';
--
-- Lo esperado: auto_symbol_max_spread_pct | numeric | YES
--
-- Poner un limite concreto (0,5 %):
--
--   update public.engine_config
--      set auto_symbol_max_spread_pct = 0.005, updated_at = now()
--    where user_id = (select user_id from public.app_admins order by created_at limit 1);
-- ------------------------------------------------------------
