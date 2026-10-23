import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, Copy, Database, ExternalLink, Key, Play } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/primer-uso")({
  head: () => ({
    meta: [
      { title: "Configurar tu Deal Maker — Primer uso" },
      {
        name: "description",
        content:
          "Configura tu propia instancia de Deal Maker con tus claves de Supabase en 5 minutos.",
      },
    ],
  }),
  component: PrimerUsoPage,
});

export function PrimerUsoPage() {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [estado, setEstado] = useState<"inicial" | "verificando" | "ok" | "error">("inicial");
  const [mensaje, setMensaje] = useState("");

  // Verificar al cargar si ya hay una sesión válida (el usuario ya configuró antes)
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setEstado("ok");
          setMensaje("Ya tienes una sesión activa. Puedes cerrar esta pantalla.");
        }
      } catch {
        // No hay sesión, se muestra la pantalla de configuración normalmente
      }
    })();
  }, []);

  const copiar = (texto: string) => {
    navigator.clipboard.writeText(texto);
    toast.success("Copiado al portapapeles");
  };

  const verificarConexion = async () => {
    if (!url || !key) {
      setMensaje("Ingresa la URL y la clave pública de Supabase");
      setEstado("error");
      return;
    }

    setBusy(true);
    setEstado("verificando");
    setMensaje("Probando conexión con Supabase...");

    try {
      // Crear un cliente temporal con las credenciales del usuario para probar
      const { createClient } = await import("@supabase/supabase-js");
      const clientePrueba = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await clientePrueba.from("app_settings").select("key").limit(1);

      if (error) {
        if (error.code === "42P01" || error.message?.includes("relation")) {
          setMensaje("Conexión OK, pero faltan las tablas. Aplica las migraciones SQL del Paso 3.");
          setEstado("error");
        } else if (error.code === "42501" || error.message?.includes("permission")) {
          setMensaje("Conexión OK, pero no tienes permisos para leer las tablas.");
          setEstado("error");
        } else {
          setMensaje(`Error de Supabase: ${error.message}`);
          setEstado("error");
        }
        return;
      }

      setEstado("ok");
      setMensaje(
        "¡Conexión exitosa! Tu instancia de Deal Maker está lista. Guarda estas claves en tu .env y compila la app.",
      );
      toast.success("Conexión con Supabase verificada");
    } catch (e) {
      setMensaje(`No se pudo conectar: ${e instanceof Error ? e.message : String(e)}`);
      setEstado("error");
    } finally {
      setBusy(false);
    }
  };

  const sqlMigraciones = `-- Migraciones Deal Maker (copiar todo y dar a Run en SQL Editor)
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
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
create table if not exists public.engine_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text default 'active',
  session_started_at timestamptz default now(),
  session_stopped_at timestamptz,
  close_reason text
);
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
create table if not exists public.app_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  created_at timestamptz default now()
);`;

  const envEjemplo = `# Copia esto en un archivo .env en la raíz del proyecto
SUPABASE_URL=${url || "https://TU_PROYECTO.supabase.co"}
SUPABASE_PUBLISHABLE_KEY=${key || "TU_ANON_KEY"}
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY_OPCIONAL
CREDENTIALS_ENCRYPTION_KEY=CualquierClaveLargaYSecreta123!
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxx
LOVABLE_CRON_SECRET=CualquierClaveSecreta456!
PORT=3127
HOST=127.0.0.1
DESKTOP=1`;

  const estadoColor =
    estado === "ok"
      ? "text-success"
      : estado === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  const estadoIcono =
    estado === "ok" ? (
      <CheckCircle className="size-5" />
    ) : estado === "error" ? (
      <AlertTriangle className="size-5" />
    ) : (
      <Database className="size-5" />
    );

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        eyebrow="Primer uso"
        title="Configurar tu Deal Maker"
        subtitle="Configura tu propia instancia con tus claves de Supabase en 5 minutos. Tus datos y ganancias son solo tuyos."
      />

      <div className="space-y-8">
        {/* Paso 1: Crear proyecto */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Key className="size-4 text-primary" /> Paso 1: Crear proyecto en Supabase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
              <li>
                Entra a{" "}
                <a href="https://supabase.com" target="_blank" rel="noopener">
                  supabase.com
                </a>{" "}
                y regístrate.
              </li>
              <li>
                Haz clic en <strong>"New Project"</strong> y ponle un nombre (ej:{" "}
                <em>deal-maker-mitunombre</em>).
              </li>
              <li>Elige una contraseña y la región más cercana a ti.</li>
              <li>Espera a que se cree el proyecto (unos 30 segundos).</li>
            </ol>
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold mb-1">¿Qué necesitas copiar?</p>
              <p>
                Ve a <strong>Settings → API</strong> y copia estos dos valores:
              </p>
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copiar("https://supabase.com/dashboard/project/_/settings/api")}
                >
                  <ExternalLink className="size-3.5 mr-1" /> Abrir Settings → API
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Paso 2: Pegar claves y probar */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Key className="size-4 text-primary" /> Paso 2: Pegar tus claves y probar conexión
            </CardTitle>
            <span className={estadoColor}>
              {estadoIcono}{" "}
              {estado === "ok"
                ? "Conexión OK"
                : estado === "error"
                  ? "Error de conexión"
                  : "Listo para probar"}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supabase-url">Project URL de Supabase</Label>
              <Input
                id="supabase-url"
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supabase-key">anon public key</Label>
              <Input
                id="supabase-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => void verificarConexion()}
                disabled={busy || !url || !key}
                className="w-full"
              >
                {busy ? "Verificando…" : "Probar conexión con Supabase"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUrl("");
                  setKey("");
                  setEstado("inicial");
                  setMensaje("");
                }}
              >
                Limpiar
              </Button>
            </div>
            {mensaje && <p className={`text-sm ${estadoColor}`}>{mensaje}</p>}
          </CardContent>
        </Card>

        {/* Paso 3: Migraciones SQL */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-primary" /> Paso 3: Aplicar migraciones SQL
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => copiar(sqlMigraciones)}>
              <Copy className="size-3.5 mr-1" /> Copiar SQL al portapapeles
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              En tu proyecto de Supabase, ve a <strong>SQL Editor → New query</strong>, pega lo
              siguiente y dale a <strong>Run</strong>. Esto crea todas las tablas que necesita la
              app.
            </p>
            <Textarea value={sqlMigraciones} readOnly className="h-64 text-xs font-mono" />
            <p className="text-xs text-muted-foreground">
              Son solo <strong>CREATE TABLE</strong>: no borra ni cambia nada que ya tengas.
            </p>
          </CardContent>
        </Card>

        {/* Paso 4: Compilar */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4 text-primary" /> Paso 4: Compilar tu .exe
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              En tu PC, dentro de la carpeta del proyecto de Deal Maker, crea un archivo
              <code className="font-mono text-xs">.env</code> con estas claves:
            </p>
            <Textarea value={envEjemplo} readOnly className="h-48 text-xs font-mono" />
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => copiar(envEjemplo)}>
                <Copy className="size-3.5 mr-1" /> Copiar contenido del .env
              </Button>
            </div>
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold mb-1">
                Luego, en la terminal de la carpeta del proyecto:
              </p>
              <p className="font-mono text-xs">bun install</p>
              <p className="font-mono text-xs">bun run dist:win</p>
              <p className="mt-1">
                Tu instalador aparecerá en{" "}
                <code className="font-mono">dist/Deal Maker Setup 1.0.0.exe</code>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Paso 5: Usar */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4 text-primary" /> Paso 5: Instalar y usar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
              <li>
                Instala el <code className="font-mono text-xs">.exe</code> y abre Deal Maker.
              </li>
              <li>Regístrate con tu correo y configura tu segundo factor (2FA).</li>
              <li>
                Ve a <strong>Cuentas de trading</strong> y pega tu API key de Binance (puede ser
                testnet para probar).
              </li>
              <li>
                Ve a <strong>Motor</strong> e inicia una sesión.
              </li>
              <li>
                Ve a <strong>Oportunidades / Escuadrón de Reconocimiento</strong> y activa tus bots.
              </li>
            </ol>
            <div className="rounded-md border border-green/40 bg-green/5 p-3 text-xs text-green-foreground">
              <p className="font-semibold">✅ Listo</p>
              <p>
                Tu instancia es completamente independiente. Tus datos, bots y ganancias son solo
                tuyos.
              </p>
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            ¿Ya configuraste todo? Cierra esta pantalla y comienza a operar.
          </p>
        </div>
      </div>
    </div>
  );
}
