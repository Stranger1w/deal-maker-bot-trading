import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Lock, PlugZap } from "lucide-react";

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
import { saveBinanceCredentials, testBinanceConnection } from "@/lib/dealmaker.functions";
import { dateTime } from "@/lib/format";
import { binanceQuery } from "@/lib/queries";

export const Route = createFileRoute("/binance")({
  head: () => ({
    meta: [
      { title: "API Keys de Binance — Deal Maker" },
      {
        name: "description",
        content:
          "Guarda tus claves de Binance con cifrado en reposo, prueba la conexión de solo lectura y elige Spot, Futures o ambos.",
      },
      { property: "og:title", content: "API Keys de Binance — Deal Maker" },
      {
        property: "og:description",
        content: "Credenciales cifradas en el backend; el frontend solo ve los últimos 4 caracteres.",
      },
    ],
  }),
  component: BinancePage,
});

type Market = "spot" | "futures" | "both";

function BinancePage() {
  const qc = useQueryClient();
  const settings = useQuery(binanceQuery);
  const test = useServerFn(testBinanceConnection);
  const save = useServerFn(saveBinanceCredentials);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [market, setMarket] = useState<Market>("spot");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<null | { ok: boolean; message: string }>(null);

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
        title="Configuración · API Keys de Binance"
        subtitle="Todo el trading real se ejecuta vía Binance. El secreto se cifra en reposo, nunca se expone al navegador ni se escribe en logs; solo el backend lo descifra para firmar solicitudes."
      />

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
              <Button onClick={runSave} disabled={busy}>
                Guardar cifrado
              </Button>
            </div>
            {tested && (
              <p
                className={
                  tested.ok ? "text-sm text-success" : "text-sm text-destructive"
                }
              >
                {tested.message}
              </p>
            )}
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
                      : saved.connection_status === "failed"
                        ? "Fallida"
                        : "Sin probar"}
                  </StatusPill>
                </div>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
