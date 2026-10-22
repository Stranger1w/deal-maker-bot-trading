import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDICADORES } from "@/lib/indicators";
import type { EngineSession } from "@/lib/engine-sessions.server";
import {
  detenerMotor,
  guardarAjustesRiesgoMotor,
  guardarConfigMotor,
  leerAjustesRiesgoMotor,
  iniciarMotor,
  leerConfigMotor,
  listarSesionesMotor,
} from "@/lib/engine.functions";
import { listarCiclosMotor } from "@/lib/motor.functions";
import { MOTIVOS as MOTIVOS_MOTOR } from "@/lib/motor-decisiones";
import { ESTRATEGIAS } from "@/lib/strategies";
import { dateTime, money } from "@/lib/format";
import { automationQuery } from "@/lib/queries";

export const Route = createFileRoute("/motor")({
  head: () => ({
    meta: [
      { title: "Motor — Deal Maker" },
      {
        name: "description",
        content:
          "Sesiones del motor con temporizador: iniciar, detener, cuenta regresiva y último tick. El motor avanza con el tick local (cada minuto, mientras el PC esté encendido); la sesión con temporizador es lo que le permite ABRIR posiciones nuevas.",
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

  // Diario del motor: los ultimos ciclos y que hizo cada bot en ellos.
  const listarCiclos = useServerFn(listarCiclosMotor);
  const ciclos = useQuery({
    queryKey: ["engine_cycles"],
    queryFn: () => listarCiclos({ data: { limit: 20 } }),
    refetchInterval: 20000,
  });

  // La sesión más reciente que cerró con posiciones de bots ya sin gestionar
  // (snapshot guardado en cerrarSesion): si existe, se muestra la alerta.
  const conSinGestion = (sesiones.data ?? []).find((x) => (x.unmanaged_positions?.length ?? 0) > 0);

  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [preset, setPreset] = useState<number | null>(15);
  const [libre, setLibre] = useState("");

  const iniciarFn = useServerFn(iniciarMotor);
  const detenerFn = useServerFn(detenerMotor);
  const invalidate = () => void qc.invalidateQueries();

  const iniciar = useMutation({
    mutationFn: async () => {
      const crudo = libre.trim() !== "" ? Number(libre) : preset;
      if (typeof crudo !== "number" || !Number.isInteger(crudo) || crudo < 1) {
        throw new Error("Duración no válida: usa 15 min, 1 h, 6 h o escribe minutos enteros.");
      }
      return iniciarFn({ data: { mode: "timer", durationMinutes: crudo } });
    },
    onSuccess: (sesion) => {
      toast.success(
        sesion.session_ends_at
          ? `Sesión iniciada. Fin del temporizador: ${dateTime(sesion.session_ends_at)}.`
          : "Sesión iniciada.",
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

  // ── Configuración del motor (indicadores, estrategia, horizonte) ────────
  const leerConfigFn = useServerFn(leerConfigMotor);
  const guardarConfigFn = useServerFn(guardarConfigMotor);
  const config = useQuery({
    queryKey: ["engine_config"],
    queryFn: () => leerConfigFn({}),
  });

  // ── Ajustes de riesgo (distancia de salida y tamano) ───────────────────
  const leerRiesgoFn = useServerFn(leerAjustesRiesgoMotor);
  const guardarRiesgoFn = useServerFn(guardarAjustesRiesgoMotor);
  const ajustesRiesgo = useQuery({
    queryKey: ["ajustes_riesgo_motor"],
    queryFn: () => leerRiesgoFn({}),
  });
  const [stopPorAtr, setStopPorAtr] = useState(0);
  const [riesgoPorOperacion, setRiesgoPorOperacion] = useState(0);
  const [filtroRegimen, setFiltroRegimen] = useState(false);
  const [cooldownMinutos, setCooldownMinutos] = useState(0);
  const [cooldownPerdidas, setCooldownPerdidas] = useState(0);
  const [guardandoRiesgo, setGuardandoRiesgo] = useState(false);

  useEffect(() => {
    const a = ajustesRiesgo.data;
    if (!a) return;
    setStopPorAtr(Number(a.stopPorAtr ?? 0));
    setRiesgoPorOperacion(Number(a.riesgoPorOperacion ?? 0));
    setFiltroRegimen(a.filtroRegimen === true);
    setCooldownMinutos(Number(a.cooldownMinutos ?? 0));
    setCooldownPerdidas(Number(a.cooldownPerdidas ?? 0));
  }, [ajustesRiesgo.data]);

  const guardarRiesgo = async () => {
    setGuardandoRiesgo(true);
    try {
      await guardarRiesgoFn({
        data: {
          stopPorAtr: Number(stopPorAtr) || 0,
          riesgoPorOperacion: Number(riesgoPorOperacion) || 0,
          filtroRegimen: Boolean(filtroRegimen),
          cooldownMinutos: Number(cooldownMinutos) || 0,
          cooldownPerdidas: Number(cooldownPerdidas) || 0,
        },
      });
      toast.success("Ajustes de riesgo guardados. Se aplican desde el próximo ciclo.");
      void ajustesRiesgo.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron guardar los ajustes");
    } finally {
      setGuardandoRiesgo(false);
    }
  };

  const [selIndicadores, setSelIndicadores] = useState<string[]>([]);
  const [estrategiaId, setEstrategiaId] = useState<
    "fixed" | "conservative" | "optimal" | "aggressive"
  >("fixed");
  const [horizonte, setHorizonte] = useState(15);
  const [importe, setImporte] = useState("20");

  // Al cargar la configuración, la pantalla refleja lo guardado.
  useEffect(() => {
    const c = config.data;
    if (!c) return;
    setSelIndicadores(c.indicator_ids ?? []);
    setEstrategiaId((c.strategy_id as typeof estrategiaId) ?? "fixed");
    setHorizonte(c.horizon_minutes ?? 15);
    setImporte(String(c.amount_per_trade ?? 20));
  }, [config.data]);

  const alternarIndicador = (id: string, marcar: boolean) => {
    setSelIndicadores((prev) => {
      const actual = prev ?? [];
      if (marcar) return actual.includes(id) ? actual : [...actual, id];
      return actual.filter((x) => x !== id);
    });
  };

  const guardar = useMutation({
    mutationFn: () =>
      guardarConfigFn({
        data: {
          indicatorIds: selIndicadores ?? [],
          strategyId: estrategiaId,
          horizonMinutes: horizonte as 1 | 5 | 15,
          amountPerTrade: Number(importe) || 20,
        },
      }),
    onSuccess: () => {
      toast.success(
        "Configuración guardada. El motor usará estos indicadores desde el próximo tick.",
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
    typeof minutosCrudos === "number" && Number.isInteger(minutosCrudos) && minutosCrudos >= 1;

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
        eyebrow="Motor"
        title="Motor"
        subtitle="El motor avanza solo mientras el PC esté encendido (el tick local llama al motor cada minuto). Para ABRIR posiciones nuevas hace falta una sesión del motor activa: sin ella, el motor sigue gestionando las posiciones abiertas con sus take-profit y stop-loss, pero no abre ninguna nueva."
      />

      {conSinGestion?.unmanaged_positions && conSinGestion.unmanaged_positions.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              Sesión cerrada con {conSinGestion.unmanaged_positions.length} posición
              {conSinGestion.unmanaged_positions.length === 1 ? "" : "es"} sin gestionar
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Sesión iniciada {dateTime(conSinGestion.session_started_at)}
              {conSinGestion.session_stopped_at
                ? `, cerrada ${dateTime(conSinGestion.session_stopped_at)}`
                : ""}
              {conSinGestion.close_reason
                ? ` con motivo «${MOTIVOS[conSinGestion.close_reason] ?? conSinGestion.close_reason}»`
                : ""}
              : estas entradas quedaron sin gestión (bots detenidos, con la automatización apagada o
              parados todos por el Kill Switch) y nadie les aplica TP/SL.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Bot</th>
                    <th className="py-1 pr-3 font-medium">Par</th>
                    <th className="py-1 pr-3 font-medium">Lado</th>
                    <th className="py-1 pr-3 font-medium">Cantidad</th>
                    <th className="py-1 pr-3 font-medium">Precio</th>
                    <th className="py-1 pr-3 font-medium">Abierta</th>
                    <th className="py-1 font-medium">Estado del bot</th>
                  </tr>
                </thead>
                <tbody>
                  {conSinGestion.unmanaged_positions.map((p, i) => (
                    <tr key={`${p.bot_id}-${i}`} className="border-t border-destructive/20">
                      <td className="py-1 pr-3 font-medium">{p.bot_name}</td>
                      <td className="py-1 pr-3">{p.symbol}</td>
                      <td className="py-1 pr-3">{p.side === "buy" ? "compra" : "venta"}</td>
                      <td className="py-1 pr-3 tabular">{p.quantity}</td>
                      <td className="py-1 pr-3 tabular">{money(p.price)}</td>
                      <td className="py-1 pr-3 tabular">{dateTime(p.opened_at)}</td>
                      <td className="py-1">
                        {p.bot_status}
                        {p.auto_stop_reason ? ` · ${p.auto_stop_reason}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Revisa estas posiciones en Binance (o reinicia el bot para que vuelva a gestionar
              TP/SL): mientras el bot siga detenido, el motor no puede hacer nada con ellas. El
              estado mostrado es el del momento del cierre.
            </p>
          </CardContent>
        </Card>
      )}

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
            <CardTitle className="text-sm text-muted-foreground">Tiempo restante</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {activa?.session_ends_at ? (
              restanteMs !== null && restanteMs > 0 ? (
                <p className="tabular text-3xl font-semibold">{cuentaAtras(restanteMs)}</p>
              ) : (
                <p className="text-2xl font-semibold text-warning">temporizador vencido</p>
              )
            ) : (
              <p className="text-2xl font-semibold text-muted-foreground">—</p>
            )}
            <p className="text-xs text-muted-foreground">
              {activa?.session_ends_at
                ? `Fin programado: ${dateTime(activa.session_ends_at)}`
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
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Sin ticks {edadSeg === null ? "" : haceTexto(edadSeg)}: han pasado más de 2 intervalos (
          {umbralSeg}s) sin heartbeat. Si el tick local está corriendo, esto significa que el
          servidor no está levantado: mira el diario del cron local.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            Diario del motor
            <span className="text-xs font-normal text-muted-foreground">
              qué hizo (y qué no) cada bot en el último ciclo
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ciclos.data && ciclos.data.ciclos.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay ciclos registrados. El motor escribe uno en cada pasada (si la tabla{" "}
              <span className="font-mono">engine_cycles</span> está creada).
            </p>
          )}
          {ciclos.data?.ciclos.slice(0, 3).map((ciclo) => (
            <div key={ciclo.id} className="row-subtle rounded-lg px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {ciclo.trigger === "cron" ? "Ciclo automático" : "Ciclo manual"} ·{" "}
                  {ciclo.finished_at ? dateTime(ciclo.finished_at) : "sin cerrar"}
                </span>
                <span className="flex items-center gap-2">
                  <StatusPill
                    tone={
                      ciclo.status === "completed"
                        ? "success"
                        : ciclo.status === "failed"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {ciclo.status ?? "?"}
                  </StatusPill>
                  <span className="tabular text-xs text-muted-foreground">
                    {ciclo.bots_processed} bots · {ciclo.orders_created} órdenes ·{" "}
                    {ciclo.duration_ms ?? 0} ms
                  </span>
                </span>
              </div>
              {ciclo.decisions.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {ciclo.decisions.slice(0, 8).map((d, i) => (
                    <li
                      key={`${d.bot_id}-${i}`}
                      className="flex flex-wrap items-baseline gap-2 text-xs"
                    >
                      <span className="font-medium">{d.bot}</span>
                      <span
                        className={
                          d.accion === "omitido"
                            ? "text-muted-foreground"
                            : d.accion === "detenido"
                              ? "text-warning"
                              : d.accion === "error"
                                ? "text-destructive"
                                : "text-success"
                        }
                      >
                        {MOTIVOS_MOTOR[d.motivo] ?? d.motivo}
                      </span>
                      {d.detalle ? (
                        <span className="text-muted-foreground">· {d.detalle}</span>
                      ) : null}
                    </li>
                  ))}
                  {ciclo.decisions.length > 8 && (
                    <li className="text-xs text-muted-foreground">
                      y {ciclo.decisions.length - 8} más…
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sin decisiones registradas en este ciclo.
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riesgo y distancia de salida</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Estos ajustes estaban en la base de datos pero{" "}
            <strong>no se podian cambiar desde la app</strong>, y el motor cerraba las posiciones
            con un porcentaje fijo aunque el tamaño se calculase con la volatilidad real. Ahora el
            stop y el take usan la misma distancia que el cálculo de riesgo.
          </p>

          <div className="space-y-2">
            <Label htmlFor="stop-atr">Stop por volatilidad (ATR)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(stopPorAtr)} onValueChange={(v) => setStopPorAtr(Number(v))}>
                <SelectTrigger id="stop-atr" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Apagado (fijo)</SelectItem>
                  <SelectItem value="1">1 x ATR</SelectItem>
                  <SelectItem value="1.5">1,5 x ATR</SelectItem>
                  <SelectItem value="2">2 x ATR (recomendado)</SelectItem>
                  <SelectItem value="2.5">2,5 x ATR</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                La distancia la marca la volatilidad del par. Nunca se acorta por debajo de tu stop
                fijo.
              </p>
            </div>
            <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              <strong>Medido</strong> (velas reales, 2 pares × 2 intervalos × 4 ventanas, 20
              referencias aleatorias por corrida): con stop fijo el percentil frente al azar es 73 y
              el retorno −0,00 %; con 1,5 × ATR es 88 y −0,06 %; con 2 × ATR es 83 y −0,02 %. O sea:{" "}
              <strong>no da una ventaja para ganar</strong> (ninguna configuración del RSI gana
              dinero), lo que mejora es el <strong>riesgo</strong>: el bot aguanta mejor el ruido
              del mercado. La única estrategia con ventaja medida es la cobertura (carry).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="riesgo-op">Riesgo por operación (% del capital)</Label>
            <Input
              id="riesgo-op"
              type="number"
              min={0}
              max={20}
              step={0.1}
              value={riesgoPorOperacion}
              onChange={(e) => setRiesgoPorOperacion(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Con 0 el tamaño es un porcentaje fijo del capital. Con un número, el tamaño sale de la
              distancia del stop: el riesgo por operación es siempre el mismo.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cooldown-min">Enfriamiento tras pérdidas (minutos)</Label>
              <Input
                id="cooldown-min"
                type="number"
                min={0}
                max={1440}
                value={cooldownMinutos}
                onChange={(e) => setCooldownMinutos(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown-perd">Pérdidas seguidas que lo activan</Label>
              <Input
                id="cooldown-perd"
                type="number"
                min={0}
                max={20}
                value={cooldownPerdidas}
                onChange={(e) => setCooldownPerdidas(Number(e.target.value))}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs">
            <Checkbox
              checked={filtroRegimen}
              onCheckedChange={(v) => setFiltroRegimen(v === true)}
            />
            <span>
              No operar en regímenes que no levan a la estrategia (tendencia fuerte con una
              estrategia de reversión, o volatilidad extrema).
            </span>
          </label>

          <Button onClick={() => void guardarRiesgo()} disabled={guardandoRiesgo}>
            {guardandoRiesgo ? "Guardando…" : "Guardar ajustes de riesgo"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuración del motor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.data?.sinFila && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              El motor no tiene configuración guardada: sin indicadores no hay señal y{" "}
              <strong>no abre posiciones</strong>. Guarda una configuración para que empiece a
              operar.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Los indicadores son los que deciden comprar y vender. Con varios seleccionados solo se
            opera cuando <strong>todos</strong> coinciden. El backtest usa exactamente estos mismos
            indicadores, así que lo que midas ahí es lo que hará el motor.
          </p>

          <div className="space-y-2">
            <Label>Indicadores</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {INDICADORES.map((ind) => {
                const marcado = (selIndicadores ?? []).includes(ind.id);
                return (
                  <label
                    key={ind.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs"
                  >
                    <Checkbox
                      checked={marcado}
                      onCheckedChange={(v) => alternarIndicador(ind.id, v === true)}
                      aria-label={ind.nombre}
                    />
                    <span>
                      <span className="font-medium">{ind.nombre}</span>
                      <span className="block text-muted-foreground">{ind.descripcionCorta}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Estrategia (tamaño)</Label>
              <Select
                value={estrategiaId}
                onValueChange={(v) => setEstrategiaId(v as typeof estrategiaId)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTRATEGIAS.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Horizonte (vela)</Label>
              <Select value={String(horizonte)} onValueChange={(v) => setHorizonte(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 minuto</SelectItem>
                  <SelectItem value="5">5 minutos</SelectItem>
                  <SelectItem value="15">15 minutos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Importe por operación (USDT)</Label>
              <Input
                type="number"
                min={1}
                step="1"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
              />
            </div>
          </div>

          <Button
            type="button"
            disabled={guardar.isPending || (selIndicadores ?? []).length === 0}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? "Guardando..." : "Guardar configuración"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Control de la sesión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Duración de la sesión</Label>
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
            (engine_enabled). Al vencer el temporizador la sesión deja de abrir posiciones y se
            cierra con motivo «temporizador» cuando no queden abiertas; Detener hace lo mismo con
            motivo «manual»; el Kill Switch siempre tiene prioridad («kill switch»). El motor avanza
            solo con el tick local (cada minuto, mientras el PC esté encendido y el servidor
            levantado); lo que necesita esta pestaña es una sesión con temporizador abierta para
            poder abrir posiciones nuevas.
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
    </div>
  );
}
