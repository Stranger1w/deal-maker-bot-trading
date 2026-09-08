import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Eye, Pause, Play, RefreshCw, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SortableTable, type Column } from "@/components/SortableTable";
import { createReconBot, deleteReconBot, runReconScan, setReconStatus } from "@/lib/recon.functions";
import { dateTime } from "@/lib/format";
import {
  marketSourcesQuery,
  reconBotsQuery,
  reconFindingsQuery,
  reconObservationsQuery,
  type MarketDataSource,
  type ReconBot,
  type ReconFinding,
  type ReconObservation,
} from "@/lib/queries";

export const Route = createFileRoute("/reconocimiento")({
  head: () => ({
    meta: [
      { title: "Escuadrón de Reconocimiento — Deal Maker" },
      {
        name: "description",
        content:
          "Bots de reconocimiento que vigilan precios, volumen, order book y noticias, alimentan el dataset compartido y generan hallazgos para el Escuadrón de trading.",
      },
      { property: "og:title", content: "Escuadrón de Reconocimiento — Deal Maker" },
      {
        property: "og:description",
        content:
          "Recolección y análisis de mercado sin ejecutar operaciones ni mover capital, con hallazgos y alertas.",
      },
    ],
  }),
  component: ReconPage,
});

const severityTone = (s: string) =>
  s === "critical" ? "danger" : s === "warning" ? "warning" : "neutral";

function ReconPage() {
  const qc = useQueryClient();
  const bots = useQuery(reconBotsQuery);
  const findings = useQuery(reconFindingsQuery);
  const observations = useQuery(reconObservationsQuery);
  const sources = useQuery(marketSourcesQuery);

  const create = useServerFn(createReconBot);
  const setStatus = useServerFn(setReconStatus);
  const remove = useServerFn(deleteReconBot);
  const scan = useServerFn(runReconScan);

  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    symbols: "BTCUSDT",
    sources: "Binance Spot Klines",
    focus: "price" as "price" | "volume" | "orderbook" | "news" | "indicators",
    intervalSeconds: 300,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["recon_bots"] });
    void qc.invalidateQueries({ queryKey: ["recon_findings"] });
    void qc.invalidateQueries({ queryKey: ["recon_observations"] });
    void qc.invalidateQueries({ queryKey: ["market_data_sources"] });
    void qc.invalidateQueries({ queryKey: ["alerts"] });
  };

  const list = bots.data ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? list.filter((b) =>
        [b.name, b.status, b.focus, b.sources.join(" "), b.symbols.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
    : list;

  const addBot = async () => {
    const symbols = form.symbols.split(",").map((s) => s.trim()).filter(Boolean);
    const srcs = form.sources.split(",").map((s) => s.trim()).filter(Boolean);
    if (form.name.trim().length < 2 || !symbols.length || !srcs.length) {
      toast.error("Completa nombre, al menos una fuente y un activo");
      return;
    }
    try {
      setBusy(true);
      await create({
        data: {
          name: form.name.trim(),
          symbols,
          sources: srcs,
          focus: form.focus,
          intervalSeconds: Number(form.intervalSeconds),
        },
      });
      toast.success("Bot de reconocimiento creado");
      setForm({ ...form, name: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear el bot");
    } finally {
      setBusy(false);
    }
  };

  const runScan = async (botId?: string) => {
    try {
      setBusy(true);
      const res = (await scan({ data: botId ? { botId } : {} })) as {
        scanned: number;
        findings: number;
      };
      toast.success(`Escaneo completado: ${res.scanned} bot(s), ${res.findings} hallazgo(s)`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "El escaneo falló");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (bot: ReconBot) => {
    try {
      await setStatus({
        data: { botId: bot.id, status: bot.status === "active" ? "paused" : "active" },
      });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acción fallida");
    }
  };

  const botColumns: Column<ReconBot>[] = [
    {
      key: "name",
      label: "Bot",
      value: (b) => b.name,
      render: (b) => (
        <div>
          <p className="font-medium">{b.name}</p>
          <p className="text-xs text-muted-foreground">{b.symbols.join(", ")}</p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Estado",
      value: (b) => b.status,
      render: (b) => (
        <StatusPill tone={b.status === "active" ? "success" : "neutral"}>
          {b.status === "active" ? "activo" : "pausado"}
        </StatusPill>
      ),
    },
    {
      key: "sources",
      label: "Fuentes vigiladas",
      value: (b) => b.sources.join(", "),
      render: (b) => <span className="text-xs">{b.sources.join(" · ")}</span>,
    },
    { key: "focus", label: "Enfoque", value: (b) => b.focus, render: (b) => b.focus },
    {
      key: "last",
      label: "Última actualización",
      value: (b) => b.last_run_at ?? "",
      render: (b) => (b.last_run_at ? dateTime(b.last_run_at) : "—"),
    },
    {
      key: "obs",
      label: "Datos",
      align: "right",
      value: (b) => Number(b.observations_count),
      render: (b) => Number(b.observations_count).toLocaleString("es-ES"),
    },
    {
      key: "find",
      label: "Hallazgos",
      align: "right",
      value: (b) => Number(b.findings_count),
      render: (b) => Number(b.findings_count),
    },
    {
      key: "actions",
      label: "Acciones",
      render: (b) => (
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => toggle(b)} aria-label={`Alternar ${b.name}`}>
            {b.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => runScan(b.id)}
            aria-label={`Escanear con ${b.name}`}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await remove({ data: { botId: b.id } });
              refresh();
            }}
            aria-label={`Eliminar ${b.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const findingColumns: Column<ReconFinding>[] = [
    {
      key: "created",
      label: "Fecha",
      value: (f) => f.created_at,
      render: (f) => dateTime(f.created_at),
    },
    { key: "symbol", label: "Activo", value: (f) => f.symbol, render: (f) => f.symbol },
    {
      key: "severity",
      label: "Severidad",
      value: (f) => f.severity,
      render: (f) => <StatusPill tone={severityTone(f.severity)}>{f.severity}</StatusPill>,
    },
    {
      key: "headline",
      label: "Hallazgo",
      value: (f) => f.headline,
      render: (f) => (
        <div className="max-w-md">
          <p className="font-medium">{f.headline}</p>
          <p className="text-xs text-muted-foreground">{f.detail}</p>
        </div>
      ),
    },
    {
      key: "confidence",
      label: "Confianza",
      align: "right",
      value: (f) => Number(f.confidence),
      render: (f) => `${Math.round(Number(f.confidence) * 100)}%`,
    },
    {
      key: "bot",
      label: "Bot",
      value: (f) => f.bot_name,
      render: (f) => (
        <span className="text-xs text-muted-foreground">
          {f.bot_name}
          {f.is_demo ? " · demo" : ""}
        </span>
      ),
    },
  ];

  const sourceColumns: Column<MarketDataSource>[] = [
    { key: "name", label: "Fuente", value: (s) => s.name, render: (s) => s.name },
    { key: "kind", label: "Tipo", value: (s) => s.kind, render: (s) => s.kind },
    {
      key: "status",
      label: "Estado",
      value: (s) => s.status,
      render: (s) => (
        <StatusPill
          tone={s.status === "connected" ? "success" : s.status === "error" ? "danger" : "neutral"}
        >
          {s.enabled ? s.status : "desactivada"}
        </StatusPill>
      ),
    },
    {
      key: "sync",
      label: "Última sincronización",
      value: (s) => s.last_sync_at ?? "",
      render: (s) => (s.last_sync_at ? dateTime(s.last_sync_at) : "—"),
    },
    {
      key: "notes",
      label: "Notas",
      render: (s) => <span className="text-xs text-muted-foreground">{s.notes ?? "—"}</span>,
    },
  ];

  const obsColumns: Column<ReconObservation>[] = [
    {
      key: "observed",
      label: "Fecha",
      value: (o) => o.observed_at,
      render: (o) => dateTime(o.observed_at),
    },
    { key: "symbol", label: "Activo", value: (o) => o.symbol, render: (o) => o.symbol },
    { key: "metric", label: "Métrica", value: (o) => o.metric, render: (o) => o.metric },
    {
      key: "value",
      label: "Valor",
      align: "right",
      value: (o) => Number(o.value),
      render: (o) => Number(o.value).toLocaleString("es-ES", { maximumFractionDigits: 4 }),
    },
    { key: "source", label: "Fuente", value: (o) => o.source, render: (o) => o.source },
    {
      key: "demo",
      label: "Origen",
      value: (o) => String(o.is_demo),
      render: (o) => (
        <StatusPill tone={o.is_demo ? "warning" : "success"}>{o.is_demo ? "demo" : "real"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Escuadrón de Reconocimiento"
        subtitle="Bots que solo estudian el mercado: precios, volumen, order book, noticias e indicadores. No ejecutan operaciones, no tienen modo Demo/Real y no mueven capital."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Bots activos</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {list.filter((b) => b.status === "active").length} / {list.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Datos en el dataset compartido</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {list.reduce((s, b) => s + Number(b.observations_count), 0).toLocaleString("es-ES")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Hallazgos registrados</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {(findings.data ?? []).length}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Eye className="size-4" /> Bots de reconocimiento
          </CardTitle>
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar bot, fuente o activo"
              className="w-56"
            />
            <Button disabled={busy} onClick={() => runScan()}>
              <RefreshCw className="mr-2 size-4" /> Escanear enjambre
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={filtered}
            columns={botColumns}
            rowKey={(b) => b.id}
            initialSort={{ key: "name", dir: "asc" }}
            empty="Aún no hay bots de reconocimiento."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo bot de reconocimiento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="recon-name">Nombre</Label>
            <Input
              id="recon-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Scout SOL"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recon-symbols">Activos (coma)</Label>
            <Input
              id="recon-symbols"
              value={form.symbols}
              onChange={(e) => setForm({ ...form, symbols: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recon-sources">Fuentes (coma)</Label>
            <Input
              id="recon-sources"
              value={form.sources}
              onChange={(e) => setForm({ ...form, sources: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recon-focus">Enfoque</Label>
            <select
              id="recon-focus"
              value={form.focus}
              onChange={(e) => setForm({ ...form, focus: e.target.value as typeof form.focus })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="price">Precios</option>
              <option value="volume">Volumen</option>
              <option value="orderbook">Order book</option>
              <option value="news">Noticias</option>
              <option value="indicators">Indicadores</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recon-interval">Frecuencia (segundos)</Label>
            <Input
              id="recon-interval"
              type="number"
              min={60}
              value={form.intervalSeconds}
              onChange={(e) => setForm({ ...form, intervalSeconds: Number(e.target.value) })}
            />
          </div>
          <div className="md:col-span-5">
            <Button disabled={busy} onClick={addBot}>
              Añadir al escuadrón
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Panel de hallazgos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Resumen legible de patrones detectados. Los hallazgos de severidad media o alta también
            se envían al sistema de alertas para que puedas actuar antes de operar.
          </p>
          <SortableTable
            rows={findings.data ?? []}
            columns={findingColumns}
            rowKey={(f) => f.id}
            initialSort={{ key: "created", dir: "desc" }}
            empty="Sin hallazgos todavía. Ejecuta un escaneo."
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fuentes conectadas</CardTitle>
          </CardHeader>
          <CardContent>
            <SortableTable
              rows={sources.data ?? []}
              columns={sourceColumns}
              rowKey={(s) => s.id}
              initialSort={{ key: "name", dir: "asc" }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dataset compartido (últimos datos)</CardTitle>
          </CardHeader>
          <CardContent>
            <SortableTable
              rows={observations.data ?? []}
              columns={obsColumns}
              rowKey={(o) => o.id}
              initialSort={{ key: "observed", dir: "desc" }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
