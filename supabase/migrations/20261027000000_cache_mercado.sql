-- ============================================================
-- CACHE DE DATOS DE MERCADO (20-oct)
--
-- Que hace:
--   - market_candles: las velas OHLCV que usa el sandbox y el backtest, con
--     la plataforma de donde salió cada vela. Asi NO hay que volver a
--     descargarlo todo cada vez que se mide.
--   - trader_metrics: el posicionamiento de los traders grandes y el flujo
--     de ordenes, guardado igual (con su plataforma y periodo).
--
-- Que NO hace:
--   - No inventa datos: solo se guarda lo que ha bajado de una plataforma
--     real, con su fuente escrita en la fila.
--   - No toca flags de trading ni credenciales.
--
-- Es idempotente: si la repites, no se rompe nada.
--
-- NOTA: la app funciona SIN esta migracion (simplemente vuelve a descargar
-- de las plataformas cada vez). Con ella, el sandbox lee de la cache.
-- ============================================================

begin;

-- 1) Velas cacheadas.
create table if not exists public.market_candles (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  interval text not null,
  -- Momento de apertura de la vela, en milisegundos epoch.
  time bigint not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null default 0,
  -- De que plataforma salio (Binance, Bybit, OKX, Kraken, Coinbase...).
  source text not null,
  -- Market (spot o futuros).
  market text not null default 'futuros',
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists market_candles_symbol_interval_time_uidx
  on public.market_candles (symbol, interval, time);

create index if not exists market_candles_symbol_interval_idx
  on public.market_candles (symbol, interval, time desc);

alter table public.market_candles enable row level security;

-- 2) Datos de traders cacheados (posicionamiento y flujo).
create table if not exists public.trader_metrics (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  -- 'top_long_short' | 'taker_buy_sell' | 'global_long_short'
  metric text not null,
  -- Periodo de la lectura ('5m', '1h'...).
  period text not null,
  time bigint not null,
  value double precision not null,
  source text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists trader_metrics_symbol_metric_period_time_uidx
  on public.trader_metrics (symbol, metric, period, time);

alter table public.trader_metrics enable row level security;

commit;

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select table_name
  from information_schema.tables
 where table_name in ('market_candles', 'trader_metrics');
-- deben salir 2 filas

select count(*) as velas_cacheadas from public.market_candles;
select count(*) as traders_cacheados from public.trader_metrics;
