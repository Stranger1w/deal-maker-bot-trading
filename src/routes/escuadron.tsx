import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Brain, Pause, Play, ScrollText, Settings2, ShieldAlert, Square } from "lucide-react";

import { AlertsPanel } from "@/components/AlertsPanel";
import { PageHeader } from "@/components/PageHeader";
import { SortableTable, type Column } from "@/components/SortableTable";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createBot,
  createSandbox,
  promoteRun,
  runSandbox,
  setBotMode,
  setBotStatus,
  updateBotStrategy,
} from "@/lib/dealmaker.functions";
import { useSecuritySession } from "@/hooks/useSecuritySession";
import {
  evaluatePromotion,
  promoteBotToReal,
  saveBotRisk,
  saveSquadRisk,
  type PromotionCheck,
} from "@/lib/risk.functions";
import { dateTime, money, pct } from "@/lib/format";
import {
  automationQuery,
  botLogsQuery,
  botsQuery,
  sandboxesQuery,
  trainingRunsQuery,
  type Bot as BotRow,
} from "@/lib/queries";

export const Route = createFileRoute("/escuadron")({
  head: () => ({
    meta: [
      { title: "Escuadrón de bots — Deal Maker" },
      {
        name: "description",
        content:
          "Gestiona bots de trading en Binance: estado, P&L, modo demo/real, logs y campo de entrenamiento con IA multi-plataforma.",
      },
      { property: "og:title", content: "Escuadrón de bots — Deal Maker" },
      {
        property: "og:description",
        content: "Control de bots, agrupación por estrategia y sandbox de entrenamiento acelerado.",
      },
    ],
  }),
  component: SquadPage,
});

function SquadPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Escuadrón de bots"
        subtitle="Cada bot opera en Binance. Demo usa Binance testnet o el simulador interno; Real requiere confirmación explícita y consume fondos reales."
      />
      <Tabs defaultValue="squad">
        <TabsList>
          <TabsTrigger value="squad">Bots</TabsTrigger>
          <TabsTrigger value="training">Campo de entrenamiento</TabsTrigger>
        </TabsList>
        <TabsContent value="squad" className="mt-6">
          <SquadTab />
        </TabsContent>
        <TabsContent value="training" className="mt-6">
          <TrainingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ BOTS ------------------------------ */

function SquadTab() {
  const qc = useQueryClient();
  const bots = useQuery(botsQuery);
  const logs = useQuery(botLogsQuery);
  const status = useServerFn(setBotStatus);
  const mode = useServerFn(setBotMode);
  const create = useServerFn(createBot);
  const edit = useServerFn(updateBotStrategy);

  const settings = useQuery(automationQuery);
  const session = useSecuritySession();
  const saveRisk = useServerFn(saveBotRisk);
  const saveSquad = useServerFn(saveSquadRisk);
  const evaluate = useServerFn(evaluatePromotion);
  const promote = useServerFn(promoteBotToReal);

  const [view, setView] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState("");
  const [riskFor, setRiskFor] = useState<BotRow | null>(null);
  const [check, setCheck] = useState<PromotionCheck | null>(null);
  const [squadForm, setSquadForm] = useState<Record<string, string> | null>(null);
  const [groupBy, setGroupBy] = useState<"strategy" | "pair">("strategy");
  const [realTarget, setRealTarget] = useState<BotRow | null>(null);
  const [logsFor, setLogsFor] = useState<BotRow | null>(null);
  const [editing, setEditing] = useState<BotRow | null>(null);
  const [form, setForm] = useState({ name: "", strategy: "momentum", pair: "BTCUSDT", capital: "1000" });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bots"] });
    void qc.invalidateQueries({ queryKey: ["bot_logs"] });
    void qc.invalidateQueries({ queryKey: ["audit_events"] });
  };

  const groups = useMemo(() => {
    const map = new Map<string, BotRow[]>();
    for (const bot of bots.data ?? []) {
      const key = groupBy === "strategy" ? bot.strategy : bot.pair;
      map.set(key, [...(map.get(key) ?? []), bot]);
    }
    return [...map.entries()];
  }, [bots.data, groupBy]);

  const act = async (bot: BotRow, next: "running" | "paused" | "stopped") => {
    try {
      await status({ data: { botId: bot.id, status: next } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acción fallida");
    }
  };

  const toggleMode = async (bot: BotRow, toReal: boolean) => {
    if (toReal) {
      setRealTarget(bot);
      setCheck(null);
      try {
        setCheck(await evaluate({ data: { botId: bot.id } }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo validar el bot");
      }
      return;
    }
    try {
      await mode({ data: { botId: bot.id, mode: "demo", confirmed: true } });
      toast.success(`${bot.name} vuelve a modo Demo`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el modo");
    }
  };

  const confirmReal = async () => {
    if (!realTarget) return;
    try {
      await promote({ data: { botId: realTarget.id, confirmed: true } });
      toast.success(`${realTarget.name} operará con fondos reales vía Binance`);
      setRealTarget(null);
      setCheck(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo activar el modo Real");
    }
  };

  const submitNew = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Nombre demasiado corto");
      return;
    }
    try {
      await create({
        data: {
          name: form.name.trim(),
          strategy: form.strategy,
          pair: form.pair,
          capital: Number(form.capital) || 0,
        },
      });
      toast.success("Bot creado en modo Demo");
      setForm({ name: "", strategy: "momentum", pair: "BTCUSDT", capital: "1000" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear el bot");
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      await edit({
        data: {
          botId: editing.id,
          strategy: editing.strategy,
          pair: editing.pair,
          capital: Number(editing.capital) || 0,
        },
      });
      toast.success("Estrategia actualizada");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo editar el bot");
    }
  };

  const submitRisk = async () => {
    if (!riskFor) return;
    try {
      await saveRisk({
        data: {
          botId: riskFor.id,
          automationEnabled: riskFor.automation_enabled,
          stopLossPct: Number(riskFor.stop_loss_pct) || 0,
          takeProfitPct: Number(riskFor.take_profit_pct) || 0,
          maxDailyLoss: Number(riskFor.max_daily_loss) || 0,
          maxDrawdownPct: Number(riskFor.max_drawdown_pct) || 0,
          maxWeeklyDrawdownPct: Number(riskFor.max_weekly_drawdown_pct) || 0,
          maxCapital: Number(riskFor.max_capital) || 0,
          maxTradesPerDay: Number(riskFor.max_trades_per_day) || 0,
        },
      });
      toast.success("Riesgo del bot actualizado");
      setRiskFor(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el riesgo");
    }
  };

  const squadValues = squadForm ?? {
    globalMaxDailyLoss: String(settings.data?.global_max_daily_loss ?? 500),
    globalMaxDrawdownPct: String(settings.data?.global_max_drawdown_pct ?? 15),
    globalMaxWeeklyDrawdownPct: String(settings.data?.global_max_weekly_drawdown_pct ?? 25),
    globalMaxCapital: String(settings.data?.global_max_capital ?? 50000),
    maxPairConcentrationPct: String(settings.data?.max_pair_concentration_pct ?? 40),
    minDemoDays: String(settings.data?.min_demo_days ?? 14),
    minDemoTrades: String(settings.data?.min_demo_trades ?? 50),
  };

  const submitSquad = async () => {
    try {
      await saveSquad({
        data: {
          globalMaxDailyLoss: Number(squadValues['globalMaxDailyLoss']) || 0,
          globalMaxDrawdownPct: Number(squadValues['globalMaxDrawdownPct']) || 0,
          globalMaxWeeklyDrawdownPct: Number(squadValues['globalMaxWeeklyDrawdownPct']) || 0,
          globalMaxCapital: Number(squadValues['globalMaxCapital']) || 0,
          maxPairConcentrationPct: Number(squadValues['maxPairConcentrationPct']) || 1,
          minDemoDays: Number(squadValues['minDemoDays']) || 0,
          minDemoTrades: Number(squadValues['minDemoTrades']) || 0,
          requireBenchmarkOutperformance:
            settings.data?.require_benchmark_outperformance !== false,
        },
      });
      toast.success("Límites del escuadrón actualizados");
      void qc.invalidateQueries({ queryKey: ["automation_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron guardar los límites");
    }
  };

  const allBots = bots.data ?? [];
  const term = search.trim().toLowerCase();
  const filteredBots = term
    ? allBots.filter((b) =>
        [b.name, b.strategy, b.pair, b.status, b.mode, b.exchange].join(" ").toLowerCase().includes(term),
      )
    : allBots;

  const squadCapital = allBots.reduce((s, b) => s + Number(b.capital), 0);
  const concentration = allBots.reduce<Record<string, number>>((acc, b) => {
    acc[b.pair] = (acc[b.pair] ?? 0) + Number(b.capital);
    return acc;
  }, {});
  const topPair = Object.entries(concentration).sort((a, b) => b[1] - a[1])[0];
  const topPairPct = topPair && squadCapital > 0 ? (topPair[1] / squadCapital) * 100 : 0;

  const botColumns: Column<BotRow>[] = [
    { key: "name", label: "Bot", value: (b) => b.name, render: (b) => (
      <div>
        <p className="font-medium">{b.name}</p>
        <p className="text-xs text-muted-foreground">{b.strategy} · {b.pair}</p>
      </div>
    ) },
    { key: "status", label: "Estado", value: (b) => b.status, render: (b) => (
      <div className="space-y-1">
        <StatusPill tone={statusTone(b.status)}>{b.status}</StatusPill>
        {b.auto_stop_reason && (
          <p className="text-[11px] text-destructive">{b.auto_stop_reason}</p>
        )}
      </div>
    ) },
    { key: "pnl", label: "P&L", align: "right", value: (b) => Number(b.pnl), render: (b) => (
      <span className={Number(b.pnl) >= 0 ? "text-success" : "text-destructive"}>
        {money(Number(b.pnl))}
      </span>
    ) },
    { key: "mode", label: "Modo", value: (b) => b.mode, render: (b) => (
      <StatusPill tone={b.mode === "real" ? "danger" : "neutral"}>{b.mode}</StatusPill>
    ) },
    { key: "exchange", label: "Exchange", value: (b) => b.exchange, render: (b) => b.exchange },
    { key: "capital", label: "Capital", align: "right", value: (b) => Number(b.capital), render: (b) => money(Number(b.capital)) },
    { key: "risk", label: "SL / TP", align: "right", value: (b) => Number(b.stop_loss_pct), render: (b) => (
      <span className={Number(b.stop_loss_pct) > 0 && Number(b.take_profit_pct) > 0 ? "" : "text-warning"}>
        {Number(b.stop_loss_pct)}% / {Number(b.take_profit_pct)}%
      </span>
    ) },
    { key: "actions", label: "Acciones", render: (b) => (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" onClick={() => act(b, "running")} aria-label={`Iniciar ${b.name}`}>
          <Play className="size-3.5" />
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act(b, "paused")} aria-label={`Pausar ${b.name}`}>
          <Pause className="size-3.5" />
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act(b, "stopped")} aria-label={`Detener ${b.name}`}>
          <Square className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRiskFor(b)} aria-label={`Riesgo de ${b.name}`}>
          <ShieldAlert className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setLogsFor(b)} aria-label={`Logs de ${b.name}`}>
          <ScrollText className="size-3.5" />
        </Button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-6">
      <AlertsPanel title="Alertas del escuadrón" category={["risk", "bot", "engine", "binance", "security"]} limit={5} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riesgo global del escuadrón</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["globalMaxDailyLoss", "Pérdida diaria máx. (USDT)"],
              ["globalMaxDrawdownPct", "Drawdown diario máx. (%)"],
              ["globalMaxWeeklyDrawdownPct", "Drawdown semanal máx. (%)"],
              ["globalMaxCapital", "Tope de capital global (USDT)"],
              ["maxPairConcentrationPct", "Concentración máx. por par (%)"],
              ["minDemoDays", "Días mínimos en demo"],
              ["minDemoTrades", "Operaciones demo mínimas"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  inputMode="decimal"
                  value={squadValues[key as string] ?? ""}
                  onChange={(e) => setSquadForm({ ...squadValues, [key as string]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Capital asignado: {money(squadCapital)}</span>
            {topPair && (
              <span className={topPairPct > Number(settings.data?.max_pair_concentration_pct ?? 40) ? "text-destructive" : ""}>
                Mayor concentración: {topPair[0]} {topPairPct.toFixed(1)}%
              </span>
            )}
          </div>
          <Button onClick={submitSquad}>Guardar límites del escuadrón</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alta rápida</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Estrategia base</Label>
            <Select value={form.strategy} onValueChange={(v) => setForm({ ...form, strategy: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["momentum", "grid", "mean_reversion", "breakout", "scalping"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Par / activo</Label>
            <Input value={form.pair} onChange={(e) => setForm({ ...form, pair: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Capital (USDT)</Label>
            <Input
              inputMode="decimal"
              value={form.capital}
              onChange={(e) => setForm({ ...form, capital: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={submitNew}>
              Crear bot
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-muted-foreground">Vista</Label>
        <Select value={view} onValueChange={(v) => setView(v as "cards" | "table")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cards">Tarjetas</SelectItem>
            <SelectItem value="table">Tabla ordenable</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar bot, estrategia o par"
          className="max-w-xs"
        />
        <Label className="text-muted-foreground">Agrupar por</Label>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "strategy" | "pair")}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="strategy">Estrategia</SelectItem>
            <SelectItem value="pair">Par / activo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {view === "table" && (
        <SortableTable
          rows={filteredBots}
          rowKey={(b) => b.id}
          initialSort={{ key: "pnl", dir: "desc" }}
          columns={botColumns}
          empty="Sin bots en el escuadrón."
        />
      )}

      {view === "cards" && groups.map(([key, list]) => {
        const pnl = list.reduce((s, b) => s + Number(b.pnl), 0);
        const capital = list.reduce((s, b) => s + Number(b.capital), 0);
        const winRate = list.reduce((s, b) => s + Number(b.win_rate), 0) / (list.length || 1);
        return (
          <section key={key} className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 border-l-2 border-primary pl-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{key}</h2>
              <span className="tabular text-sm text-muted-foreground">
                {list.length} bots · capital {money(capital)} · P&L{" "}
                <span className={pnl >= 0 ? "text-success" : "text-destructive"}>{money(pnl)}</span>{" "}
                · win rate {winRate.toFixed(1)}%
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((bot) => (
                <Card key={bot.id} className="border-border/80">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{bot.name}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {bot.pair} · {bot.strategy} · {bot.exchange}
                        </p>
                      </div>
                      <StatusPill tone={statusTone(bot.status)}>{bot.status}</StatusPill>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <Metric label="P&L" value={money(Number(bot.pnl))} positive={Number(bot.pnl) >= 0} />
                      <Metric label="Capital" value={money(Number(bot.capital))} />
                      <Metric label="Win rate" value={`${Number(bot.win_rate).toFixed(1)}%`} />
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2">
                      <div>
                        <p className="text-xs font-medium">
                          {bot.mode === "real" ? "REAL · fondos reales" : "DEMO"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {bot.mode === "real"
                            ? "Binance producción"
                            : bot.demo_engine === "binance_testnet"
                              ? "Binance testnet"
                              : "Simulador interno"}
                        </p>
                      </div>
                      <Switch
                        checked={bot.mode === "real"}
                        onCheckedChange={(v) => toggleMode(bot, v)}
                        aria-label="Alternar demo o real"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => act(bot, "running")}>
                        <Play className="size-3.5" /> Iniciar
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => act(bot, "paused")}>
                        <Pause className="size-3.5" /> Pausar
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => act(bot, "stopped")}>
                        <Square className="size-3.5" /> Detener
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRiskFor(bot)}>
                        <ShieldAlert className="size-3.5" /> Riesgo
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(bot)}>
                        <Settings2 className="size-3.5" /> Estrategia
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setLogsFor(bot)}>
                        <ScrollText className="size-3.5" /> Logs
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      <Dialog open={!!realTarget} onOpenChange={(open) => !open && setRealTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar a modo REAL</DialogTitle>
            <DialogDescription>
              {realTarget?.name} pasará a operar con fondos reales de tu cuenta a través de Binance,
              usando las API Keys verificadas. El cambio queda registrado en la auditoría y el bot se
              deja en pausa para que revises la estrategia antes de iniciarlo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRealTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmReal}>Sí, usar fondos reales</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar estrategia</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Estrategia</Label>
                <Input
                  value={editing.strategy}
                  onChange={(e) => setEditing({ ...editing, strategy: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Par</Label>
                <Input
                  value={editing.pair}
                  onChange={(e) => setEditing({ ...editing, pair: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Capital</Label>
                <Input
                  inputMode="decimal"
                  value={String(editing.capital)}
                  onChange={(e) => setEditing({ ...editing, capital: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={submitEdit}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!logsFor} onOpenChange={(open) => !open && setLogsFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logs · {logsFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(logs.data ?? [])
              .filter((log) => log.bot_id === logsFor?.id)
              .map((log) => (
                <div key={log.id} className="rounded-md border border-border px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <StatusPill tone={log.level === "error" ? "danger" : log.level === "warn" ? "warning" : "success"}>
                      {log.level}
                    </StatusPill>
                    <span className="tabular text-muted-foreground">{dateTime(log.created_at)}</span>
                  </div>
                  <p className="mt-1.5">{log.message}</p>
                </div>
              ))}
            {(logs.data ?? []).filter((log) => log.bot_id === logsFor?.id).length === 0 && (
              <p className="text-sm text-muted-foreground">Sin registros todavía.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p
        className={`tabular text-sm font-semibold ${
          positive === undefined ? "" : positive ? "text-success" : "text-destructive"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------ CAMPO DE ENTRENAMIENTO ------------------------ */

function TrainingTab() {
  const qc = useQueryClient();
  const sandboxes = useQuery(sandboxesQuery);
  const runs = useQuery(trainingRunsQuery);
  const create = useServerFn(createSandbox);
  const run = useServerFn(runSandbox);
  const promote = useServerFn(promoteRun);

  const [form, setForm] = useState({
    name: "",
    dataset: "binance-klines-1h",
    dateFrom: "2025-01-01",
    dateTo: "2025-03-31",
    pairs: "BTCUSDT, ETHUSDT",
    simulatedCapital: "10000",
    speed: "25",
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["training_sandboxes"] });
    void qc.invalidateQueries({ queryKey: ["training_runs"] });
    void qc.invalidateQueries({ queryKey: ["bots"] });
  };

  const submit = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Ponle un nombre al sandbox");
      return;
    }
    try {
      await create({
        data: {
          name: form.name.trim(),
          dataset: form.dataset,
          dateFrom: form.dateFrom,
          dateTo: form.dateTo,
          pairs: form.pairs.split(",").map((p) => p.trim()).filter(Boolean),
          simulatedCapital: Number(form.simulatedCapital) || 1000,
          speed: Number(form.speed) || 10,
        },
      });
      toast.success("Sandbox creado — sin fondos reales");
      setForm({ ...form, name: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear el sandbox");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="size-4 text-primary" /> Crear sandbox de entrenamiento
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Field label="Nombre">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Dataset">
            <Select value={form.dataset} onValueChange={(v) => setForm({ ...form, dataset: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="binance-klines-1h">Binance klines 1h</SelectItem>
                <SelectItem value="binance-klines-15m">Binance klines 15m</SelectItem>
                <SelectItem value="binance-klines-1d">Binance klines 1d</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Desde">
            <Input
              type="date"
              value={form.dateFrom}
              onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={form.dateTo}
              onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
            />
          </Field>
          <Field label="Pares (coma)">
            <Input value={form.pairs} onChange={(e) => setForm({ ...form, pairs: e.target.value })} />
          </Field>
          <Field label="Capital simulado">
            <Input
              inputMode="decimal"
              value={form.simulatedCapital}
              onChange={(e) => setForm({ ...form, simulatedCapital: e.target.value })}
            />
          </Field>
          <Field label="Velocidad (x)">
            <Input
              inputMode="numeric"
              value={form.speed}
              onChange={(e) => setForm({ ...form, speed: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={submit}>
              Crear sandbox
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {(sandboxes.data ?? []).map((sandbox) => {
          const sandboxRuns = (runs.data ?? []).filter((r) => r.sandbox_id === sandbox.id);
          return (
            <Card key={sandbox.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{sandbox.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {sandbox.dataset} · {sandbox.date_from} → {sandbox.date_to} ·{" "}
                      {sandbox.pairs.join(", ")} · {sandbox.speed}x ·{" "}
                      {money(Number(sandbox.simulated_capital))} simulados
                    </p>
                  </div>
                  <StatusPill tone={statusTone(sandbox.status)}>{sandbox.status}</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Retorno" value={pct(sandbox.return_pct)} positive={(sandbox.return_pct ?? 0) >= 0} />
                  <Metric label="Drawdown" value={pct(sandbox.drawdown_pct)} />
                  <Metric
                    label="Win rate"
                    value={sandbox.win_rate === null ? "—" : `${Number(sandbox.win_rate).toFixed(1)}%`}
                  />
                </div>

                <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs">
                  <p className="mb-1.5 font-medium uppercase tracking-wide text-primary">
                    Capa de IA multi-plataforma
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    {(sandbox.ai_sources ?? []).map((src) => (
                      <li key={src.source}>
                        · {src.source} <span className="tabular">({src.range})</span>
                      </li>
                    ))}
                  </ul>
                  {sandbox.ai_notes && <p className="mt-2 text-muted-foreground">{sandbox.ai_notes}</p>}
                </div>

                {sandboxRuns.length > 0 && (
                  <div className="space-y-2">
                    {sandboxRuns.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
                      >
                        <span className="font-medium">{r.bot_name}</span>
                        <span className="tabular text-muted-foreground">
                          ret {pct(r.return_pct)} · dd {pct(r.drawdown_pct)} · wr{" "}
                          {Number(r.win_rate).toFixed(1)}%
                        </span>
                        <span className="tabular text-[11px] text-muted-foreground">
                          {JSON.stringify(r.suggested_params)}
                        </span>
                        <Button
                          size="sm"
                          variant={r.promoted ? "ghost" : "secondary"}
                          disabled={r.promoted}
                          onClick={async () => {
                            try {
                              await promote({ data: { runId: r.id } });
                              toast.success(`${r.bot_name} promovido a Demo`);
                              refresh();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Error al promover");
                            }
                          }}
                        >
                          {r.promoted ? "Promovido" : "Promover a Demo"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={async () => {
                    try {
                      const res = await run({ data: { sandboxId: sandbox.id } });
                      toast.success(`Simulación acelerada completada (${res.runs} bots)`);
                      refresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error en la simulación");
                    }
                  }}
                >
                  Ejecutar simulación acelerada
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
