import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Globe2, Lock, PlugZap, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { saveBinanceCredentials, saveExchangeCredentials, testBinanceConnection, testExchangeConnection } from "@/lib/dealmaker.functions";
import { resolveTradingEnv, setAccountMode } from "@/lib/dealmaker.functions";
import { checkBackendRegion } from "@/lib/region.functions";
import { GEO_RESTRICTED_HINTS, GEO_RESTRICTED_MESSAGE } from "@/lib/binance-region";
import { EXCHANGES, type ExchangeId, type ExchangeMeta } from "@/lib/exchanges";
import { dateTime } from "@/lib/format";
import { binanceQuery, exchangesQuery, regionProbeQuery, type ExchangeCredential } from "@/lib/queries";

export const Route = createFileRoute("/binance")({
  head: () => ({
    meta: [
      { title: "Cuentas conectadas — Deal Maker" },
      {
        name: "description",
        content:
          "Conecta tus cuentas de Binance, Coinbase, Kraken, Bybit, OKX, KuCoin y eToro. Las claves se prueban en solo lectura y se guardan cifradas.",
      },
      { property: "og:title", content: "Cuentas conectadas — Deal Maker" },
      {
        property: "og:description",
        content: "Credenciales cifradas en el backend; el frontend solo ve los últimos 4 caracteres.",
      },
    ],
  }),
  component: BinancePage,
});

type Market = "spot" | "futures" | "both";

type TradingEnv = "testnet" | "production";

/**
 * Interruptor Real/Demo del entorno de trading, visible en todo momento.
 * Pasar a Real exige confirmación explícita en un diálogo (nunca se activa de un clic).
 */
function TradingModeSwitch({
  onToggle,
  busy,
}: {
  onToggle: (next: TradingEnv, confirmed: boolean) => void;
  busy: boolean;
}) {
  const envQuery = useQuery({
    queryKey: ["trading_env"],
    queryFn: () => resolveTradingEnv(),
    staleTime: 15000,
  });
  const mode: TradingEnv = envQuery.data === "production" ? "production" : "testnet";
  const isReal = mode === "production";
  const [open, setOpen] = useState(false);

  return (
    <Card className={isReal ? "border-destructive/50 bg-destructive/5" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Modo de operación
          <StatusPill tone={isReal ? "danger" : "success"}>
            {envQuery.isLoading ? "Leyendo…" : isReal ? "Real · producción" : "Demo · testnet"}
          </StatusPill>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {isReal
            ? "El motor envía órdenes con dinero real a Binance. Los límites de riesgo y la parada de emergencia siguen activos."
            : "El motor opera con dinero de prueba (testnet de Binance). Ninguna orden toca tus fondos reales."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-muted-foreground">Real</Label>
          {isReal ? (
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Switch checked disabled={busy} aria-label="Cambiar a modo Demo" />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Volver a modo Demo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    El motor dejará de enviar órdenes a producción y volverá al testnet de Binance.
                    Las posiciones que ya estén abiertas en producción no se cierran solas.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onToggle("testnet", true)}>
                    Sí, volver a Demo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Switch checked={false} disabled={busy} aria-label="Cambiar a modo Real" />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Activar el modo Real?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Desde este momento el motor puede enviar órdenes reales a Binance con tu
                    capital. Requisitos: credenciales verificadas (estado «ok»), permisos de
                    trading activos y sin permiso de retiro. Puedes volver a Demo cuando quieras.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onToggle("production", true)}
                  >
                    Entiendo, activar Real
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <span className="text-muted-foreground">Demo</span>
          {busy && <span className="text-xs text-muted-foreground">Aplicando cambio…</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function BinancePage() {
  const qc = useQueryClient();
  const settings = useQuery(binanceQuery);
  const test = useServerFn(testBinanceConnection);
  const save = useServerFn(saveBinanceCredentials);
  const switchMode = useServerFn(setAccountMode);
  const [modeBusy, setModeBusy] = useState(false);

  const toggleTradingMode = async (next: TradingEnv, confirmed: boolean) => {
    setModeBusy(true);
    try {
      const result = await switchMode({
        data: { mode: next, ...(confirmed ? { confirmed: "confirmed" as const } : {}) },
      });
      toast.success(
        result.mode === "production" ? "Modo Real activado" : "Modo Demo activado (testnet)",
      );
      void qc.invalidateQueries({ queryKey: ["trading_env"] });
      void qc.invalidateQueries({ queryKey: ["audit_events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el modo");
    } finally {
      setModeBusy(false);
    }
  };

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [market, setMarket] = useState<Market>("spot");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<null | { ok: boolean; message: string; restricted?: boolean }>(
    null,
  );

  const runTest = async () => {
    if (apiKey.length < 8 || apiSecret.length < 8)
      {
      toast.error("Introduce una API Key y un API Secret válidos");
      return;
    }
    setBusy(true);
    try {
      const result = await test({ data: { apiKey, apiSecret } });
      setTested(result);
      result.ok ? toast.success(result.message) : toast.error(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error probando la conexión");
    } finally {
      setBusy(false);
    }
  };

  const runSave = async () => {
    if (apiKey.length < 8 || apiSecret.length < 8)
      {
      toast.error("Introduce una API Key y un API Secret válidos");
      return;
    }
    setBusy(true);
    try {
      const result = await save({ data: { apiKey, apiSecret, marketMode: market } });
      setApiKey("");
      setApiSecret("");
      setTested(result.connection);
      toast.success("Credenciales cifradas y guardadas");
      void qc.invalidateQueries({ queryKey: ["binance_settings"] });
      void qc.invalidateQueries({ queryKey: ["audit_events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron guardar las credenciales");
    } finally {
      setBusy(false);
    }
  };

  const saved = settings.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cuentas conectadas"
        subtitle="Conecta tus cuentas de Binance, Coinbase, Kraken, Bybit, OKX, KuCoin y eToro. Todo se prueba en solo lectura y se guarda cifrado; el navegador solo ve los últimos 4 caracteres."
      />

      <TradingModeSwitch onToggle={toggleTradingMode} busy={modeBusy} />

      <Card className="border-warning/40 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Checklist obligatorio antes de guardar o probar</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Activa solo lectura y trading. Nunca habilites el permiso de retiro.</li>
            <li>
              Restringe la clave por <strong>whitelist de IP</strong> a las direcciones de salida de
              tu despliegue en la nube.
            </li>
            <li>Usa una subcuenta o capital limitado mientras validas el motor.</li>
            <li>Guarda solo configuración no sensible aquí: el secreto se cifra en reposo.</li>
          </ul>
        </CardContent>
      </Card>

      <RegionCard restricted={saved?.geo_restricted === true || tested?.restricted === true} />

      <ExchangesGrid />





      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                {/* Credenciales: cuando está conectado, oculto el formulario y muestro el badge. */}
        {saved?.connection_status === "ok" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Lock className="size-4 text-primary" /> Credenciales
                </span>
                <StatusPill tone={"success"}>Conectada</StatusPill>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="API Key" value={`•••• ${saved.api_key_last4}`} />
              <Row label="API Secret" value={`•••• ${saved.api_secret_last4}`} />
              <Row label="Mercados" value={saved.market_mode.toUpperCase()} />
              <Row
                label="Última conexión"
                value={saved.last_tested_at ? dateTime(saved.last_tested_at) : "—"}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setApiKey("");
                  setApiSecret("");
                  setTested(null);
                  void qc.invalidateQueries({ queryKey: ["binance_settings"] });
                }}
              >
                Reconectar con otras credenciales
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4 text-primary" /> Credenciales
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  value={apiKey}
                  autoComplete="off"
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Pega tu API Key de Binance"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-secret">API Secret</Label>
                <Input
                  id="api-secret"
                  type="password"
                  autoComplete="new-password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label>Mercados habilitados</Label>
                <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spot">Spot</SelectItem>
                    <SelectItem value="futures">Futures</SelectItem>
                    <SelectItem value="both">Spot + Futures</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={runTest} disabled={busy}>
                  <PlugZap className="size-4" /> Probar permisos (lectura + trading)
                </Button>
                <Button onClick={runSave} disabled={busy}>
                  Guardar cifrado
                </Button>
              </div>
              <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                La prueba lee <b>canTrade / canWithdraw</b> de tu key: necesitas <b>Spot Trade ON</b> y{" "}
                <b>Withdraw OFF</b>. Sin trading, los bots reales quedan bloqueados.
              </p>
              {tested && !tested.restricted && (
                <p className={tested.ok ? "text-sm text-success" : "text-sm text-destructive"}>
                  {tested.message}
                </p>
              )}
              {tested?.restricted && <GeoRestrictedNotice />}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Estado guardado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {saved ? (
              <>
                <Row label="API Key" value={`•••• ${saved.api_key_last4}`} />
                <Row label="API Secret" value={`•••• ${saved.api_secret_last4}`} />
                <Row label="Mercados" value={saved.market_mode.toUpperCase()} />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Conexión</span>
                  <StatusPill tone={statusTone(saved.connection_status)}>
                    {saved.connection_status === "ok"
                      ? "Verificada"
                      : saved.connection_status === "geo_restricted"
                        ? "Bloqueada por región"
                        : saved.connection_status === "failed"
                          ? "Fallida"
                          : "Sin probar"}
                  </StatusPill>
                </div>
                {saved.geo_restricted && <GeoRestrictedNotice />}
                <Row
                  label="Última prueba"
                  value={saved.last_tested_at ? dateTime(saved.last_tested_at) : "—"}
                />
              </>
            ) : (
              <p className="text-muted-foreground">
                Todavía no hay credenciales guardadas. Los bots en modo Real permanecen bloqueados
                hasta verificar la conexión.
              </p>
            )}
            <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              El secreto se almacena cifrado con AES-GCM y una clave que vive solo en el servidor.
              El navegador nunca recibe el valor completo.
            </p>
                    </CardContent>
                </Card>
      </div>
    </div>
  );
}

function ExchangesGrid() {
  const qc = useQueryClient();
  const saved = useQuery(exchangesQuery);
  const byId = new Map((saved.data ?? []).map((r) => [r.exchange, r]));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Otras plataformas — conecta tu cuenta"
        subtitle="Pega tu API Key de cada plataforma (solo lectura + trading, nunca retiros). Se prueba sin mover fondos y se guarda cifrada."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {EXCHANGES.filter((e) => e.id !== "binance").map((meta) => (
          <ExchangeCard key={meta.id} meta={meta} saved={byId.get(meta.id)} onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["exchange_credentials"] });
          }} />
        ))}
      </div>
    </div>
  );
}

function ExchangeCard({
  meta,
  saved,
  onSaved,
}: {
  meta: ExchangeMeta;
  saved?: ExchangeCredential | undefined;
  onSaved: () => void;
}) {
  const test = useServerFn(testExchangeConnection);
  const save = useServerFn(saveExchangeCredentials);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const needPass = meta.needsPassphrase;
  const valid = apiKey.length >= 8 && (meta.id === "etoro" || apiSecret.length >= 8) && (!needPass || passphrase.length >= 1);
  const runTest = async () => {
    if (!valid) {
      toast.error("Completa API Key, Secret y passphrase si aplica");
      return;
    }
    setBusy(true);
    try {
      const r = await test({ data: { exchange: meta.id, apiKey, apiSecret, passphrase: needPass ? passphrase : undefined } });
      setResult(r);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error probando");
    } finally {
      setBusy(false);
    }
  };
  const runSave = async () => {
    if (!valid) {
      toast.error("Completa API Key, Secret y passphrase si aplica");
      return;
    }
    setBusy(true);
    try {
      const r = await save({ data: { exchange: meta.id, apiKey, apiSecret, passphrase: needPass ? passphrase : undefined } });
      setResult(r.connection);
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      toast.success(`${meta.label}: cuenta conectada y cifrada`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>{meta.label}</span>
          {saved && (
            <StatusPill tone={statusTone(saved.connection_status)}>
              {saved.connection_status === "ok" ? "Conectada" : saved.connection_status}
            </StatusPill>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {meta.markets} · <a className="underline" href={meta.apiDocs} target="_blank" rel="noreferrer">Docs API</a>
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">{meta.notes}</p>
        <div className="space-y-2">
          <Label>API Key{meta.id === "etoro" ? " (partner key)" : ""}</Label>
          <Input value={apiKey} autoComplete="off" onChange={(e) => setApiKey(e.target.value)} placeholder={`Pega tu key de ${meta.label}`} />
        </div>
        {meta.id !== "etoro" && (
          <div className="space-y-2">
            <Label>API Secret</Label>
            <Input type="password" autoComplete="new-password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="••••••••••••••••" />
          </div>
        )}
        {needPass && (
          <div className="space-y-2">
            <Label>Passphrase</Label>
            <Input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Frase de la key" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={runTest} disabled={busy || !valid}>Probar (solo lectura)</Button>
          <Button size="sm" onClick={runSave} disabled={busy || !valid}>Conectar cuenta</Button>
        </div>
        {result && <p className={result.ok ? "text-xs text-success" : "text-xs text-destructive"}>{result.message}</p>}
        {saved && (
          <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
            <Row label="Guardada" value={`•••• ${saved.api_key_last4}`} />
            <Row label="Probada" value={saved.last_tested_at ? dateTime(saved.last_tested_at) : "—"} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium text-foreground">{value}</span>
    </p>
  );
}

function GeoRestrictedNotice() {
  return (
    <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
      <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {GEO_RESTRICTED_MESSAGE}
      </p>
      <ul className="list-disc space-y-1 pl-8 text-xs text-muted-foreground">
        {GEO_RESTRICTED_HINTS.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </div>
  );
}

function RegionCard({ restricted }: { restricted: boolean }) {
  const { data: probe } = useQuery(regionProbeQuery);
  const runProbe = useServerFn(checkBackendRegion);
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const result = await runProbe({ data: undefined });
      await queryClient.invalidateQueries({ queryKey: regionProbeQuery.queryKey });
      toast[result.binanceRestricted ? "error" : "success"](
        result.binanceRestricted
          ? "Binance bloquea la ubicación del servidor"
          : "Binance responde correctamente desde el servidor",
      );
    } catch {
      toast.error("No se pudo comprobar la ubicación del servidor");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="size-4" aria-hidden />
          Ubicación del backend y disponibilidad de Binance
        </CardTitle>
        <Button variant="outline" size="sm" onClick={check} disabled={checking}>
          {checking ? "Comprobando…" : "Comprobar ahora"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {restricted && <GeoRestrictedNotice />}
        {probe ? (
          <div className="space-y-2">
            <Row label="Plataforma de ejecución" value={probe.platform} />
            <Row label="Centro de datos de salida" value={probe.colo ?? "No informado"} />
            <Row label="País de salida" value={probe.country ?? "No informado"} />
            <Row
              label="Respuesta pública de Binance"
              value={probe.binance_status ? String(probe.binance_status) : "Sin respuesta"}
            />
            <Row label="Detalle" value={probe.detail || "—"} />
            <Row label="Comprobado" value={dateTime(probe.created_at)} />
          </div>
        ) : (
          <p className="text-muted-foreground">
            Todavía no hay evidencia registrada. Pulsa «Comprobar ahora» para medir desde dónde sale
            realmente el backend.
          </p>
        )}
        <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          La región de despliegue la determina la plataforma de alojamiento: esta aplicación no
          expone un selector de región porque no existe una opción real por proyecto que se pueda
          aplicar desde aquí. Si necesitas otra ubicación, hay que alojar el backend que firma las
          peticiones en una región o plataforma admitida oficialmente por Binance. Cambiar de región
          no garantiza disponibilidad. No se contemplan VPN ni proxies para eludir restricciones.
        </p>
      </CardContent>
    </Card>
  );
}
