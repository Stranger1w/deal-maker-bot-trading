import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { botPerformanceQuery, hashrateHistoryQuery, marketPricesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const RANGES = [7, 14, 30, 60] as const;
const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(var(--chart-5, 280 70% 60%))",
];

type Row = { recorded_on: string; [k: string]: string | number };

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

function ChartShell({
  title,
  hint,
  days,
  setDays,
  options,
  selected,
  setSelected,
  data,
  series,
  unit,
}: {
  title: string;
  hint: string;
  days: number;
  setDays: (d: number) => void;
  options: string[];
  selected: string[];
  setSelected: (s: string[]) => void;
  data: Row[];
  series: string[];
  unit?: string;
}) {
  const toggle = (name: string) =>
    setSelected(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          {title}
          <span className="rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
            Datos demo / seed
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-xs",
                days === r ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {r}d
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-xs",
                selected.length === 0 || selected.includes(o)
                  ? "border-primary/60 bg-secondary text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="recorded_on" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} width={56} unit={unit ?? ""} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function ComparisonCharts() {
  const hashrate = useQuery(hashrateHistoryQuery);
  const prices = useQuery(marketPricesQuery);
  const perf = useQuery(botPerformanceQuery);

  const [hrDays, setHrDays] = useState(14);
  const [hrSel, setHrSel] = useState<string[]>([]);
  const [pxDays, setPxDays] = useState(30);
  const [pxSel, setPxSel] = useState<string[]>([]);
  const [botDays, setBotDays] = useState(30);
  const [botSel, setBotSel] = useState<string[]>([]);
  const [metric, setMetric] = useState<"pnl" | "return_pct" | "capital">("pnl");

  const hrOptions = useMemo(
    () => [...new Set((hashrate.data ?? []).map((h) => h.worker_name))],
    [hashrate.data],
  );
  const pxOptions = useMemo(() => [...new Set((prices.data ?? []).map((p) => p.symbol))], [prices.data]);
  const botOptions = useMemo(() => [...new Set((perf.data ?? []).map((p) => p.bot_name))], [perf.data]);

  const hrData = useMemo(
    () =>
      pivot(
        hashrate.data ?? [],
        (p: { worker_name: string }) => p.worker_name,
        (p: { hash_rate: number }) => Number(p.hash_rate),
        hrDays,
        hrSel,
      ),
    [hashrate.data, hrDays, hrSel],
  );
  const pxData = useMemo(
    () =>
      pivot(
        prices.data ?? [],
        (p: { symbol: string }) => p.symbol,
        (p: { price: number }) => Number(p.price),
        pxDays,
        pxSel,
      ),
    [prices.data, pxDays, pxSel],
  );
  const botData = useMemo(
    () =>
      pivot(
        perf.data ?? [],
        (p: { bot_name: string }) => p.bot_name,
        (p: Record<string, number>) => Number(p[metric] ?? 0),
        botDays,
        botSel,
      ),
    [perf.data, botDays, botSel, metric],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartShell
        title="Hash rate de minería por día"
        hint="Comparativa diaria del hash rate por worker. Estructura lista para datos reales del pool."
        days={hrDays}
        setDays={setHrDays}
        options={hrOptions}
        selected={hrSel}
        setSelected={setHrSel}
        data={hrData}
        series={hrSel.length ? hrSel : hrOptions}
      />
      <ChartShell
        title="Precios de mercado por día"
        hint="Comparativa de precio de cierre diario por activo. Se sustituirá por el feed de Binance."
        days={pxDays}
        setDays={setPxDays}
        options={pxOptions}
        selected={pxSel}
        setSelected={setPxSel}
        data={pxData}
        series={pxSel.length ? pxSel : pxOptions}
      />
      <div className="xl:col-span-2">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {(["pnl", "return_pct", "capital"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-xs",
                metric === m ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {m === "pnl" ? "P&L" : m === "return_pct" ? "Retorno %" : "Capital"}
            </button>
          ))}
        </div>
        <ChartShell
          title="Progreso de bots en el tiempo"
          hint="Evolución de P&L, retorno o capital por bot. Alimentado por el historial de rendimiento."
          days={botDays}
          setDays={setBotDays}
          options={botOptions}
          selected={botSel}
          setSelected={setBotSel}
          data={botData}
          series={botSel.length ? botSel : botOptions}
          {...(metric === "return_pct" ? { unit: "%" } : {})}
        />
      </div>
    </div>
  );
}
