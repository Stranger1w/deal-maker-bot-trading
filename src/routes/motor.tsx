import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { SortableTable, type Column } from "@/components/SortableTable";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EngineSession } from "@/lib/engine-sessions.server";
import { detenerMotor, iniciarMotor, listarSesionesMotor } from "@/lib/engine.functions";
import { dateTime, money } from "@/lib/format";
import { automationQuery } from "@/lib/queries";

export const Route = createFileRoute("/motor")({
  head: () => ({
    meta: [
      { title: "Motor — Deal Maker" },
      {
        name: "description",
        content:
          "Sesiones del motor con Temporizador o 24/7: iniciar, detener, cuenta regresiva, último tick e historial.",
      },
      { property: "og:title", content: "Motor — Deal Maker" },
    ],
  }),
  component: MotorPage,
});

const PRESETS = [
  { minutos: 15, etiqueta: "15 min" },
  { minutos: 60, etiqueta: "1 h" },
  { minutos: 360, etiqueta: "6 h" },
] as const;

const MOTIVOS: Record<string, string> = {
  timer: "temporizador",
  kill_switch: "kill switch",
  manual: "manual",
  error: "error",
};

/** hh:mm:ss (o mm:ss si la sesión no llega a una hora). */
function cuentaAtras(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dd = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dd(m)}:${dd(s)}` : `${dd(m)}:${dd(s)}`;
}

/** "hace X min" / "hace X s" para el indicador de último tick. */
function haceTexto(segundos: number): string {
  return segundos < 60 ? `hace ${segundos} s` : `hace ${Math.floor(segundos / 60)} min`;
}

const SESION_COLUMNAS: Column<EngineSession>[] = [
  {
    key: "session_started_at",
    label: "Inicio",
    value: (x) => x.session_started_at,
    render: (x) => <span className="tabular text-xs">{dateTime(x.session_started_at)}</span>,
  },
  {
    key: "mode",
    label: "Modo",
    value: (x) => x.mode,
    render: (x) => (x.mode === "timer" ? "Temporizador" : "24/7"),
  },
  {
    key: "status",
    label: "Estado",
    value: (x) => x.status,
    render: (x) => (
      <StatusPill
        tone={x.status === "active" ? "success" : x.status === "closing" ? "warning" : "neutral"}
      >
        {x.status}
      </StatusPill>
    ),
  },
  {
    key: "session_stopped_at",
    label: "Fin",
    value: (x) => x.session_stopped_at ?? x.session_ends_at ?? "",
    render: (x) => (
      <span className="tabular text-xs">
        {x.session_stopped_at
          ? dateTime(x.session_stopped_at)
          : x.session_ends_at
            ? `programado ${dateTime(x.session_ends_at)}`
            : "—"}
      </span>
    ),
  },
  {
    key: "close_reason",
    label: "Motivo",
    value: (x) => x.close_reason ?? "",
    render: (x) => (x.close_reason ? (MOTIVOS[x.close_reason] ?? x.close_reason) : "—"),
  },
  {
    key: "pnl_total",
    label: "P&L",
    align: "right",
    value: (x) => Number(x.pnl_total),
    render: (x) => (
      <span className={Number(x.pnl_total) >= 0 ? "text-success" : "text-destructive"}>
        {money(Number(x.pnl_total))}
      </span>
    ),
  },
  {
    key: "runs_count",
    label: "Ticks",
    align: "right",
    value: (x) => x.runs_count,
    render: (x) => x.runs_count,
  },
  {
    key: "orders_count",
    label: "Órdenes",
    align: "right",
    value: (x) => x.orders_count,
    render: (x) => x.orders_count,
  },
];

function MotorPage() {
  const qc = useQueryClient();
  const settings = useQuery(automationQuery);
  const s = settings.data;

  // La tabla engine_sessions solo es legible por service_role: se lee vía
  // server fn (nunca desde el navegador) y se refresca mientras la pestaña
  // está abierta para que la cuenta regresiva y el estado sigan vivos.
  const listarFn = useServerFn(listarSesionesMotor);
  const sesiones = useQuery({
    queryKey: ["engine_sessions"],
    refetchInterval: 15000,
    queryFn: (): Promise<EngineSession[]> => listarFn({ data: { limit: 50 } }),
  });

  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [modo, setModo] = useState<"timer" | "24x7">("timer");
  const [preset, setPreset] = useState<number | null>(15);
  const [libre, setLibre] = useState("");

  const iniciarFn = useServerFn(iniciarMotor);
  const detenerFn = useServerFn(detenerMotor);
  const invalidate = () => void qc.invalidateQueries();

  const iniciar = useMutation({
    mutationFn: async () => {
      let durationMinutes: number | undefined;
      if (modo === "timer") {
        const crudo = libre.trim() !== "" ? Number(libre) : preset;
        if (typeof crudo !== "number" || !Number.isInteger(crudo) || crudo < 1) {
          throw new Error("Duración no válida: usa 15 min, 1 h, 6 h o escribe minutos enteros.");
        }
        durationMinutes = crudo;
      }
      return iniciarFn({
        data: { mode: modo, ...(durationMinutes !== undefined ? { durationMinutes } : {}) },
      });
    },
    onSuccess: (sesion) => {
      toast.success(
        sesion.mode === "timer" && sesion.session_ends_at
          ? `Sesión iniciada. Fin del temporizador: ${dateTime(sesion.session_ends_at)}.`
          : "Sesión 24/7 iniciada.",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const detener = useMutation({
    mutationFn: () => detenerFn({}),
    onSuccess: (r) => {
      toast.success(
        r.cierrePendiente
          ? `Motor apagado. La sesión se cerrará cuando no queden posiciones abiertas (${r.posicionesAbiertas} abiertas).`
          : r.sesion
            ? "Motor apagado y sesión cerrada."
            : "Motor apagado.",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activa =
    (sesiones.data ?? []).find((x) => x.status === "active" || x.status === "closing") ?? null;
  const engineOn = !!s?.engine_enabled;
  const kill = !!s?.kill_switch;
  const intervalo = Number(s?.tick_interval_seconds ?? 60);
  const umbralSeg = intervalo * 2;
  const edadSeg = s?.last_heartbeat_at
    ? Math.max(0, Math.round((ahora - Date.parse(s.last_heartbeat_at)) / 1000))
    : null;
  // Alerta 24/7: más de 2 intervalos sin tick = el motor no está corriendo.
  const sinTicks = engineOn && (edadSeg === null || edadSeg > umbralSeg);

  const restanteMs =
    activa?.mode === "timer" && activa.session_ends_at
      ? Date.parse(activa.session_ends_at) - ahora
      : null;

  const minutosCrudos = libre.trim() !== "" ? Number(libre) : preset;
  const duracionValida =
    modo === "24x7" ||
    (typeof minutosCrudos === "number" && Number.isInteger(minutosCrudos) && minutosCrudos >= 1);

  const estado = kill
    ? { texto: "kill switch", tone: "danger" as const }
    : activa?.status === "active"
      ? { texto: "sesión activa", tone: "success" as const }
      : activa?.status === "closing"
        ? { texto: "deteniendo", tone: "warning" as const }
        : engineOn
          ? { texto: "sin sesión", tone: "warning" as const }
          : { texto: "detenido", tone: "neutral" as const };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Motor"
        subtitle="Sesiones con Temporizador o 24/7: el motor solo opera dentro de una sesión iniciada desde esta pestaña."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Estado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatusPill tone={estado.tone}>{estado.texto}</StatusPill>
            <p className="text-xs text-muted-foreground">
              Motor {engineOn ? "encendido" : "apagado"}
              {activa ? ` · sesión ${activa.status === "closing" ? "en cierre" : "activa"}` : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {activa?.mode === "timer" ? "Tiempo restante" : "Modo"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {activa?.mode === "timer" && activa.session_ends_at ? (
              restanteMs !== null && restanteMs > 0 ? (
                <p className="tabular text-3xl font-semibold">{cuentaAtras(restanteMs)}</p>
              ) : (
                <p className="text-2xl font-semibold text-warning">temporizador vencido</p>
              )
            ) : activa ? (
              <p className="text-2xl font-semibold">24/7</p>
            ) : (
              <p className="text-2xl font-semibold text-muted-foreground">—</p>
            )}
            <p className="text-xs text-muted-foreground">
              {activa?.mode === "timer" && activa.session_ends_at
                ? `Fin programado: ${dateTime(activa.session_ends_at)}`
                : activa
                  ? "Sin límite de duración"
                  : "Sin sesión (no se abren posiciones)"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Último tick</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p
              className={`text-2xl font-semibold ${sinTicks ? "text-destructive" : "text-success"}`}
            >
              {edadSeg === null ? "sin datos" : haceTexto(edadSeg)}
            </p>
            <p className="text-xs text-muted-foreground">
              Cada {intervalo}s · alerta si pasan {umbralSeg}s sin tick
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Kill Switch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatusPill tone={kill ? "danger" : "neutral"}>
              {kill ? "activo" : "desactivado"}
            </StatusPill>
            <p className="text-xs text-muted-foreground">
              Tiene prioridad: cierra la sesión con motivo «kill switch».
            </p>
          </CardContent>
        </Card>
      </div>

      {sinTicks && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Sin ticks {edadSeg === null ? "" : haceTexto(edadSeg)}: han pasado más de 2 intervalos (
          {umbralSeg}s) sin heartbeat. El motor 24/7 no está corriendo aunque esta app esté abierta
          — revisa el cron <span className="font-mono">POST /api/public/automation-tick</span>.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Control de la sesión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={modo} onValueChange={(v) => setModo(v as "timer" | "24x7")}>
            <TabsList>
              <TabsTrigger value="timer">Temporizador</TabsTrigger>
              <TabsTrigger value="24x7">24/7</TabsTrigger>
            </TabsList>
          </Tabs>

          {modo === "timer" && (
            <div className="space-y-2">
              <Label>Duración</Label>
              <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p.minutos}
                    type="button"
                    variant={preset === p.minutos && libre.trim() === "" ? "default" : "outline"}
                    onClick={() => {
                      setPreset(p.minutos);
                      setLibre("");
                    }}
                  >
                    {p.etiqueta}
                  </Button>
                ))}
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="minutos"
                  aria-label="Duración libre en minutos"
                  className="w-28"
                  value={libre}
                  onChange={(e) => setLibre(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">duración libre (minutos)</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => iniciar.mutate()}
              disabled={
                kill || iniciar.isPending || !duracionValida || activa?.status === "closing"
              }
            >
              {iniciar.isPending ? "Iniciando…" : "Iniciar"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => detener.mutate()}
              disabled={detener.isPending || (!engineOn && !activa)}
            >
              {detener.isPending ? "Deteniendo…" : "Detener"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Iniciar y Detener son los únicos controles que encienden o apagan el motor
            (engine_enabled). Al vencer el Temporizador la sesión deja de abrir posiciones y se
            cierra con motivo «temporizador» cuando no queden abiertas; Detener hace lo mismo con
            motivo «manual»; el Kill Switch siempre tiene prioridad («kill switch»).
          </p>

          {kill && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              El Kill Switch está activo: el motor no puede iniciar sesiones hasta que lo
              desactives.
            </p>
          )}
          {engineOn && !activa && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              El motor sigue encendido sin sesión vigente (la sesión ya se cerró). Pulsa Detener
              para apagarlo o Iniciar para comenzar otra.
            </p>
          )}
          {activa?.status === "closing" && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Sesión en cierre: sin posiciones nuevas; el tick sigue gestionando las abiertas con
              TP/SL hasta que se pongan planas.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de sesiones</CardTitle>
        </CardHeader>
        <CardContent>
          {sesiones.isError && (
            <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {(sesiones.error as Error).message}
            </p>
          )}
          <SortableTable
            rows={sesiones.data ?? []}
            columns={SESION_COLUMNAS}
            rowKey={(x) => x.id}
            initialSort={{ key: "session_started_at", dir: "desc" }}
            empty="Todavía no hay sesiones: pulsa Iniciar para crear la primera."
          />
        </CardContent>
      </Card>
    </div>
  );
}
