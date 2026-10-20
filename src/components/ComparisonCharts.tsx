import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TabsPestanas } from "@/components/TabsPestanas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { botPerformanceQuery, hashrateHistoryQuery, marketPricesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Una sola grafica con botones dentro.
 *
 * Antes habia tres graficas apiladas (hash rate, precios y progreso de los
 * bots) y habia que bajar mucho para verlas. Ahora hay un unico panel con un
 * selector de que se mira, el rango y las series: todo se cambia desde ahi,
 * sin salir de la grafica.
 *
 * Ademas, las dos primeras series eran datos de ejemplo (seed): por eso el
 * aviso, y por eso la de bots es la que se abre por defecto.
 */

const RANGES = [7, 14, 30, 60] as const;

const VISTAS = [
  { id: "bots", etiqueta: "Bots", hint: "Evolución de los bots en el tiempo" },
  { id: "precios", etiqueta: "Precios", hint: "Precio de cierre diario por activo" },
  { id: "hash", etiqueta: "Hash rate", hint: "Hash rate diario por equipo" },
] as const;

type Vista = (typeof VISTAS)[number]["id"];

const METRICAS = [
  { id: "pnl", etiqueta: "P&L", unit: "" },
  { id: "return_pct", etiqueta: "Retorno %", unit: "%" },
  { id: "capital", etiqueta: "Capital", unit: "" },
] as const;

type Metrica = (typeof METRICAS)[number]["id"];

/**
 * Colores de las series de datos: NARANJA y MENTA.
 *
 * No se usan los verdes y rojos de la app: en una linea de datos, un verde
 * significa "gana" y un rojo "pierde", y aqui solo son "esta serie". Con
 * dos series (la comparativa) el contraste es naranja contra menta: uno
 * calido, otro frio, y los dos se leen sobre el fondo oscuro.
 */
const COLORES = [
  "hsl(var(--data-1))",
  "hsl(var(--data-2))",
  "hsl(var(--data-3))",
  "hsl(var(--data-4))",
];

type Row = { recorded_on: string; [k: string]: string | number };

/** Agrupa los puntos por día y suma los valores de las series elegidas. */
function pivot(
  points: { recorded_on: string }[],
  nameOf: (p: never) => string,
  valueOf: (p: never) => number,
  days: number,
  selected: string[],
): Row[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const map = new Map<string, Row>();
  for (const p of points) {
    if (new Date(p.recorded_on) < cutoff) continue;
    const name = nameOf(p as never);
    if (selected.length && !selected.includes(name)) continue;
    const row = map.get(p.recorded_on) ?? ({ recorded_on: p.recorded_on.slice(5) } as Row);
    row[name] = Number(((Number(row[name] ?? 0) as number) + valueOf(p as never)).toFixed(2));
    map.set(p.recorded_on, row);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

/** Tooltip con forma de tarjeta. */
function TooltipCard({
  active,
  label,
  payload,
  sufijo,
}: {
  active?: boolean;
  label?: string;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  sufijo?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="metric ml-auto font-medium text-foreground">
              {Number(p.value ?? 0).toFixed(2)}
              {sufijo}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComparisonCharts() {
  const hashrate = useQuery(hashrateHistoryQuery);
  const prices = useQuery(marketPricesQuery);
  const perf = useQuery(botPerformanceQuery);

  const [vista, setVista] = useState<Vista>("bots");
  const [metrica, setMetrica] = useState<Metrica>("pnl");
  const [dias, setDias] = useState(30);
  const [sel, setSel] = useState<string[]>([]);

  const esDemo = vista !== "bots";

  const opciones = useMemo(() => {
    if (vista === "bots") return [...new Set((perf.data ?? []).map((p) => p.bot_name as string))];
    if (vista === "precios")
      return [...new Set((prices.data ?? []).map((p) => p.symbol as string))];
    return [...new Set((hashrate.data ?? []).map((h) => h.worker_name as string))];
  }, [vista, perf.data, prices.data, hashrate.data]);

  const datos = useMemo(() => {
    if (vista === "bots") {
      return pivot(
        perf.data ?? [],
        (p: { bot_name: string }) => p.bot_name,
        (p: Record<string, number>) => Number(p[metrica] ?? 0),
        dias,
        sel,
      );
    }
    if (vista === "precios") {
      return pivot(
        prices.data ?? [],
        (p: { symbol: string }) => p.symbol,
        (p: { price: number }) => Number(p.price),
        dias,
        sel,
      );
    }
    return pivot(
      hashrate.data ?? [],
      (p: { worker_name: string }) => p.worker_name,
      (p: { hash_rate: number }) => Number(p.hash_rate),
      dias,
      sel,
    );
  }, [vista, perf.data, prices.data, hashrate.data, metrica, dias, sel]);

  const series = sel.length ? sel : opciones;
  const vistaActual = VISTAS.find((v) => v.id === vista)!;

  const alternar = (nombre: string) =>
    setSel((prev) =>
      prev.includes(nombre) ? prev.filter((s) => s !== nombre) : [...prev, nombre],
    );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Evolución en el tiempo</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {vistaActual.hint}
              {esDemo ? " · datos de ejemplo, no reales" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsPestanas
              items={VISTAS.map((v) => ({ id: v.id, etiqueta: v.etiqueta }))}
              valor={vista}
              onChange={(v) => {
                setVista(v as Vista);
                setSel([]);
              }}
            />
            {vista === "bots" && (
              <TabsPestanas
                items={METRICAS.map((m) => ({ id: m.id, etiqueta: m.etiqueta }))}
                valor={metrica}
                onChange={(v) => setMetrica(v as Metrica)}
                compacta
              />
            )}
            <TabsPestanas
              items={RANGES.map((r) => ({ id: String(r), etiqueta: `${r}d` }))}
              valor={String(dias)}
              onChange={(v) => setDias(Number(v))}
              compacta
            />
          </div>
        </div>

        {/* Series: se eligen aquí mismo, sin salir de la gráfica. */}
        {opciones.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {opciones.map((o, i) => {
              const activo = sel.length === 0 || sel.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => alternar(o)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    activo
                      ? "border-border bg-secondary/50 text-foreground"
                      : "border-transparent text-muted-foreground/60 hover:text-muted-foreground",
                  )}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: COLORES[i % COLORES.length] }}
                  />
                  {o}
                </button>
              );
            })}
          </div>
        )}
      </CardHeader>

      <CardContent className="h-72 pt-0">
        {datos.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Todavía no hay datos que enseñar. En cuanto el motor registre operaciones, aquí verás la
            curva.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s} id={`grad-${vista}-${s}`} x1="0" y1="0" x2="0" y2="1">
                    {/* La estela: el MISMO color de la linea, difuminandose hacia abajo. */}
                    <stop offset="0%" stopColor={COLORES[i % COLORES.length]} stopOpacity={0.5} />
                    <stop offset="55%" stopColor={COLORES[i % COLORES.length]} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={COLORES[i % COLORES.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
                {series.map((s, i) => (
                  <linearGradient
                    key={`halo-${s}`}
                    id={`halo-${vista}-${s}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={COLORES[i % COLORES.length]} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={COLORES[i % COLORES.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {/* Todo el armazon de la grafica es neutro: el unico color son los datos. */}
              <CartesianGrid
                stroke="hsl(var(--border))"
                strokeDasharray="2 6"
                vertical={false}
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="recorded_on"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                width={58}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                unit={metrica === "return_pct" && vista === "bots" ? "%" : ""}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                content={
                  <TooltipCard sufijo={metrica === "return_pct" && vista === "bots" ? "%" : ""} />
                }
              />
              {series.map((s, i) => (
                <Area
                  key={`halo-${s}`}
                  type="monotone"
                  dataKey={s}
                  stroke="none"
                  strokeWidth={0}
                  fill={`url(#halo-${vista}-${s})`}
                  fillOpacity={1}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              {series.map((s, i) => (
                <Area
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={COLORES[i % COLORES.length]}
                  strokeWidth={2}
                  fill={`url(#grad-${vista}-${s})`}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
                  connectNulls
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
