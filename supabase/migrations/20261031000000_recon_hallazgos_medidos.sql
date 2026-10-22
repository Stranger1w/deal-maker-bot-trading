-- ============================================================================
--  MIGRACION 12 · EL ESCUADRON DE RECONOCIMIENTO MIDE SU ACIERTO
-- ============================================================================
--  QUE HACE
--  Hasta ahora un "hallazgo" era solo un texto: "pico de volumen en BTCUSDT".
--  No se sabia si habia servido de algo. Con esta migracion cada hallazgo
--  guarda:
--    - el precio de referencia (el del cierre al detectarlo),
--    - la direccion esperada (alcista/bajista),
--    - cuantas velas despues se evalua (el horizonte),
--    - y, cuando ya se puede comprobar, el resultado: subio/bajo/plano, el
--      porcentaje y si acerto (hit).
--
--  Con eso la pagina "Oportunidades" puede decir la verdad: "este detector
--  acierta el 62% de las veces, y el mercado subia el 51%: gana al azar".
--
--  ES SOLO AGREGAR COLUMNAS: no borra ni cambia datos.
-- ============================================================================

alter table public.recon_findings
  add column if not exists reference_price numeric,
  add column if not exists direction text,
  add column if not exists horizon_candles integer not null default 6,
  add column if not exists evaluated_at timestamptz,
  add column if not exists outcome text,
  add column if not exists outcome_pct numeric,
  add column if not exists hit boolean;

-- Indices para las consultas de la pagina: por detector y por pendientes.
create index if not exists recon_findings_kind_created_idx
  on public.recon_findings (kind, created_at desc);

create index if not exists recon_findings_pendientes_idx
  on public.recon_findings (created_at desc)
  where outcome is null;

-- El bot de reconocimiento guarda como mira y a cuanto se evalua.
alter table public.recon_bots
  add column if not exists lookback_candles integer not null default 24,
  add column if not exists horizon_candles integer not null default 6,
  add column if not exists intervalo text not null default '15m',
  add column if not exists base_rate_pct numeric;

-- La columna "interval_seconds" que ya existia no lo hacia nadie: nadie
-- programaba los escaneos. Se deja (no se borra) por si acaso.
comment on column public.recon_bots.intervalo is
  'Intervalo de las velas que usa el escuadron para detectar (5m, 15m, 1h, 4h...).';
