import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { SortableTable, type Column } from "@/components/SortableTable";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { runEngineNow, updateAutomationSettings } from "@/lib/dealmaker.functions";
import { dateTime, money } from "@/lib/format";
import {
  automationQuery,
  botsQuery,
  engineRunsQuery,
  executionsQuery,
  type EngineRun,
  type Execution,
} from "@/lib/queries";

export const Route = createFileRoute("/automatizacion")({
  head: () => ({
    meta: [
      { title: "Automatización 24/7 — Deal Maker" },
      {
        name: "description",
        content:
          "Estado del motor de automatización, kill switch global, controles de riesgo y registro de ejecuciones de los bots.",
      },
      { property: "og:title", content: "Automatización 24/7 — Deal Maker" },
      {
        property: "og:description",
        content: "Motor durable en la nube con kill switch, límites de riesgo y logs de ejecución.",
      },
    ],
  }),
  component: AutomationPage,
});

function AutomationPage() {
  const qc = useQueryClient();
  const settings = useQuery(automationQuery);
  const runs = useQuery(engineRunsQuery);
  const executions = useQuery(executionsQuery);
  const bots = useQuery(botsQuery);

  const updateFn = useServerFn(updateAutomationSettings);
  const tickFn = useServerFn(runEngineNow);

  const invalidate = () => {
    void qc.invalidateQueries();
  };

  const update = useMutation({
    mutationFn: (data: Parameters<typeof updateAutomationSettings>[0]["data"]) => updateFn({ data }),
    onSuccess: () => {
      toast.success("Configuración del motor actualizada");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tick = useMutation({
    mutationFn: () => tickFn({}),
    onSuccess: (r) => {
      toast.success(`Ciclo ${r.status}: ${r.botsProcessed} bots · ${r.ordersCreated} órdenes`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = settings.data;
  const [globalLoss, setGlobalLoss] = useState<string>("");
  const [interval, setIntervalValue] = useState<string>("");

  const heartbeatAge = s?.last_heartbeat_at
    ? Math.round((Date.now() - new Date(s.last_heartbeat_at).getTime()) / 1000)
    : null;
  const healthy =
    !!s && s.engine_enabled && !s.kill_switch && heartbeatAge !== null && heartbeatAge < (s.tick_interval_seconds ?? 60) * 3;

  const runColumns: Column<EngineRun>[] = [
    {
      key: "started_at",
      label: "Inicio",
      value: (r) => r.started_at,
      render: (r) => <span className="tabular text-xs">{dateTime(r.started_at)}</span>,
    },
    { key: "trigger", label: "Origen", value: (r) => r.trigger, render: (r) => r.trigger },
    {
      key: "status",
      label: "Estado",
      value: (r) => r.status,
      render: (r) => <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>,
    },
    { key: "bots", label: "Bots", align: "right", value: (r) => r.bots_processed, render: (r) => r.bots_processed },
    {
      key: "orders",
      label: "Órdenes",
      align: "right",
      value: (r) => r.orders_created,
      render: (r) => r.orders_created,
    },
    { key: "errors", label: "Errores", align: "right", value: (r) => r.errors, render: (r) => r.errors },
    { key: "retries", label: "Reintentos", align: "right", value: (r) => r.retries, render: (r) => r.retries },
    {
      key: "duration",
      label: "Duración",
      align: "right",
      value: (r) => r.duration_ms,
      render: (r) => `${r.duration_ms} ms`,
    },
  ];

  const execColumns: Column<Execution>[] = [
    {
      key: "created_at",
      label: "Fecha",
      value: (e) => e.created_at,
      render: (e) => <span className="tabular text-xs">{dateTime(e.created_at)}</span>,
    },
    { key: "bot", label: "Bot", value: (e) => e.bot_name, render: (e) => e.bot_name },
    { key: "symbol", label: "Par", value: (e) => e.symbol, render: (e) => e.symbol },
    { key: "side", label: "Lado", value: (e) => e.side, render: (e) => e.side.toUpperCase() },
    { key: "mode", label: "Modo", value: (e) => e.mode, render: (e) => e.mode.toUpperCase() },
    {
      key: "pnl",
      label: "P&L",
      align: "right",
      value: (e) => Number(e.pnl),
      render: (e) => (
        <span className={Number(e.pnl) >= 0 ? "text-success" : "text-destructive"}>{money(Number(e.pnl))}</span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      value: (e) => e.status,
      render: (e) => <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>,
    },
    { key: "attempts", label: "Intentos", align: "right", value: (e) => e.attempts, render: (e) => e.attempts },
  ];

  const automated = (bots.data ?? []).filter((b) => b.status === "running").length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Automatización 24/7"
        subtitle="El motor corre en la nube mediante un worker programado: no requiere que tu PC ni la app de escritorio estén abiertas."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Estado del motor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatusPill tone={s?.kill_switch ? "danger" : healthy ? "success" : "warning"}>
              {s?.kill_switch ? "kill switch" : (s?.engine_status ?? "sin datos")}
            </StatusPill>
            <p className="text-xs text-muted-foreground">
              {heartbeatAge === null ? "Sin heartbeat todavía" : `Heartbeat hace ${heartbeatAge}s`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Salud del worker</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${healthy ? "text-success" : "text-warning"}`}>
              {healthy ? "Saludable" : "Inactivo"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Tick cada {s?.tick_interval_seconds ?? 60}s</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Trading real</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${s?.allow_real_trading ? "text-destructive" : "text-success"}`}>
              {s?.allow_real_trading ? "Autorizado" : "Bloqueado"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Desactivado por defecto</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Bots corriendo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{automated}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s?.last_error ?? "Sin errores recientes"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Control del motor y límites globales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <ToggleRow
              label="Motor de automatización"
              hint="Activa la ejecución programada en la nube."
              checked={!!s?.engine_enabled}
              onChange={(v) => update.mutate({ engineEnabled: v })}
            />
            <ToggleRow
              label="Kill switch global"
              hint="Detiene todos los bots inmediatamente."
              checked={!!s?.kill_switch}
              danger
              onChange={(v) => update.mutate({ killSwitch: v })}
            />
            <ToggleRow
              label="Permitir trading real"
              hint="Requiere API Keys de Binance verificadas."
              checked={!!s?.allow_real_trading}
              danger
              onChange={(v) => update.mutate({ allowRealTrading: v })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="loss">Pérdida diaria máxima global (USD)</Label>
              <Input
                id="loss"
                type="number"
                value={globalLoss}
                placeholder={String(s?.global_max_daily_loss ?? 0)}
                onChange={(e) => setGlobalLoss(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interval">Intervalo de tick (segundos)</Label>
              <Input
                id="interval"
                type="number"
                value={interval}
                placeholder={String(s?.tick_interval_seconds ?? 60)}
                onChange={(e) => setIntervalValue(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={() =>
                  update.mutate({
                    ...(globalLoss ? { globalMaxDailyLoss: Number(globalLoss) } : {}),
                    ...(interval ? { tickIntervalSeconds: Number(interval) } : {}),
                  })
                }
                disabled={update.isPending || (!globalLoss && !interval)}
              >
                Guardar límites
              </Button>
              <Button variant="secondary" onClick={() => tick.mutate()} disabled={tick.isPending}>
                Ejecutar ciclo ahora
              </Button>
            </div>
          </div>

          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Para operar con fondos reales se requiere autenticación con 2FA reales, claves de Binance con permisos
            mínimos y sin retiro, despliegue Cloud activo y revisión humana de riesgos. Deal Maker no promete
            rentabilidad.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ciclos del motor</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={runs.data ?? []}
            columns={runColumns}
            rowKey={(r) => r.id}
            initialSort={{ key: "started_at", dir: "desc" }}
            empty="El motor todavía no ha ejecutado ningún ciclo."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs de ejecución de órdenes</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={executions.data ?? []}
            columns={execColumns}
            rowKey={(e) => e.id}
            initialSort={{ key: "created_at", dir: "desc" }}
            empty="Sin ejecuciones registradas."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  danger,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-3 ${
        danger && checked ? "border-destructive/50 bg-destructive/10" : "border-border bg-secondary/30"
      }`}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
