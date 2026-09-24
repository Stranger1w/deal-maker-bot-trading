# Supabase — crear proyecto nuevo (5 min)

La app **no arranca sin Supabase**. Necesita URL + keys.

## 1. Crear proyecto

1. Entra a https://supabase.com/dashboard → New project.
2. Name: `deal-maker` · pon password fuerte · Region: la más cercana a ti
   (ej. `South America (São Paulo)` si estás en LATAM).
3. Espera ~2 min a que termine.

## 2. Copiar keys

Project Settings → API:

- `Project URL` → es `SUPABASE_URL` (ej. `https://xyzcompany.supabase.co`)
- `anon public` → es `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `service_role` → es `SUPABASE_SERVICE_ROLE_KEY` (**solo server, nunca al frontend**)

> Los nombres nuevos de Supabase usan `sb_publishable_...` y `sb_secret_...`.
> La app acepta ambos formatos.

## 3. Crear `.env` local

En `C:\Users\Usuario\Downloads\deal-maker-bot-trading-main\` copia `.env.example` a `.env`:

```powershell
Copy-Item .env.example .env
notepad .env
```

Rellena como mínimo:

```ini
VITE_SUPABASE_URL=https://xyzcompany.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_URL=https://xyzcompany.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_PROJECT_ID=xyzcompany
CREDENTIALS_ENCRYPTION_KEY=<32+ caracteres aleatorios>
```

Genera la clave de cifrado así:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Opcionales (cron nube + reportes):

```ini
LOVABLE_CRON_SECRET=<aleatorio largo>
LOVABLE_CRON_SECRET_PREVIOUS=
RESEND_API_KEY=
REPORTS_FROM_EMAIL=
```

## 4. Crear tablas (SQL)

1. Supabase Dashboard → SQL Editor → New query.
2. Primero, una sola vez:
```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```
3. Luego pega en orden `supabase/migrations/ALL_IN_ONE_PART1.sql` →
   `PART2` → `PART3` → `PART4` → `PART5` → `PART6` → `PART7`, con `Run` en cada uno.
   Debe decir `Success. No rows returned` en cada parte.
   - `PART6` = campo de entrenamiento de minería.
   - `PART7` = reparación del desfase nube ↔ código (columnas `risk_week`,
     `peak_pnl`, tablas `engine_runs`, `market_prices`, `mining_hashrate_history`,
     `bot_performance_history`, `recon_observations`). Si tu nube se creó solo
     con PART1-5, pegar PART7 es obligatorio: sin él fallan el motor, las
     gráficas y el reconocimiento.
4. Verifica en Table Editor (schema `public`) que existan: `bots`,
   `fund_accounts`, `binance_credentials`, `automation_settings`, `alerts`, etc.
   Si sale vacío, corre en SQL Editor:
```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
```
   Debe listar ~15 tablas. Si devuelve 0, el SQL no corrió en este proyecto.

## 5. Auth + 2FA

1. Authentication → Providers → Email: ON (Confirm email: OFF para pruebas).
2. La app usa TOTP (`supabase.auth.mfa.enroll`) — no requiere config extra.
3. Crea tu usuario en la app: abre `/acceso` → Crear cuenta → Iniciar sesión →
   Configurar 2FA → Verificar sesión (`aal2`).

Sin `aal2` los retiros y Demo→Real están bloqueados por diseño.

## 6. Probar

```powershell
npm i
npm run dev
```

Abre la URL que imprime Vite y entra a `/acceso`. Si ves
`Missing Supabase environment variable(s)` es que `.env` está mal.

## Troubleshooting

| Error | Causa |
|---|---|
| `Missing Supabase environment variable(s)` | Falta `.env` o variable vacía |
| Tablas vacías / 404 en queries | No corriste `ALL_IN_ONE.sql` |
| `CREDENTIALS_ENCRYPTION_KEY missing` | Falta la clave AES en `.env` (server) |
| Login OK pero retiros bloqueados | Falta verificar 2FA (`aal2`) |
| `Binance ... restricted location` | Restricción geográfica real, no es bug (ver página `/binance`) |
