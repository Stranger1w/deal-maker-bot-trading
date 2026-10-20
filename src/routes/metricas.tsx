import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Explicar, GLOSARIO } from "@/components/Explicar";
import { SortableTable, type Column } from "@/components/SortableTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { informeMetricasMotor } from "@/lib/metricas.functions";
import { money, pct } from "@/lib/format";
import type { ResumenGrupo } from "@/lib/metricas";

export const Route = createFileRoute("/metricas")({
  head: () => ({
    meta: [
      { title: "Métricas — Deal Maker" },
      {
        name: "description",
        content:
          "Panel honesto: P&L real por bot, indicador, par y hora, con avisos sobre lo que las cifras no demuestran.",
      },
    ],
  }),
  component: MetricasPage,
});

const COLUMNAS: Column<ResumenGrupo>[] = [
  {
    key: "clave",
    label: "Grupo",
    value: (x) => x.clave,
    render: (x) => (
      <span className="flex items-center gap-2">
        {x.clave}
        {x.sinSignificado && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            pocas operaciones
          </span>
        )}
      </span>
    ),
  },
  {
    key: "operaciones",
    label: "Operaciones",
    value: (x) => x.operaciones,
    render: (x) => x.operaciones,
  },
  {
    key: "pnlNeto",
    label: "P&L neto",
    value: (x) => x.pnlNeto,
    render: (x) => (
      <span className={x.pnlNeto >= 0 ? "text-positive" : "text-destructive"}>
        {money(x.pnlNeto)}
      </span>
    ),
  },
  {
    key: "winRatePct",
    label: "Win rate",
    value: (x) => x.winRatePct,
    render: (x) => (
      <span className="inline-flex items-center gap-1">
        {pct(x.winRatePct)}
        <Explicar termino="win_rate" />
      </span>
    ),
  },
  {
    key: "profitFactor",
    label: "Profit factor",
    value: (x) => x.profitFactor,
    render: (x) => (
      <span className="inline-flex items-center gap-1">
        {x.profitFactor.toFixed(2)}
        <Explicar termino="profit_factor" />
      </span>
    ),
  },
  {
    key: "mejorOperacion",
    label: "Mejor",
    value: (x) => x.mejorOperacion,
    render: (x) => money(x.mejorOperacion),
  },
  {
    key: "peorOperacion",
    label: "Peor",
    value: (x) => x.peorOperacion,
    render: (x) => money(x.peorOperacion),
  },
];

function MetricasPage() {
  const informe = useServerFn(informeMetricasMotor);
  const datos = useQuery({
    queryKey: ["metricas_motor"],
    queryFn: () => informe({}),
    refetchInterval: 60000,
  });

  const d = datos.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Análisis"
        title="Métricas honestas"
        subtitle="Lo que el motor ha hecho de verdad: P&L real por bot, por indicador, por par y por hora. Las cifras no demuestran rentabilidad; con pocas operaciones son ruido."
      />

      {datos.isLoading && <p className="text-sm text-muted-foreground">Calculando…</p>}

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Operaciones cerradas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="metric-glow text-2xl font-semibold">{d.totales.operaciones}</p>
                <p className="text-xs text-muted-foreground">
                  {d.totales.conSenal} % con la señal registrada
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">P&L neto</CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={`metric-glow text-2xl font-semibold ${d.totales.pnlNeto >= 0 ? "text-positive" : "text-destructive"}`}
                >
                  {money(d.totales.pnlNeto)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Win rate {d.totales.winRatePct.toFixed(1)} % · PF{" "}
                  {d.totales.profitFactor.toFixed(2)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1 text-sm text-muted-foreground">
                  Drawdown máximo
                  <Explicar termino="drawdown" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="metric-glow text-2xl font-semibold">
                  {d.totales.maxDrawdownPct.toFixed(2)} %
                </p>
                <p className="text-xs text-muted-foreground">Sobre la curva de P&L acumulado</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Costes estimados</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="metric-glow text-2xl font-semibold">
                  {money(d.totales.costeEstimado)}
                </p>
                <p className="text-xs text-muted-foreground">Comisiones + slippage</p>
              </CardContent>
            </Card>
          </div>

          {d.avisos.length > 0 && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="size-4" /> Lo que estas cifras NO demuestran
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {d.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {d.sinVentaja.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-destructive">
                  Bots con muchas operaciones y sin ventaja
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {d.sinVentaja.map((b) => (
                    <li key={b.botId}>
                      <strong>{b.botName}</strong>: {b.operaciones} operaciones · P&L{" "}
                      {money(b.pnlNeto)} · profit factor {b.profitFactor.toFixed(2)}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Por bot</CardTitle>
            </CardHeader>
            <CardContent>
              <SortableTable
                rows={d.porBot}
                columns={COLUMNAS}
                rowKey={(x) => x.clave}
                initialSort={{ key: "pnlNeto", dir: "desc" }}
                empty="Sin operaciones todavía."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por indicador</CardTitle>
            </CardHeader>
            <CardContent>
              <SortableTable
                rows={d.porIndicador}
                columns={COLUMNAS}
                rowKey={(x) => x.clave}
                initialSort={{ key: "pnlNeto", dir: "desc" }}
                empty="Ninguna operación tiene la señal registrada todavía."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por par</CardTitle>
            </CardHeader>
            <CardContent>
              <SortableTable
                rows={d.porPar}
                columns={COLUMNAS}
                rowKey={(x) => x.clave}
                initialSort={{ key: "pnlNeto", dir: "desc" }}
                empty="Sin operaciones."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por hora del día (UTC)</CardTitle>
            </CardHeader>
            <CardContent>
              <SortableTable
                rows={d.porHora}
                columns={COLUMNAS}
                rowKey={(x) => x.clave}
                initialSort={{ key: "pnlNeto", dir: "desc" }}
                empty="Sin operaciones."
              />
            </CardContent>
          </Card>

          {/* Glosario: las palabras que aparecen arriba, explicadas. */}
          <Card>
            <CardHeader>
              <CardTitle>Qué significa cada palabra</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {Object.entries(GLOSARIO).map(([termino, definicion]) => (
                <div key={termino} className="row-subtle rounded-lg px-3 py-2">
                  <p className="text-xs font-medium capitalize">{termino.replace(/_/g, " ")}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {definicion}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
