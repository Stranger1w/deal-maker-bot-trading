-- ============================================================
-- bot_executions · registro de la SEÑAL que produjo cada operacion
--
-- Que hace
--   Añade a bot_executions tres columnas para que se pueda saber, para
--   cada operacion, que indicadores la dispararon y por que:
--     signal_indicators text[]  -> los indicadores que coincidieron
--     signal_reason     text    -> 'compra' | 'venta' | 'stop_loss' |
--                                  'take_profit' | 'cierre_senal'
--     signal_at         timestamptz -> cuando se calculo la señal
--
-- Por que
-- Sin esto no se puede responder a la pregunta que de verdad importa:
--   ¿que indicador gana y cual pierde?
-- Con las ejecuciones grabadas y estos tres campos, el panel de métricas
-- puede comparar por indicador, por par, por hora del dia y por
-- estrategia, y avisar cuando un bot acumula muchas operaciones SIN
-- ventaja estadistica.
--
-- Antes, esto no se podia saber: la IA Indicator (src/lib/indicators/
-- ai-indicator.ts) ya calculaba estadisticas por indicador y por hora
-- leyendo las operaciones del bot, pero le faltan estos campos.
--
-- NULL en las filas viejas: esas operaciones no tienen señal registrada
-- (se hicieron antes de este cambio o en modo demo antiguo).
--
-- NO toca flags de trading, ni credenciales, ni el motor.
-- Idempotente: se puede volver a pegar sin efecto.
-- ============================================================

begin;

alter table public.bot_executions
  add column if not exists signal_indicators text[],
  add column if not exists signal_reason text,
  add column if not exists signal_at timestamptz;

-- Indice para el panel de métricas (agrupa por bot y por operación).
create index if not exists bot_executions_signal_idx
  on public.bot_executions (bot_id, created_at desc)
  where signal_indicators is not null;

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'bot_executions'
--     and column_name like 'signal%'
--   order by column_name;
--
-- Lo esperado:
--   signal_indicators | ARRAY  | YES
--   signal_reason     | text   | YES
--   signal_at         | timestamp with time zone | YES
--
-- Y cuantas operaciones tienen ya la señal registrada:
--
--   select count(*) as con_senal, count(*) filter (where signal_reason is not null) as con_motivo
--   from public.bot_executions;
-- ------------------------------------------------------------
