import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { SortableTable, type Column } from "@/components/SortableTable";
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
import { updateBotStrategy } from "@/lib/dealmaker.functions";
import { dateTime, pct } from "@/lib/format";
import {
  listarMercados,
  validarParMercado,
  type MercadosSnapshot,
  type ParMercado,
} from "@/lib/markets.server";
import { botsQuery } from "@/lib/queries";

export const Route = createFileRoute("/mercados")({
  head: () => ({
    meta: [
      { title: "Mercados — Deal Maker" },
      {
        name: "description",
        content:
          "Pares de Binance con precio, cambio 24 h, volumen y volatilidad; buscador, filtro por cotización y asignación de par a un bot.",
      },
      { property: "og:title", content: "Mercados — Deal Maker" },
    ],
  }),
  component: MercadosPage,
});

/** Precio con precisión suficiente para altos y micropares. */
function fmtPrecio(v: number): string {
  const max = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: max }).format(v);
}

/** Volumen 24 h en formato compacto (M, B…). */
function fmtVolumen(v: number): string {
  return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 2 }).format(
    v,
  );
}

const COLUMNAS: Column<ParMercado>[] = [
  {
    key: "symbol",
    label: "Par",
    value: (x) => x.symbol,
    render: (x) => (
      <span className="font-medium">
        {x.base}
        <span className="text-muted-foreground">/{x.quote}</span>
      </span>
    ),
  },
  {
    key: "price",
    label: "Precio",
    align: "right",
    value: (x) => x.price,
    render: (x) => <span className="tabular">{fmtPrecio(x.price)}</span>,
  },
  {
    key: "changePct",
    label: "Cambio 24 h",
    align: "right",
    value: (x) => x.changePct,
    render: (x) => (
      <span className={x.changePct >= 0 ? "text-success" : "text-destructive"}>
        {pct(x.changePct)}
      </span>
    ),
  },
  {
    key: "quoteVolume",
    label: "Volumen 24 h",
    align: "right",
    value: (x) => x.quoteVolume,
    render: (x) => <span className="tabular">{fmtVolumen(x.quoteVolume)}</span>,
  },
  {
    key: "volatility",
    label: "Volatilidad 24 h",
    align: "right",
    value: (x) => x.volatility,
    render: (x) => (
      <span className="tabular" title="(máximo − mínimo) / precio del último cierre">
        {(x.volatility * 100).toFixed(2)} %
      </span>
    ),
  },
];

function MercadosPage() {
  const qc = useQueryClient();
  // Lector público del entorno activo (sin API key): el server lo cachea 60 s,
  // aquí solo se refresca al mismo ritmo para no insistir con Binance.
  const mercadosFn = useServerFn(listarMercados);
  const mercados = useQuery({
    queryKey: ["mercados"],
    refetchInterval: 60_000,
    queryFn: (): Promise<MercadosSnapshot> => mercadosFn(),
  });

  const bots = useQuery(botsQuery);
  const validar = useServerFn(validarParMercado);
  const editar = useServerFn(updateBotStrategy);

  const [search, setSearch] = useState("");
  const [quote, setQuote] = useState("USDT");
  const [target, setTarget] = useState<ParMercado | null>(null);
  const [botId, setBotId] = useState("");
  const [enviando, setEnviando] = useState(false);

  const snapshot = mercados.data;
  const rows = useMemo(() => snapshot?.rows ?? [], [snapshot]);

  // Cotizaciones disponibles según el entorno; por defecto USDT (y si el
  // entorno activo no la tuviera, la más numerosa).
  const quotes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.quote, (counts.get(r.quote) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([q]) => q);
  }, [rows]);
  const quoteActiva = quotes.includes(quote) ? quote : (quotes[0] ?? "USDT");

  const filtrados = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows.filter((r) => r.quote === quoteActiva && (!q || r.symbol.includes(q)));
  }, [rows, quoteActiva, search]);

  const botSel = (bots.data ?? []).find((b) => b.id === botId) ?? null;

  const columnas: Column<ParMercado>[] = [
    ...COLUMNAS,
    {
      key: "accion",
      label: "Acción",
      align: "right",
      render: (x) => (
        <Button size="sm" variant="outline" onClick={() => abrirAsignar(x)}>
          Asignar a bot
        </Button>
      ),
    },
  ];

  function abrirAsignar(par: ParMercado) {
    setBotId("");
    setTarget(par);
  }

  async function asignar() {
    if (!target || !botSel) return;
    setEnviando(true);
    try {
      // Pre-validación de ayuda en la UI: la que vale de verdad está en el
      // servidor (updateBotStrategy), para que rija desde cualquier pantalla.
      const check = await validar({ data: { symbol: target.symbol } });
      if (!check.ok) {
        toast.error(check.motivo ?? `El par ${target.symbol} no existe en el entorno activo`);
        return;
      }
      // Reutiliza updateBotStrategy: mismos datos actuales del bot con el par nuevo.
      await editar({
        data: {
          botId: botSel.id,
          strategy: botSel.strategy,
          pair: target.symbol,
          capital: botSel.capital,
        },
      });
      toast.success(`${botSel.name} ahora opera ${target.symbol}`);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["bots"] });
    } catch (e) {
      // Si el bot tiene posición abierta, updateBotStrategy lanza el motivo del bloqueo.
      toast.error(e instanceof Error ? e.message : "No se pudo asignar el par");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Mercados"
        subtitle="Precios de Binance 24 h (lector público, sin API key). Solo pares que existen en el entorno activo; la cotización por defecto es USDT."
      />
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>Pares con ticker 24 h</CardTitle>
          {snapshot && (
            <span className="text-xs text-muted-foreground">
              Entorno activo: {snapshot.env === "production" ? "producción" : "testnet"} ·
              actualizado {dateTime(snapshot.fetchedAt)}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar par (p. ej. BTC)"
                aria-label="Buscar par"
                className="w-56 pl-8"
              />
            </div>
            <Select value={quoteActiva} onValueChange={setQuote}>
              <SelectTrigger className="w-40" aria-label="Cotización">
                <SelectValue placeholder="Cotización" />
              </SelectTrigger>
              <SelectContent>
                {quotes.map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {filtrados.length} de {rows.length} pares
            </span>
          </div>
          {mercados.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando mercados…</p>
          ) : (
            <SortableTable
              rows={filtrados}
              columns={columnas}
              rowKey={(x) => x.symbol}
              initialSort={{ key: "quoteVolume", dir: "desc" }}
              empty={snapshot?.aviso ?? "Sin pares para este filtro en el entorno activo."}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar {target?.symbol} a un bot</DialogTitle>
            <DialogDescription>
              El bot pasará a operar {target?.symbol} con su estrategia y capital actuales. Si el
              bot tiene una posición abierta en su par actual, el cambio de par queda bloqueado
              hasta cerrarla.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Bot</Label>
            <Select
              {...(botId === ""
                ? { onValueChange: setBotId }
                : { value: botId, onValueChange: setBotId })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elige un bot" />
              </SelectTrigger>
              <SelectContent>
                {(bots.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} · {b.pair}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {botSel && target && botSel.pair !== target.symbol && (
              <p className="text-xs text-muted-foreground">
                {botSel.name} dejará de operar {botSel.pair} para operar {target.symbol}.
              </p>
            )}
            {botSel && target && botSel.pair === target.symbol && (
              <p className="text-xs text-muted-foreground">Este bot ya opera {target.symbol}.</p>
            )}
            {(bots.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">Todavía no hay bots para asignar.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void asignar()}
              disabled={!target || !botSel || botSel.pair === target.symbol || enviando}
            >
              {enviando ? "Asignando…" : "Asignar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
