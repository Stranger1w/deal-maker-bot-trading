-- ============================================================
-- COMISION DEL POOL Y HASH RATE SOSTENIDO (21-oct)
--
-- Que hace:
--   - mining_workers.pool_fee_pct: lo que se lleva TU pool de tu parte
--     (0,5 % es lo normal). Es dinero que nunca llega a tu cartera, asi que
--     se resta de la ganancia y se informa en su propia columna.
--   - mining_workers.hash_rate_sostenido: el hash rate de verdad, medido
--     durante 10 segundos (minando horas, no en el pico de 1,5 s). El
--     numero que se usa para calcular la ganancia diaria.
--
-- Que NO hace (a proposito):
--   - No toca ninguna fila: solo anade columnas (con valor por defecto).
--   - No toca flags de trading ni credenciales.
--
-- Es idempotente: si la repites, no se rompe nada.
--
-- La app funciona SIN esta migracion: si las columnas no existen, el motor
-- usa 0 % de comision y el hash rate medido en el momento.
-- ============================================================

begin;

alter table public.mining_workers
  add column if not exists pool_fee_pct numeric not null default 0,
  add column if not exists hash_rate_sostenido numeric;

commit;

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select column_name, data_type, column_default
  from information_schema.columns
  where table_name = 'mining_workers'
    and column_name in ('pool_fee_pct','hash_rate_sostenido');
-- deben salir 2 filas:
--   pool_fee_pct          | numeric | 0
--   hash_rate_sostenido   | numeric | (null)
