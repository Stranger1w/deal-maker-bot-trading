import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Play, RotateCcw, Square } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createWorker, setWorkerStatus } from "@/lib/dealmaker.functions";
import { dateTime, money, uptime } from "@/lib/format";
import { payoutsQuery, workersQuery } from "@/lib/queries";

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

function MiningPage() {
  const qc = useQueryClient();
  const workers = useQuery(workersQuery);
  const payouts = useQuery(payoutsQuery);
  const control = useServerFn(setWorkerStatus);
  const create = useServerFn(createWorker);

  const [form, setForm] = useState({ name: "", coin: "BTC", pool: "", rigId: "" });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["mining_workers"] });

  const list = workers.data ?? [];
  const mining = list.filter((w) => w.status === "mining");
  const totalEarnings = list.reduce((s, w) => s + Number(w.estimated_daily_earnings), 0);
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
    if (form.name.trim().length < 2 || !form.pool || !form.rigId)
      {
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

  return (
    <div className="space-y-8">
      <PageHeader
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
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ganancias estimadas / día
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold text-success">{money(totalEarnings, "USD")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Workers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold">
              {mining.length}
              <span className="text-base text-muted-foreground"> / {list.length} minando</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agregar worker</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Moneda objetivo</Label>
            <Input value={form.coin} onChange={(e) => setForm({ ...form, coin: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Pool</Label>
            <Input value={form.pool} onChange={(e) => setForm({ ...form, pool: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>ID hardware / rig</Label>
            <Input value={form.rigId} onChange={(e) => setForm({ ...form, rigId: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={addWorker}>
              Añadir
            </Button>
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

      <Card>
        <CardHeader>
          <CardTitle>Historial de pagos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead>Pool</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Valor USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(payouts.data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="tabular text-xs">{dateTime(p.paid_at)}</TableCell>
                  <TableCell className="font-medium">{p.coin}</TableCell>
                  <TableCell>{p.pool}</TableCell>
                  <TableCell className="tabular text-right">{Number(p.amount)}</TableCell>
                  <TableCell className="tabular text-right">
                    {money(Number(p.usd_value), "USD")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
