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

-- 1b) Mas precision en las cifras de dinero.
-- Con numeric(12,2) la ganancia real de un PC de casa (0,0000000066 USD al
-- dia) se guardaba como 0,00 y no se podia ni leer ni comparar. Con 10
-- decimales cabe cualquier cifra de minado sin perder nada.
alter table public.mining_workers
  alter column estimated_daily_earnings type numeric(24,10);
alter table public.mining_payouts
  alter column usd_value type numeric(24,10);
alter table public.mining_payouts
  alter column amount type numeric(24,10);

-- 1c) Campo de ENTRENAMIENTO de los mineros:
--   - 'hilos': cuantos nucleos usa cada equipo.
--   - 'hash_rate_max': lo que rinde de verdad la maquina con esos hilos.
--   - mining_entrenamientos: la curva medida (1, 2, 3, 4 hilos) de cada
--     equipo, con la medicion real (SHA-256 de verdad, con workers reales).
create table if not exists public.mining_entrenamientos (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.mining_workers (id) on delete cascade,
  user_id uuid not null,
  hilos integer not null default 1,
  hash_rate numeric not null default 0,
  hash_unit text not null default 'MH/s',
  duracion_ms integer not null default 0,
  hashes bigint not null default 0,
  curva jsonb,
  nota text,
  created_at timestamptz not null default now()
);

alter table public.mining_workers
  add column if not exists hilos integer not null default 1,
  add column if not exists hash_rate_max numeric;

create index if not exists mining_entrenamientos_worker_fecha_idx
  on public.mining_entrenamientos (worker_id, created_at desc);

-- 2) El precio del kWh (por dueno, como el resto de automation_settings).
alter table public.automation_settings
  add column if not exists mineria_kwh_usd numeric not null default 0.15;

-- 3) El pago, con su equipo: para no pagar dos veces el mismo dia.
alter table public.mining_payouts
  add column if not exists worker_id uuid references public.mining_workers (id) on delete set null;

-- 3) Indice para el historico por worker (la grafica lo lee por fecha).
create index if not exists mining_hashrate_history_worker_fecha_idx
  on public.mining_hashrate_history (worker_id, recorded_on desc);

-- 4) Indice para no pagar dos veces el mismo dia.
create index if not exists mining_payouts_worker_fecha_idx
  on public.mining_payouts (worker_id, paid_at desc);

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

select column_name, data_type, numeric_precision, numeric_scale
  from information_schema.columns
 where table_name = 'mining_workers' and column_name = 'estimated_daily_earnings';
-- debe salir: numeric, 24, 10 (antes 12, 2 y las ganancias reales se perdian)

select column_name, data_type
  from information_schema.columns
 where table_name = 'mining_payouts' and column_name = 'worker_id';
-- debe salir: worker_id, uuid
