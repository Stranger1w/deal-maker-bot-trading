-- ============================================================
-- MOTOR DE MINERIA REAL (20-oct)
--
-- Que hace:
--   - mining_workers: guarda los datos REALES del equipo (hash rate medido,
--     potencia, ganancia bruta y neta, ultimo contacto, config manual de la
--     red y ultimo pago).
--   - automation_settings: el precio del kWh de cada dueno (lo que decide
--     si minar en casa sale a cuenta o no).
--
-- Que NO hace (a proposito):
--   - No toca ninguna fila: solo anade columnas. Los workers que ya tienes
--     se quedan con sus valores (0 de hash rate) hasta que el motor los
--     mida de verdad.
--   - No toca flags de trading ni credenciales.
--
-- Es idempotente: si la repites, no se rompe nada.
--
-- NOTA: la app funciona SIN esta migracion (el motor de mineria avisa y se
-- queda con 0), pero sin ella no se guardan el hash rate real, el neto ni
-- el precio de la luz.
-- ============================================================

begin;

-- 1) Columnas del worker.
alter table public.mining_workers
  add column if not exists last_seen_at timestamptz,
  add column if not exists power_watts numeric,
  add column if not exists gross_daily_usd numeric,
  add column if not exists net_daily_usd numeric,
  add column if not exists last_payout_at timestamptz,
  add column if not exists network_config jsonb;

-- 2) El precio del kWh (por dueno, como el resto de automation_settings).
alter table public.automation_settings
  add column if not exists mineria_kwh_usd numeric not null default 0.15;

-- 3) Indice para el historico por worker (la grafica lo lee por fecha).
create index if not exists mining_hashrate_history_worker_fecha_idx
  on public.mining_hashrate_history (worker_id, recorded_on desc);

commit;

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select column_name, data_type
  from information_schema.columns
 where table_name = 'mining_workers'
   and column_name in ('last_seen_at','power_watts','gross_daily_usd','net_daily_usd','last_payout_at','network_config');
-- deben salir 6 filas

select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'automation_settings' and column_name = 'mineria_kwh_usd';
-- debe salir: numeric, 0.15
