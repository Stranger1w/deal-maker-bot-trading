import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pickaxe, Play, RotateCcw, Square, Dumbbell, Database } from "lucide-react";

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
import { AlertsPanel } from "@/components/AlertsPanel";
import { SortableTable, type Column } from "@/components/SortableTable";
import { createWorker, setWorkerStatus } from "@/lib/dealmaker.functions";
import {
  avanzarMineria,
  compararMineria,
  entrenarEnjambreMineria,
  entrenarWorkerMineria,
  estadoMineria,
  guardarCosteLuz,
  medirHashrateMineria,
} from "@/lib/mineria.functions";
import { CAPACIDAD_ENJAMBRE } from "@/lib/mineria/modelo";
import { listarOpcionesMineria } from "@/lib/pools.functions";
import { dateTime, money, uptime } from "@/lib/format";
import { payoutsQuery, workersQuery, type Payout, type Worker } from "@/lib/queries";

export const Route = createFileRoute("/mineria")({
  head: () => ({
    meta: [
      { title: "Enjambre de minería — Deal Maker" },
      {
        name: "description",
        content:
          "Workers de minería con hash rate, moneda, pool, uptime, control individual o de todo el enjambre e historial de pagos.",
      },
      { property: "og:title", content: "Enjambre de minería — Deal Maker" },
      {
        property: "og:description",
        content: "Monitorización de rigs, ganancias estimadas y pagos por moneda y pool.",
      },
    ],
  }),
  component: MiningPage,
});

/**
 * Dollars de verdad: cuando la cifra es tan pequena que sale "0,00", se
 * dice "< 0,0001 USD" en vez de aparentar que no hay nada. Un ASIC da
 * 7e-09 USD al dia: ocultarlo seria mentira por omision.
 */
function usdFino(valor: number): string {
  const v = Number(valor ?? 0);
  if (!Number.isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 0.0001) return "< 0,0001 USD";
  return money(v, "USD");
}

function MiningPage() {
  const qc = useQueryClient();
  const workers = useQuery(workersQuery);
  const payouts = useQuery(payoutsQuery);
  const control = useServerFn(setWorkerStatus);
  const create = useServerFn(createWorker);

  // Estado real del enjambre (hash rate medido, ganancia neta, luz).
  const estadoFn = useServerFn(estadoMineria);
  const medirFn = useServerFn(medirHashrateMineria);
  const avanzarFn = useServerFn(avanzarMineria);
  const guardarLuzFn = useServerFn(guardarCosteLuz);
  const compararFn = useServerFn(compararMineria);

  const [comparativa, setComparativa] = useState<{
    filas: Array<{
      coin: string;
      hashRate: number;
      hashUnit: string;
      brutoUsd: number;
      luzUsd: number;
      netoUsd: number;
      monedasDia: number;
      motivo: string | null;
      veredicto: string;
    }>;
    mejor: { coin: string; netoUsd: number } | null;
    veredicto: string;
    ningunaSaleACuenta: boolean;
  } | null>(null);
  const [comparando, setComparando] = useState(false);

  const comparar = async () => {
    setComparando(true);
    try {
      const r = await compararFn({});
      setComparativa(r);
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo comparar");
    } finally {
      setComparando(false);
    }
  };

  const estado = useQuery({
    queryKey: ["estado_mineria"],
    queryFn: () => estadoFn({}),
    refetchInterval: 60000,
  });

  const [midiendo, setMidiendo] = useState(false);

  // Campo de entrenamiento: medir el hash rate real con N hilos.
  const entrenarFn = useServerFn(entrenarWorkerMineria);
  const entrenarEnjambreFn = useServerFn(entrenarEnjambreMineria);
  const [entrenando, setEntrenando] = useState(false);
  const [entrenamiento, setEntrenamiento] = useState<{
    workerNombre: string;
    nucleos: number;
    curva: Array<{ hilos: number; valor: number; unidad: string; hashes: number }>;
    hilosElegidos: number;
    valor: number;
    unidad: string;
    antesHashPorSegundo: number;
    mejora: number;
    aviso: string | null;
  } | null>(null);

  const entrenar = async (workerId: string, workerNombre: string) => {
    setEntrenando(true);
    try {
      const r = await entrenarFn({ data: { workerId } });
      setEntrenamiento(r);
      toast.success(
        `${workerNombre}: ${r.valor.toFixed(2)} ${r.unidad} con ${r.hilosElegidos} hilo(s) (x${r.mejora.toFixed(2)} que con uno)`,
      );
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo entrenar");
    } finally {
      setEntrenando(false);
    }
  };

  const entrenarTodos = async () => {
    setEntrenando(true);
    try {
      const r = await entrenarEnjambreFn({});
      toast.success(r.mensaje);
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo entrenar el enjambre");
    } finally {
      setEntrenando(false);
    }
  };

  // Las listas REALES de monedas y pools (leidas de los pools y de Binance).
  const opcionesFn = useServerFn(listarOpcionesMineria);
  const [opciones, setOpciones] = useState<{
    minables: Array<{ simbolo: string; nombre: string; pools: string[] }>;
    mercado: Array<{ simbolo: string; nombre: string; minable: boolean; pools: string[] }>;
    pools: Array<{
      id: string;
      nombre: string;
      url: string;
      monedas: string[];
      fuente: string;
      enVivo: boolean;
    }>;
  } | null>(null);

  useEffect(() => {
    let vivo = true;
    void opcionesFn({})
      .then((o) => {
        if (vivo) setOpciones(o);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [opcionesFn]);
  const [precioKwh, setPrecioKwh] = useState<string>("");

  const medir = async () => {
    setMidiendo(true);
    try {
      const r = await medirFn({});
      toast.success(
        `Medido: ${r.valor.toFixed(2)} ${r.unidad} (${r.muestras.toLocaleString("es")} hashes reales)`,
      );
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo medir");
    } finally {
      setMidiendo(false);
    }
  };

  const avanzar = async () => {
    try {
      const r = await avanzarFn({});
      toast.success(
        `Enjambre avanzado: ${r.workersActualizados} equipos, ${r.payoutsGenerados} pagos, ${r.errores.length} errores`,
      );
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo avanzar el enjambre");
    }
  };

  const guardarLuz = async () => {
    const valor = Number(precioKwh);
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Pon un precio del kWh válido");
      return;
    }
    try {
      await guardarLuzFn({ data: { precioKwh: valor } });
      toast.success("Precio de la luz guardado");
      setPrecioKwh("");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  const [form, setForm] = useState({ name: "", coin: "BTC", pool: "", rigId: "" });
  const [poolLibre, setPoolLibre] = useState(false);
  const [search, setSearch] = useState("");

  const refresh = () => void qc.invalidateQueries({ queryKey: ["mining_workers"] });

  const list = workers.data ?? [];

  /**
   * Ganancia diaria de un equipo: el valor VIVO que calcula el motor (con los
   * datos de la red y el precio reales). Si aun no se ha medido, se usa el
   * valor guardado en la base.
   */
  const gananciaDe = (workerId: string): number => {
    const vivo = estado.data?.workers.find((w) => w.id === workerId)?.gananciaUsd;
    if (typeof vivo === "number") return vivo;
    const fila = list.find((w) => w.id === workerId);
    return Number(fila?.estimated_daily_earnings ?? 0);
  };
  const mining = list.filter((w) => w.status === "mining");
  // El total vivo que calcula el motor (si no, el guardado en la base).
  const totalEarnings =
    estado.data?.totales.gananciaUsd ??
    list.reduce((s, w) => s + Number(w.estimated_daily_earnings), 0);
  const byUnit = mining.reduce<Record<string, number>>((acc, w) => {
    acc[w.hash_unit] = (acc[w.hash_unit] ?? 0) + Number(w.hash_rate);
    return acc;
  }, {});

  const act = async (action: "start" | "stop" | "restart", workerId?: string) => {
    try {
      await control({ data: { action, ...(workerId ? { workerId } : {}) } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acción fallida");
    }
  };

  const addWorker = async () => {
    if (form.name.trim().length < 2 || !form.pool || !form.rigId) {
      toast.error("Completa nombre, pool e ID de hardware");
      return;
    }
    try {
      await create({ data: { ...form, name: form.name.trim() } });
      toast.success("Worker añadido al enjambre");
      setForm({ name: "", coin: "BTC", pool: "", rigId: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo añadir el worker");
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = term
    ? list.filter((w) =>
        [w.name, w.coin, w.pool, w.rig_id, w.status].join(" ").toLowerCase().includes(term),
      )
    : list;

  const workerColumns: Column<Worker>[] = [
    {
      key: "name",
      label: "Worker",
      value: (w) => w.name,
      render: (w) => (
        <div>
          <p className="font-medium">{w.name}</p>
          <p className="text-xs text-muted-foreground">{w.rig_id}</p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Estado",
      value: (w) => w.status,
      render: (w) => (
        <StatusPill tone={statusTone(w.status)}>
          {w.status === "mining" ? "minando" : w.status === "idle" ? "inactivo" : "offline"}
        </StatusPill>
      ),
    },
    {
      key: "hash",
      label: "Hash rate",
      align: "right",
      value: (w) => Number(w.hash_rate),
      render: (w) => `${Number(w.hash_rate).toFixed(2)} ${w.hash_unit}`,
    },
    { key: "coin", label: "Moneda", value: (w) => w.coin, render: (w) => w.coin },
    { key: "pool", label: "Pool", value: (w) => w.pool, render: (w) => w.pool },
    {
      key: "uptime",
      label: "Uptime",
      align: "right",
      value: (w) => Number(w.uptime_seconds),
      render: (w) => uptime(Number(w.uptime_seconds)),
    },
    {
      key: "earnings",
      label: "Ganancia/día",
      align: "right",
      value: (w) => gananciaDe(w.id),
      render: (w) => {
        const valor = gananciaDe(w.id);
        return (
          <span className={valor >= 0 ? "text-success" : "text-destructive"}>{usdFino(valor)}</span>
        );
      },
    },
    {
      key: "actions",
      label: "Acciones",
      render: (w) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act("start", w.id)}
            aria-label={`Iniciar ${w.name}`}
          >
            <Play className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act("stop", w.id)}
            aria-label={`Detener ${w.name}`}
          >
            <Square className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => act("restart", w.id)}
            aria-label={`Reiniciar ${w.name}`}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const payoutColumns: Column<Payout>[] = [
    {
      key: "paid_at",
      label: "Fecha",
      value: (p) => new Date(p.paid_at).getTime(),
      render: (p) => <span className="tabular text-xs">{dateTime(p.paid_at)}</span>,
    },
    {
      key: "coin",
      label: "Moneda",
      value: (p) => p.coin,
      render: (p) => <span className="font-medium">{p.coin}</span>,
    },
    { key: "pool", label: "Pool", value: (p) => p.pool, render: (p) => p.pool },
    {
      key: "amount",
      label: "Cantidad",
      align: "right",
      value: (p) => Number(p.amount),
      render: (p) => Number(p.amount),
    },
    {
      key: "usd",
      label: "Valor USD",
      align: "right",
      value: (p) => Number(p.usd_value),
      render: (p) => money(Number(p.usd_value), "USD"),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Minería"
        title="Enjambre de minería"
        subtitle="Infraestructura de minería totalmente separada del trading: sin modos demo/real y sin acceso a los fondos de los bots."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => act("start")}>
              <Play className="size-4" /> Iniciar enjambre
            </Button>
            <Button variant="secondary" onClick={() => act("stop")}>
              <Square className="size-4" /> Detener enjambre
            </Button>
          </div>
        }
      />

      {/* Campo de entrenamiento: MEDIR el hash rate real con N hilos. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Dumbbell className="size-4 text-primary" /> Campo de entrenamiento de mineros
            </span>
            <Button
              variant="secondary"
              onClick={() => void entrenarTodos()}
              disabled={entrenando || list.length === 0}
            >
              {entrenando ? "Midiendo…" : "Entrenar a todo el enjambre"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Entrenar aquí es <strong>medir</strong>, no regalar potencia: se mide SHA-256 de verdad
            con workers reales y se guarda cuánto rinde esta máquina con 1, 2, 3 o 4 hilos. Cada
            equipo usa los hilos que le tocan y el motor reparte la capacidad REAL de la máquina (no
            hay hash rate inventado).
          </p>

          {entrenamiento && (
            <div className="space-y-2 rounded-md border border-success/40 bg-success/10 px-3 py-2">
              <p className="text-sm font-medium">
                {entrenamiento.workerNombre}: {entrenamiento.valor.toFixed(2)}{" "}
                {entrenamiento.unidad} con {entrenamiento.hilosElegidos} hilo(s)
              </p>
              <p className="text-xs text-muted-foreground">
                Antes (1 hilo): {(entrenamiento.antesHashPorSegundo / 1e6).toFixed(3)} MH/s · mejora
                x{entrenamiento.mejora.toFixed(2)} · núcleos de la máquina: {entrenamiento.nucleos}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Hilos</th>
                      <th className="py-1 pr-3 font-medium">Hash rate medido</th>
                      <th className="py-1 font-medium">Hashes reales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entrenamiento.curva.map((c) => (
                      <tr key={c.hilos} className="border-b border-border/40">
                        <td className="py-1 pr-3 tabular">{c.hilos}</td>
                        <td className="py-1 pr-3 tabular">
                          {c.valor.toFixed(2)} {c.unidad}
                        </td>
                        <td className="py-1 tabular">{c.hashes.toLocaleString("es")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {entrenamiento.aviso && (
                <p className="text-[11px] text-warning">{entrenamiento.aviso}</p>
              )}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{w.name}</p>
                  <p className="tabular text-[11px] text-muted-foreground">
                    {Number(w.hash_rate).toFixed(2)} {w.hash_unit}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void entrenar(w.id, w.name)}
                  disabled={entrenando}
                >
                  {entrenando ? "…" : "Entrenar"}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lo que de verdad: el hash rate medido en esta maquina y el
          resultado despues de pagar la luz. */}
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Tu equipo, medido de verdad
            <StatusPill tone={estado.data ? "success" : "warning"}>
              {estado.data ? "medido" : "sin medir"}
            </StatusPill>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {estado.isLoading && <p className="text-sm text-muted-foreground">Midiendo…</p>}
          {estado.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="row-subtle rounded-lg px-3 py-2">
                  <p className="kicker">Hash rate de esta máquina</p>
                  <p className="metric-glow mt-1 text-2xl font-semibold">
                    {estado.data.medido.valor.toFixed(2)}
                    <span className="ml-1 text-sm text-muted-foreground">
                      {estado.data.medido.unidad}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Medido con SHA-256 real el {dateTime(estado.data.medido.medidoAt)}
                  </p>
                </div>
                <div className="row-subtle rounded-lg px-3 py-2">
                  <p className="kicker">Ganancias / día</p>
                  <p className="metric-glow mt-1 text-2xl font-semibold text-success">
                    {usdFino(estado.data.totales.gananciaUsd)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Lo que da la red por tu hash rate
                  </p>
                </div>
                <div className="row-subtle rounded-lg px-3 py-2">
                  <p className="kicker">Coste de la luz / día</p>
                  <p className="mt-1 text-2xl font-semibold text-muted-foreground">
                    {money(estado.data.totales.luzUsd, "USD")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    A {estado.data.totales.precioKwh.toFixed(2)} USD el kWh (no se descuenta de la
                    ganancia)
                  </p>
                </div>
                <div className="row-subtle rounded-lg px-3 py-2">
                  <p className="kicker">Equipos</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {estado.data.workers.length}
                    <span className="text-base text-muted-foreground"> / {CAPACIDAD_ENJAMBRE}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Capacidad del enjambre (comparten el mismo CPU)
                  </p>
                </div>
              </div>

              <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
                {estado.data.veredicto}
              </p>

              <p className="text-xs text-muted-foreground">
                Todos los equipos comparten el MISMO CPU: por eso el hash rate se reparte entre los
                que están minando. Con tres equipos no ganas tres veces.
              </p>

              {estado.data.aviso && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {estado.data.aviso}
                </p>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <Button variant="secondary" onClick={() => void medir()} disabled={midiendo}>
                  {midiendo ? "Midiendo…" : "Medir ahora"}
                </Button>
                <Button variant="ghost" onClick={() => void avanzar()}>
                  Avanzar el enjambre
                </Button>
                <div className="w-40 space-y-1">
                  <Label htmlFor="kwh">Precio del kWh (USD)</Label>
                  <Input
                    id="kwh"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={estado.data.totales.precioKwh.toFixed(2)}
                    value={precioKwh}
                    onChange={(e) => setPrecioKwh(e.target.value)}
                  />
                </div>
                <Button variant="ghost" onClick={() => void guardarLuz()} disabled={!precioKwh}>
                  Guardar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>Compara monedas con TU equipo</span>
            <Button variant="secondary" onClick={() => void comparar()} disabled={comparando}>
              {comparando ? "Comparando…" : "Comparar ahora"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Usa el hash rate medido en esta máquina, los datos reales de la red y el precio real
            para ver cuánto da cada moneda y cuánto cuesta la luz. Antes aquí había números de
            ejemplo de una máquina dedicada (120 TH/s): no eran de este equipo.
          </p>
          {comparativa && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Moneda</th>
                      <th className="py-1.5 pr-3 font-medium">Bruto/día</th>
                      <th className="py-1.5 pr-3 font-medium">Luz/día</th>
                      <th className="py-1.5 pr-3 font-medium">Neto/día</th>
                      <th className="py-1.5 font-medium">Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparativa.filas.map((f) => (
                      <tr key={f.coin} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 font-medium">{f.coin}</td>
                        <td className="py-1.5 pr-3 tabular">{usdFino(f.brutoUsd)}</td>
                        <td className="py-1.5 pr-3 tabular text-destructive">
                          {usdFino(f.luzUsd)}
                        </td>
                        <td
                          className={`py-1.5 pr-3 tabular ${
                            f.netoUsd > 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {usdFino(f.netoUsd)}
                        </td>
                        <td className="py-1.5 text-muted-foreground">{f.motivo ?? f.veredicto}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p
                className={`rounded-md border px-3 py-2 text-sm ${
                  comparativa.ningunaSaleACuenta
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-success/40 bg-success/10"
                }`}
              >
                {comparativa.veredicto}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Hash rate total activo
            </CardTitle>
          </CardHeader>
          <CardContent className="tabular space-y-1 text-2xl font-semibold">
            {Object.entries(byUnit).length === 0 && <p>0</p>}
            {Object.entries(byUnit).map(([unit, value]) => (
              <p key={unit}>
                {value.toFixed(2)} <span className="text-base text-muted-foreground">{unit}</span>
              </p>
            ))}
          </CardContent>
        </Card>{" "}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ganancias estimadas / día
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold text-success">
              {money(totalEarnings, "USD")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Workers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold">
              {mining.length}
              <span className="text-base text-muted-foreground">
                {" "}
                / {list.length} minando · tope {CAPACIDAD_ENJAMBRE}
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agregar worker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.length >= CAPACIDAD_ENJAMBRE ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              El enjambre ya tiene {CAPACIDAD_ENJAMBRE} equipos (su tope). Todos comparten el mismo
              CPU: uno mas no daria mas hash rate, solo partiria el mismo. Borra alguno para añadir
              otro.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Moneda objetivo</Label>
              <Input
                list="monedas-mineria"
                value={form.coin}
                placeholder="Elige de la lista"
                onChange={(e) => setForm({ ...form, coin: e.target.value.toUpperCase() })}
              />
              <datalist id="monedas-mineria">
                {(opciones?.minables ?? []).map((m) => (
                  <option key={m.simbolo} value={m.simbolo}>
                    {m.nombre}
                    {m.pools.length ? ` · en ${m.pools.join(", ")}` : ""}
                  </option>
                ))}
                {(opciones?.mercado ?? [])
                  .filter((m) => !m.minable)
                  .map((m) => (
                    <option key={m.simbolo} value={m.simbolo}>
                      {m.nombre} · del mercado, no minable con CPU
                    </option>
                  ))}
              </datalist>
              <p className="text-[10px] text-muted-foreground">
                {opciones
                  ? `${opciones.minables.length} minables con CPU (leidas de los pools en vivo) y ${opciones.mercado.length} del mercado`
                  : "Cargando la lista de monedas..."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Pool</Label>
              {poolLibre ? (
                <Input
                  value={form.pool}
                  placeholder="Nombre del pool"
                  onChange={(e) => setForm({ ...form, pool: e.target.value })}
                />
              ) : (
                <Select
                  value={form.pool}
                  onValueChange={(v) => {
                    if (v === "__otro") {
                      setPoolLibre(true);
                      setForm({ ...form, pool: "" });
                      return;
                    }
                    setPoolLibre(false);
                    setForm({ ...form, pool: v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elige de la lista" />
                  </SelectTrigger>
                  <SelectContent>
                    {(opciones?.pools ?? []).map((pl) => (
                      <SelectItem key={pl.id} value={pl.nombre}>
                        {pl.nombre}
                        {pl.monedas.length ? ` (${pl.monedas.length} monedas)` : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value="__otro">Otro pool (escribirlo)</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <p className="text-[10px] text-muted-foreground">
                {opciones?.pools.find((pl) => pl.nombre === form.pool)?.fuente ?? ""}
                {opciones?.pools.find((pl) => pl.nombre === form.pool)?.url ? (
                  <a
                    className="ml-1 underline underline-offset-2"
                    href={opciones.pools.find((pl) => pl.nombre === form.pool)?.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    abrir web
                  </a>
                ) : null}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>ID hardware / rig</Label>
              <Input
                value={form.rigId}
                onChange={(e) => setForm({ ...form, rigId: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={addWorker}
                disabled={list.length >= CAPACIDAD_ENJAMBRE}
              >
                Añadir ({list.length}/{CAPACIDAD_ENJAMBRE})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((w) => (
          <Card key={w.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{w.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.coin} · {w.pool} · {w.rig_id}
                  </p>
                </div>
                <StatusPill tone={statusTone(w.status)}>
                  {w.status === "mining" ? "minando" : w.status === "idle" ? "inactivo" : "offline"}
                </StatusPill>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground">Hash rate</p>
                  <p className="tabular font-semibold">
                    {Number(w.hash_rate).toFixed(2)} {w.hash_unit}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground">Uptime</p>
                  <p className="tabular font-semibold">{uptime(Number(w.uptime_seconds))}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground">Est. día</p>
                  <p className="tabular font-semibold text-success">
                    {money(Number(w.estimated_daily_earnings), "USD")}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => act("start", w.id)}>
                  <Play className="size-3.5" /> Iniciar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => act("stop", w.id)}>
                  <Square className="size-3.5" /> Detener
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act("restart", w.id)}>
                  <RotateCcw className="size-3.5" /> Reiniciar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertsPanel
        title="Salud y alertas del enjambre"
        category={["mining", "security"]}
        limit={5}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            Workers (vista de tabla)
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar worker, moneda, pool o rig"
              className="max-w-xs"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icono={Pickaxe}
              titulo="No hay equipos de minería"
              detalle="Un equipo de minería calcula hashes con tu CPU a cambio de créditos internos (DMR). Ojo: con una CPU de casa esto da céntimos al día, menos que la electricidad: es un juguete, no un ingreso."
            />
          ) : (
            <SortableTable
              rows={filtered}
              rowKey={(w) => w.id}
              initialSort={{ key: "hash", dir: "desc" }}
              columns={workerColumns}
              empty="Sin workers en el enjambre."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de pagos</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={payouts.data ?? []}
            rowKey={(p) => p.id}
            initialSort={{ key: "paid_at", dir: "desc" }}
            columns={payoutColumns}
            empty="Sin pagos registrados."
          />
        </CardContent>
      </Card>
    </div>
  );
}
