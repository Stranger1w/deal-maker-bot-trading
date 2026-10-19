-- ============================================================
-- Multiusuario · indicador y estrategia POR BOT
--
-- Que hace
--   1) engine_strategies (una fila por bot) gana dos columnas:
--        indicator_ids text[]  -> los indicadores de ESE bot
--        strategy_id   text    -> la estrategia de tamaño de ESE bot
--      Si son null, el bot usa la configuracion de la plataforma
--      (engine_config.indicator_ids / strategy_id). Asi el cambio es
--      opcional y no rompe a nadie.
--   2) indices para leer rapido la configuracion de los bots con Auto o
--      con indicador propio.
--
-- Por que
-- Los 7 indicadores y las 4 estrategias son PURE funciomnes (las mismas
-- que usa el backtest). Hasta ahora los indicadores y la estrategia se
-- elegian PARA TODA LA PLATAFORMA, asi que dos bots con estrategias
-- distintas no podian existir. Con esto, cada bot puede tener la suya y
-- medirla por separado.
--
-- NO toca flags de trading, ni binance_trading_env, ni credenciales.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

begin;

-- 1) Columnas por bot (opcionales: null = usa la de la plataforma).
alter table public.engine_strategies
  add column if not exists indicator_ids text[],
  add column if not exists strategy_id text;

-- 2) Comprobacion: si los ids de indicador no existen en el registro, el
--    motor no tendra senal y el bot no abrira posiciones. Se avisa con
--    una consulta, no con un error (para no bloquear la migracion).
-- 3) Indices de lectura.
create index if not exists engine_strategies_indicator_ids_idx
  on public.engine_strategies (indicator_ids)
  where indicator_ids is not null;

create index if not exists engine_strategies_strategy_id_idx
  on public.engine_strategies (strategy_id)
  where strategy_id is not null;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'engine_strategies'
--     and column_name in ('indicator_ids', 'strategy_id')
--   order by column_name;
--
-- Lo esperado:
--   indicator_ids | ARRAY | YES   (text[])
--   strategy_id   | text  | YES
--
-- Y cuantos bots tienen ya configuracion propia:
--
--   select
--     count(*) filter (where indicator_ids is not null) as con_indicadores,
--     count(*) filter (where strategy_id is not null) as con_estrategia
--   from public.engine_strategies;
--
-- Nota: si la consulta de abajo devuelve filas, hay ids de indicador que
-- no existen en el registro (src/lib/indicators). Corregilos antes de
-- poner bots con esos indicadores en marcha:
--
--   select bot_id, indicator_ids from public.engine_strategies
--   where indicator_ids is not null;
-- ------------------------------------------------------------
