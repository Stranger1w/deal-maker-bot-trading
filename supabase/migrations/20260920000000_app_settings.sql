-- Tabla de configuración global de la app (key-value)
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Trigger para mantener updated_at al día
create or replace function public.set_app_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row
  execute function public.set_app_settings_updated_at();

-- RLS: habilitada pero permisiva para el rol autenticado/servicio
alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select"
  on public.app_settings for select
  using (true);

drop policy if exists "app_settings_upsert" on public.app_settings;
create policy "app_settings_upsert"
  on public.app_settings for insert
  with check (true);

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update"
  on public.app_settings for update
  using (true)
  with check (true);

-- Valor inicial para el modo de trading de Binance (testnet por defecto)
insert into public.app_settings (key, value)
values ('binance_trading_env', 'testnet')
on conflict (key) do nothing;
