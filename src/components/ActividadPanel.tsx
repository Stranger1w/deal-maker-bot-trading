import { useState } from "react";
import { Bot, Gauge, Pickaxe, RefreshCw, ScrollText, ShieldAlert, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { EmptyState } from "@/components/EmptyState";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { TabsPestanas } from "@/components/TabsPestanas";
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

/** Icono segun el tipo de movimiento, para escanear la lista de un vistazo. */
function IconoMovimiento({ accion }: { accion: string }) {
  const clase = "size-3.5";
  if (accion.startsWith("bot.")) return <Bot className={clase} />;
  if (accion.startsWith("engine.")) return <Gauge className={clase} />;
  if (accion.startsWith("security.")) return <ShieldAlert className={clase} />;
  if (accion.startsWith("capital.") || accion.startsWith("funds."))
    return <Wallet className={clase} />;
  if (accion.startsWith("asset.")) return <RefreshCw className={clase} />;
  return <ScrollText className={clase} />;
}

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
          <TabsPestanas
            items={PESTANAS.map((p) => ({ id: p.id, etiqueta: p.etiqueta, icono: p.icono }))}
            valor={pestana}
            onChange={(v) => setPestana(v as Pestana)}
            compacta
          />
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
                <li
                  key={bot.id}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-secondary/25"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        bot.status === "running" ? "bg-success" : "bg-muted-foreground/40",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{bot.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {bot.pair} · {bot.mode.toUpperCase()}
                      </p>
                    </div>
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
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-secondary/25"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        w.status === "mining" ? "bg-success" : "bg-muted-foreground/40",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{w.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {w.coin} · {w.pool}
                      </p>
                    </div>
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
                <li
                  key={m.id}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-secondary/25"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary/60 text-muted-foreground">
                    <IconoMovimiento accion={m.action} />
                  </span>
                  <span className="tabular w-28 shrink-0 text-[11px] text-muted-foreground">
                    {dateTime(m.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.action}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
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
