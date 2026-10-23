# Deal Maker - Configuración propia (5 minutos)

Esta guía es para que **tú tengas tu propia instancia** de Deal Maker con tus propias claves, tus propios datos y tus propias ganancias. Nada se comparte con nadie.

## Paso 1: Crear tu proyecto en Supabase (gratis)

1. Entra a [supabase.com](https://supabase.com)
2. Regístrate con tu correo
3. Haz clic en **"New Project"**
4. Ponle un nombre (ej: `deal-maker-tunombre`), elige una contraseña y la región más cercana a ti
5. Espera a que se cree el proyecto (unos 30 segundos)

## Paso 2: Copiar tus claves

Dentro de tu proyecto de Supabase, ve a **Settings → API** (Configuración → API)

Copia estos dos valores (los necesitarás después):

| Valor | Qué es | Dónde está |
|-------|--------|------------|
| **Project URL** | La dirección de tu base de datos | Settings → API → Project URL |
| **anon public key** | Tu clave pública de acceso | Settings → API → Project API key → `anon public` |

> 🔒 Estas claves son tuyas. No se las des a nadie.

## Paso 3: Aplicar las migraciones SQL

Dentro de tu proyecto de Supabase, ve a **SQL Editor → New query**.

Copia todo el bloque de abajo y dale a **Run**. Esto creará todas las tablas que necesita la app.

```sql
-- ============================================================================
--  DEAL MAKER - Migraciones iniciales (copiar todo y dar a Run)
-- ============================================================================

-- 1) Configuración de la plataforma
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- 2) Credenciales de Binance (cifradas en reposo)
create table if not exists public.binance_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  api_key_last4 text,
  api_secret_last4 text,
  api_key_cipher text,
  api_secret_cipher text,
  market_mode text default 'spot',
  connection_status text,
  geo_restricted boolean default false,
  last_error_code text,
  last_error_message text,
  last_tested_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3) Cuentas de fondos (saldo interno)
create table if not exists public.fund_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label text default 'Principal',
  currency text default 'USDT',
  available_balance numeric default 0,
  in_use_balance numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4) Bots de trading
create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  strategy text,
  pair text,
  capital numeric,
  mode text default 'demo',
  status text default 'paused',
  automation_enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5) Sesiones del motor (una sesión viva por usuario)
create table if not exists public.engine_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text default 'active',
  session_started_at timestamptz default now(),
  session_stopped_at timestamptz,
  close_reason text
);

-- 6) Alertas del motor y cuenta
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  category text,
  severity text,
  title text,
  message text,
  entity text,
  entity_id text,
  acknowledged boolean default false,
  is_demo boolean default true,
  delivery_status text default 'in_app_only',
  created_at timestamptz default now()
);

-- 7) Escuadrón de reconocimiento (vigilancia de mercado)
create table if not exists public.recon_bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  status text default 'active',
  sources text[] default '{}',
  symbols text[] default '{}',
  focus text default 'price',
  interval_seconds integer default 300,
  last_run_at timestamptz,
  observations_count integer default 0,
  findings_count integer default 0,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.recon_findings (
  id uuid primary key default gen_random_uuid(),
  recon_bot_id uuid references public.recon_bots(id) on delete cascade,
  bot_name text default '',
  symbol text not null,
  kind text not null,
  severity text default 'info',
  headline text not null,
  detail text default '',
  confidence numeric default 0,
  sources text[] default '{}',
  is_demo boolean default true,
  created_at timestamptz default now()
);

-- 8) Minería (equipos y pagos)
create table if not exists public.mining_workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  coin text,
  pool text,
  rig_id text,
  status text default 'idle',
  hash_rate numeric default 0,
  hash_unit text default 'KH/s',
  uptime_seconds integer default 0,
  estimated_daily_earnings numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 9) Ajustes de automatización del motor (entorno, riesgo, etc.)
create table if not exists public.automation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  binance_trading_env text default 'testnet',
  allow_real_trading boolean default false,
  allow_live_orders boolean default false,
  stop_por_atr numeric,
  riesgo_por_operacion numeric default 0,
  filtro_regimen boolean default false,
  cooldown_minutes_after_losses integer default 0,
  cooldown_losses integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 10) Administradores de tu instancia (tú eres el admin de tu propia app)
create table if not exists public.app_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  created_at timestamptz default now()
);

-- ============================================================================
--  Listo. Ahora pasa al Paso 4.
-- ============================================================================
```

## Paso 4: Descargar y compilar tu .exe

1. Descarga el código del repositorio de Deal Maker a tu PC
2. Abre una terminal (PowerShell o CMD) dentro de la carpeta del proyecto
3. Instala las dependencias (solo la primera vez):
   ```
   bun install
   ```
4. Crea un archivo `.env` en la raíz del proyecto con este contenido:

```
SUPABASE_URL=https://TU_PROJECT_URL.supabase.co
SUPABASE_PUBLISHABLE_KEY=TU_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY_OPCIONAL
CREDENTIALS_ENCRYPTION_KEY=CualquierClaveLargaYSecreta123!
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxx  (opcional, solo para correos)
LOVABLE_CRON_SECRET=CualquierClaveSecreta456!
PORT=3127
HOST=127.0.0.1
DESKTOP=1
```

Reemplaza `TU_PROJECT_URL` y `TU_ANON_KEY` con los valores que copiaste en el Paso 2.

5. Compila el instalador de Windows:
   ```
   bun run dist:win
   ```

6. Instala el `.exe` que se generó en la carpeta `dist/`

## Paso 5: Usar la app

1. Ejecuta el instalador y abre Deal Maker
2. Regístrate con tu correo y configura tu segundo factor (2FA)
3. Ve a **Cuentas de trading** y pega tu API key de Binance (puede ser testnet para probar)
4. Ve a **Motor** e inicia una sesión
5. Ve a **Oportunidades / Escuadrón de Reconocimiento** y activa tus bots

---

## ¿Por qué cada uno necesita su propia instancia?

Cada `.exe` lleva embebidas las claves de Supabase. Si compartes tu `.exe`, otra persona vería **tus datos, tus bots y tus fondos**. Con esta guía, cada persona tiene su propia base de datos, sus propias ganancias y sus propios datos aislados.

---

## ¿Necesitas ayuda?

Si te trabas en algún paso, el único requisito es que tengas acceso a un proyecto de Supabase (gratis) y sepas copiar y pegar. Todo lo demás lo hace la app sola.
