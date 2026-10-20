import { useState } from "react";
import { Bot, Pickaxe, ScrollText } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { EmptyState } from "@/components/EmptyState";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Los tres listados del panel (mis bots, equipos de mineria y ultimos
 * movimientos) en UN solo sitio, arriba, con pestanas.
 *
 * Antes estaban al final de la pagina, en tres tarjetas separadas: para ver
 * cualquiera de ellos habia que bajar hasta el final. Ahora estan juntos, en
 * la primera pantalla, y se cambian con un clic.
 */

export type BotResumen = {
  id: string;
  name: string;
  pair: string;
  mode: string;
  status: string;
  pnl: number | string;
};

export type WorkerResumen = {
  id: string;
  name: string;
  coin: string;
  pool: string;
  status: string;
  hash_rate: number | string;
  hash_unit: string;
};

export type MovimientoResumen = {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
};

const PESTANAS = [
  { id: "bots", etiqueta: "Mis bots", icono: Bot },
  { id: "mineria", etiqueta: "Equipos de minería", icono: Pickaxe },
  { id: "movimientos", etiqueta: "Últimos movimientos", icono: ScrollText },
] as const;

type Pestana = (typeof PESTANAS)[number]["id"];

export function ActividadPanel({
  bots,
  workers,
  movimientos,
  limite = 6,
}: {
  bots: BotResumen[];
  workers: WorkerResumen[];
  movimientos: MovimientoResumen[];
  limite?: number;
}) {
  const [pestana, setPestana] = useState<Pestana>("bots");

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Actividad</CardTitle>
          <div className="inline-flex rounded-lg border border-border/80 bg-secondary/40 p-0.5">
            {PESTANAS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPestana(p.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  pestana === p.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <p.icono className="size-3.5 opacity-80" />
                {p.etiqueta}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {pestana === "bots" &&
          (bots.length === 0 ? (
            <EmptyState
              icono={Bot}
              titulo="Todavía no hay bots"
              detalle="Crea el primero en «Mis bots»: un par, un capital y los indicadores que decidirán comprar y vender."
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {bots.slice(0, limite).map((bot) => (
                <li key={bot.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{bot.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {bot.pair} · {bot.mode.toUpperCase()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cn(
                        "metric text-sm",
                        Number(bot.pnl) >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {money(Number(bot.pnl))}
                    </span>
                    <StatusPill tone={statusTone(bot.status)}>{bot.status}</StatusPill>
                  </div>
                </li>
              ))}
            </ul>
          ))}

        {pestana === "mineria" &&
          (workers.length === 0 ? (
            <EmptyState
              icono={Pickaxe}
              titulo="No hay equipos de minería"
              detalle="Un equipo calcula hashes con tu CPU a cambio de créditos internos (DMR). Ojo: con una CPU de casa esto da céntimos al día, menos que la electricidad."
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {workers.slice(0, limite).map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{w.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.coin} · {w.pool}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="metric text-sm">
                      {Number(w.hash_rate).toFixed(2)} {w.hash_unit}
                    </span>
                    <StatusPill tone={statusTone(w.status)}>{w.status}</StatusPill>
                  </div>
                </li>
              ))}
            </ul>
          ))}

        {pestana === "movimientos" &&
          (movimientos.length === 0 ? (
            <EmptyState
              icono={ScrollText}
              titulo="Todavía no hay movimientos"
              detalle="Aquí quedará registrado todo lo que hace el motor: entradas, salidas, límites alcanzados y decisiones de auditoría."
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {movimientos.slice(0, limite).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="tabular text-xs text-muted-foreground">
                    {dateTime(m.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.action}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m.entity_id ?? m.entity}
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}
