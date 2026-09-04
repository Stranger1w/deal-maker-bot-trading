import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ComparisonCharts } from "@/components/ComparisonCharts";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime, money } from "@/lib/format";
import {
  auditQuery,
  automationQuery,
  binanceQuery,
  botsQuery,
  fundsQuery,
  workersQuery,
} from "@/lib/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Deal Maker — Panel de bots y minería" },
      {
        name: "description",
        content:
          "Panel en tiempo real para gestionar bots de trading automatizado en Binance y workers de minería de criptomonedas.",
      },
      { property: "og:title", content: "Deal Maker — Panel de bots y minería" },
      {
        property: "og:description",
        content: "Fondos, API Keys de Binance, escuadrón de bots y enjambre de minería en un panel.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const funds = useQuery(fundsQuery);
  const bots = useQuery(botsQuery);
  const workers = useQuery(workersQuery);
  const audit = useQuery(auditQuery);
  const binance = useQuery(binanceQuery);
  const engine = useQuery(automationQuery);

  const botList = bots.data ?? [];
  const workerList = workers.data ?? [];
  const pnl = botList.reduce((s, b) => s + Number(b.pnl), 0);
  const running = botList.filter((b) => b.status === "running").length;
  const realBots = botList.filter((b) => b.mode === "real").length;
  const mining = workerList.filter((w) => w.status === "mining").length;
  const dailyMining = workerList.reduce((s, w) => s + Number(w.estimated_daily_earnings), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Resumen operativo en tiempo real: tesorería, escuadrón de bots en Binance y enjambre de minería."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat
          title="Saldo disponible"
          value={money(Number(funds.data?.available_balance ?? 0))}
          hint={`${money(Number(funds.data?.in_use_balance ?? 0))} en uso por bots`}
          tone="success"
        />
        <Stat
          title="P&L agregado"
          value={money(pnl)}
          hint={`${running} bots corriendo · ${realBots} en real`}
          tone={pnl >= 0 ? "success" : "danger"}
        />
        <Stat
          title="Enjambre de minería"
          value={`${mining}/${workerList.length}`}
          hint={`${money(dailyMining, "USD")} estimado/día`}
          tone={mining > 0 ? "success" : "warning"}
        />
        <Stat
          title="Conexión Binance"
          value={
            binance.data
              ? binance.data.connection_status === "ok"
                ? "Verificada"
                : binance.data.connection_status === "failed"
                  ? "Fallida"
                  : "Sin probar"
              : "Sin configurar"
          }
          hint={binance.data ? `API Key •••• ${binance.data.api_key_last4}` : "Configura tus API Keys"}
          tone={binance.data?.connection_status === "ok" ? "success" : "warning"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            Motor de automatización 24/7
            <Link to="/automatizacion" className="text-xs text-primary hover:underline">
              Gestionar
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <StatusPill
            tone={
              engine.data?.kill_switch
                ? "danger"
                : engine.data?.engine_enabled
                  ? "success"
                  : "warning"
            }
          >
            {engine.data?.kill_switch
              ? "kill switch activo"
              : engine.data?.engine_enabled
                ? (engine.data.engine_status ?? "running")
                : "motor detenido"}
          </StatusPill>
          <span className="text-xs text-muted-foreground">
            Trading real: {engine.data?.allow_real_trading ? "autorizado" : "bloqueado por defecto"}
          </span>
          <span className="text-xs text-muted-foreground">
            Último heartbeat:{" "}
            {engine.data?.last_heartbeat_at ? dateTime(engine.data.last_heartbeat_at) : "sin datos"}
          </span>
        </CardContent>
      </Card>

      <ComparisonCharts />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Escuadrón
              <Link to="/escuadron" className="text-xs text-primary hover:underline">
                Ver todo
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {botList.slice(0, 5).map((bot) => (
              <div
                key={bot.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{bot.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bot.pair} · {bot.mode.toUpperCase()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`tabular text-sm ${Number(bot.pnl) >= 0 ? "text-success" : "text-destructive"}`}
                  >
                    {money(Number(bot.pnl))}
                  </span>
                  <StatusPill tone={statusTone(bot.status)}>{bot.status}</StatusPill>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Enjambre
              <Link to="/mineria" className="text-xs text-primary hover:underline">
                Ver todo
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {workerList.slice(0, 5).map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{w.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.coin} · {w.pool}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular text-sm">
                    {Number(w.hash_rate).toFixed(2)} {w.hash_unit}
                  </span>
                  <StatusPill tone={statusTone(w.status)}>{w.status}</StatusPill>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Auditoría reciente
            <Link to="/fondos" className="text-xs text-primary hover:underline">
              Ver fondos
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(audit.data ?? []).slice(0, 6).map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
            >
              <span className="tabular text-xs text-muted-foreground">{dateTime(e.created_at)}</span>
              <span className="font-medium">{e.action}</span>
              <span className="text-xs text-muted-foreground">{e.entity_id ?? e.entity}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  tone: "success" | "warning" | "danger";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-destructive";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${color}`}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
