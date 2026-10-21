import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Globe2, KeyRound, Lock, PlugZap, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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
  diagnosticarClaveBinance,
  leerCredencialesBinance,
  saveBinanceCredentials,
  testBinanceConnection,
} from "@/lib/dealmaker.functions";
import { checkBackendRegion } from "@/lib/region.functions";
import { comprobarPermisoFuturos } from "@/lib/futuros.functions";
import { cambiarEntornoTrading, leerEntornoTrading } from "@/lib/entorno-trading.functions";
import { GEO_RESTRICTED_HINTS, GEO_RESTRICTED_MESSAGE } from "@/lib/binance-region";
import { dateTime } from "@/lib/format";
import { regionProbeQuery } from "@/lib/queries";

export const Route = createFileRoute("/binance")({
  head: () => ({
    meta: [
      { title: "Cuentas de trading — Deal Maker" },
      {
        name: "description",
        content:
          "Tus claves de API de Binance, el entorno donde se opera (testnet o producción) y los permisos de la cuenta.",
      },
      {
        property: "og:title",
        content:
          "Tus claves de API de Binance, el entorno donde se opera (testnet o produccion) y los permisos de la cuenta.",
      },
      {
        property: "og:description",
        content:
          "Credenciales cifradas en el backend; el frontend solo ve los últimos 4 caracteres.",
      },
    ],
  }),
  component: BinancePage,
});

type Market = "spot" | "futures" | "both";

function BinancePage() {
  const qc = useQueryClient();
  // El estado de las credenciales lo lee el SERVIDOR: la tabla esta
  // bloqueada por RLS y desde el navegador salia un 403, asi que la app
  // decia "todavia no hay credenciales" aunque estuvieran guardadas.
  const leerCredenciales = useServerFn(leerCredencialesBinance);
  const settings = useQuery({
    queryKey: ["binance_settings"],
    queryFn: () => leerCredenciales({}),
  });
  const test = useServerFn(testBinanceConnection);
  const save = useServerFn(saveBinanceCredentials);
  const diagnosticoFn = useServerFn(diagnosticarClaveBinance);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [market, setMarket] = useState<Market>("spot");
  const [busy, setBusy] = useState(false);
  // El permiso de futuros (lo necesita el bot de cobertura).
  const comprobarPermisoFuturosFn = useServerFn(comprobarPermisoFuturos);
  const [permisoFuturos, setPermisoFuturos] = useState<{
    ok: boolean;
    motivo: string | null;
    notaDemo?: string | null;
    pasos: string[];
  } | null>(null);
  const [comprobandoFuturos, setComprobandoFuturos] = useState(false);
  // El entorno de trading: donde se mandan las ordenes (testnet o produccion).
  const entornoFn = useServerFn(leerEntornoTrading);
  const cambiarEntornoFn = useServerFn(cambiarEntornoTrading);
  const [confirmacionProduccion, setConfirmacionProduccion] = useState("");
  const [cambiandoEntorno, setCambiandoEntorno] = useState(false);
  const entorno = useQuery({
    queryKey: ["entorno_trading"],
    queryFn: () => entornoFn({}),
    staleTime: 15_000,
  });
  const [tested, setTested] = useState<null | {
    ok: boolean;
    message: string;
    restricted?: boolean;
  }>(null);
  // El diagnostico: donde vale de verdad la clave (testnet o produccion).
  const [diag, setDiag] = useState<null | {
    entorno: string;
    titulo: string;
    veredicto: string;
    spot_produccion: { ok: boolean; status: number; detalle: string };
    spot_testnet: { ok: boolean; status: number; detalle: string };
    futuros_produccion: { ok: boolean; status: number; detalle: string };
    futuros_testnet: { ok: boolean; status: number; detalle: string };
  }>(null);
  const [diagnosticando, setDiagnosticando] = useState(false);

  const runDiagnostico = async () => {
    if (apiKey.length < 8 || apiSecret.length < 8) {
      toast.error("Introduce una API Key y un API Secret válidos");
      return;
    }
    setDiagnosticando(true);
    try {
      const r = await diagnosticoFn({ data: { apiKey, apiSecret } });
      setDiag(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en el diagnóstico");
    } finally {
      setDiagnosticando(false);
    }
  };

  const runTest = async () => {
    if (apiKey.length < 8 || apiSecret.length < 8) {
      toast.error("Introduce una API Key y un API Secret válidos");
      return;
    }
    setBusy(true);
    try {
      const result = await test({ data: { apiKey, apiSecret } });
      setTested(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error probando la conexión");
    } finally {
      setBusy(false);
    }
  };

  const runSave = async () => {
    if (apiKey.length < 8 || apiSecret.length < 8) {
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
        eyebrow="Dinero"
        title="Cuentas de trading"
        subtitle="Todo el trading real se ejecuta vía Binance. El secreto se cifra en reposo, nunca se expone al navegador ni se escribe en logs; solo el backend lo descifra para firmar solicitudes."
      />

      <Card className="border-warning/40 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Checklist obligatorio antes de guardar o probar
          </CardTitle>
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

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
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
                <PlugZap className="size-4" /> Probar conexión (solo lectura)
              </Button>
              <Button variant="outline" onClick={runDiagnostico} disabled={busy || diagnosticando}>
                {diagnosticando ? "Comprobando…" : "Diagnóstico: ¿testnet o producción?"}
              </Button>
              <Button onClick={runSave} disabled={busy}>
                Guardar cifrado
              </Button>
            </div>
            {diag && (
              <div className="space-y-2 rounded-xl border border-border/70 bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {diag.titulo}
                  {diag.entorno === "production" ? " ✅" : ""}
                </p>
                <p className="text-muted-foreground">{diag.veredicto}</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {(
                    [
                      ["Spot producción", diag.spot_produccion],
                      ["Spot testnet", diag.spot_testnet],
                      ["Futuros producción", diag.futuros_produccion],
                      ["Futuros testnet", diag.futuros_testnet],
                    ] as const
                  ).map(([etiqueta, r]) => (
                    <li key={etiqueta} className="flex items-center gap-2">
                      <span className={r.ok ? "text-success" : "text-destructive"}>
                        {r.ok ? "OK" : "FALLA"}
                      </span>
                      <span className="min-w-40">{etiqueta}</span>
                      <span className="truncate">
                        {r.ok ? "" : r.detalle || `HTTP ${r.status}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tested && !tested.restricted && (
              <p className={tested.ok ? "text-sm text-success" : "text-sm text-destructive"}>
                {tested.message}
              </p>
            )}
            {tested?.restricted && <GeoRestrictedNotice />}
          </CardContent>
        </Card>

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
              <EmptyState
                icono={KeyRound}
                titulo="Todavía no hay credenciales guardadas"
                detalle="Pega una API key de Binance con permiso de operar (y SIN retiros: la app las rechaza si los tienen) y pulsa «Probar». Los bots en modo Real permanecen bloqueados hasta verificar la conexión."
              />
            )}
            <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              El secreto se almacena cifrado con AES-GCM y una clave que vive solo en el servidor.
              El navegador nunca recibe el valor completo.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Entorno de trading
              {entorno.data && (
                <StatusPill tone={entorno.data.env === "production" ? "danger" : "success"}>
                  {entorno.data.env === "production"
                    ? "PRODUCCIÓN (dinero real)"
                    : "Testnet (dinero de prueba)"}
                </StatusPill>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Decide dónde van las órdenes: <strong>testnet</strong> es dinero de prueba (lo de
              ahora) y <strong>producción</strong> es dinero real. Cambiarlo pide 2FA, el aviso de
              riesgo aceptado y que la clave guardada funcione en el entorno de destino.
            </p>
            {entorno.data?.env === "production" ? (
              <div className="space-y-2">
                <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Estás en PRODUCCIÓN: cada operación mueve dinero real. Si algo no cuadra, vuelve a
                  testnet antes de tocar nada.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={cambiandoEntorno}
                  onClick={async () => {
                    try {
                      setCambiandoEntorno(true);
                      await cambiarEntornoFn({ data: { entorno: "testnet", confirmacion: "" } });
                      toast.success("Vuelves a testnet (dinero de prueba).");
                      void entorno.refetch();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "No se pudo cambiar");
                    } finally {
                      setCambiandoEntorno(false);
                    }
                  }}
                >
                  Volver a testnet
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Para pasar a producción: guarda antes una API key de PRODUCCIÓN (con el permiso de
                  futuros si quieres usar la cobertura) y escribe PRODUCION abajo.
                </p>
                <Input
                  placeholder="PRODUCCION"
                  value={confirmacionProduccion}
                  onChange={(e) => setConfirmacionProduccion(e.target.value)}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cambiandoEntorno}
                  onClick={async () => {
                    try {
                      setCambiandoEntorno(true);
                      await cambiarEntornoFn({
                        data: { entorno: "production", confirmacion: confirmacionProduccion },
                      });
                      toast.success("Ahora las órdenes van a producción: dinero real.");
                      setConfirmacionProduccion("");
                      void entorno.refetch();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "No se pudo cambiar");
                    } finally {
                      setCambiandoEntorno(false);
                    }
                  }}
                >
                  Pasar a producción
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Permiso de futuros
              {permisoFuturos && (
                <StatusPill tone={permisoFuturos.ok ? "success" : "warning"}>
                  {permisoFuturos.ok ? "listo" : "falta activarlo"}
                </StatusPill>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Lo necesita el bot de cobertura (carry): compra el spot y vende el perpetuo para
              cobrar la financiación. Es el único bot que no depende de que el precio suba o baje.
              En demo funciona igual (usa los precios reales), pero para operar con dinero real la
              clave necesita el permiso de futuros de Binance.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={comprobandoFuturos}
                onClick={async () => {
                  try {
                    setComprobandoFuturos(true);
                    const r = await comprobarPermisoFuturosFn({});
                    setPermisoFuturos(r);
                    if (r.ok) {
                      toast.success("La clave ya puede operar en futuros.");
                    } else {
                      toast.warning(r.motivo ?? "La clave todavíA no puede operar en futuros.");
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "No se pudo comprobar");
                  } finally {
                    setComprobandoFuturos(false);
                  }
                }}
              >
                {comprobandoFuturos ? "Comprobando…" : "Comprobar el permiso de futuros"}
              </Button>
              {permisoFuturos && !permisoFuturos.ok && permisoFuturos.motivo && (
                <p className="text-xs text-warning">{permisoFuturos.motivo}</p>
              )}
            </div>
            {permisoFuturos?.notaDemo && (
              <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
                {permisoFuturos.notaDemo}
              </p>
            )}
            {permisoFuturos && !permisoFuturos.ok && (
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                {permisoFuturos.pasos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            )}
            {permisoFuturos?.ok && (
              <p className="text-xs text-success">
                Todo listo: la cobertura puede abrir las dos patas con dinero real.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </div>
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
