-- ============================================================
-- EL BOT DE COBERTURA (carry) (21-oct)
--
-- Que hace:
--   - bots.modo_operacion: 'direccional' (el de siempre, compra y vende
--     siguiendo la senal) o 'cobertura' (compra el spot y vende el
--     perpetuo para cobrar la financiacion: NO depende de la direccion del
--     precio, que es lo unico que ha dado positivo todos los anos).
--   - bot_executions.market: que pata es cada ejecucion ('spot' o 'perp').
--     Sin esto no se puede saber cual es cual: las dos patas usan el mismo
--     par.
--
-- Que NO hace (a proposito):
--   - No toca flags de trading ni credenciales.
--   - No abre nada: solo anade columnas.
--
-- Es idempotente: si la repites, no se rompe nada.
-- ============================================================

begin;

alter table public.bots
  add column if not exists modo_operacion text not null default 'direccional';

alter table public.bot_executions
  add column if not exists market text not null default 'spot';

create index if not exists bots_modo_operacion_idx
  on public.bots (modo_operacion);

commit;

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select table_name, column_name, data_type, column_default
  from information_schema.columns
  where (table_name = 'bots' and column_name = 'modo_operacion')
     or (table_name = 'bot_executions' and column_name = 'market');
-- deben salir 2 filas:
--   bots            | modo_operacion | text | direccional
--   bot_executions  | market         | text | spot
