import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { generateReports } from "@/lib/risk.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowUpRight, Bot, ChartNoAxesColumn, Gauge, KeyRound, Mail, Wrench } from "lucide-react";

import { ActividadPanel } from "@/components/ActividadPanel";
import type {
  BotResumen as ActividadBot,
  MovimientoResumen as ActividadMovimiento,
  WorkerResumen as ActividadWorker,
} from "@/components/ActividadPanel";
import { PasosIniciales } from "@/components/PasosIniciales";
import { AlertsPanel } from "@/components/AlertsPanel";
import { ComparisonCharts } from "@/components/ComparisonCharts";
import { KillSwitchButton, KillSwitchStatus } from "@/components/KillSwitchButton";
import { PageHeader } from "@/components/PageHeader";
import { SkeletonCifras } from "@/components/Skeleton";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { estadoApp } from "@/lib/estado.functions";
import { leerCredencialesBinance } from "@/lib/dealmaker.functions";
import { dateTime, money } from "@/lib/format";
import {
  alertsQuery,
  auditQuery,
  automationQuery,
  botsQuery,
  executionsQuery,
  fundsQuery,
  reportsQuery,
  workersQuery,
} from "@/lib/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Deal Maker — Panel de bots y minería" },
      {
        name: "description",
        content:
          "Panel en tiempo real para gestionar bots de trading automatizado en Binance y workers de minería de criptomonedas.",
      },
      { property: "og:title", content: "Deal Maker — Panel de bots y minería" },
      {
        property: "og:description",
        content:
          "Fondos, API Keys de Binance, escuadrón de bots y enjambre de minería en un panel.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const [generandoReporte, setGenerandoReporte] = useState(false);
  // El resumen diario: con el 24/7 descartado no hay cron que lo cree.
  const generarReportsFn = useServerFn(generateReports);

  const funds = useQuery(fundsQuery);
  const bots = useQuery(botsQuery);
  const workers = useQuery(workersQuery);
  const audit = useQuery(auditQuery);
  const engine = useQuery(automationQuery);
  const alerts = useQuery(alertsQuery);
  const reports = useQuery(reportsQuery);
  const ejecuciones = useQuery(executionsQuery);
  // Estado de Binance: lo lee el servidor (la tabla esta bloqueada por RLS
  // y desde el navegador daba 403: la app decia "sin configurar" cuando si
  // estaba verificada).
  const leerCredenciales = useServerFn(leerCredencialesBinance);
  const binance = useQuery({
    queryKey: ["binance_settings"],
    queryFn: () => leerCredenciales({}),
  });

  // Hay operaciones cerradas (ventas): hay algo que medir.
  const hayOperaciones = (ejecuciones.data ?? []).some((e) => e.side === "sell");

  // Estado real de la app: migraciones pendientes y si el motor tiene
  // configuracion. Es una lectura; si el usuario no puede consultarla, el
  // panel sigue funcionando sin esa fila.
  const estadoFn = useServerFn(estadoApp);
  const estado = useQuery({
    queryKey: ["estado_app"],
    queryFn: () => estadoFn({}),
    refetchInterval: 120000,
  });

  const botList = bots.data ?? [];
  // Mientras cargan los datos no se inventan ceros: un "0,00" parece real.
  const cargandoDatos = funds.isLoading || bots.isLoading || engine.isLoading;
  const workerList = workers.data ?? [];
  const pnl = botList.reduce((s, b) => s + Number(b.pnl), 0);
  const running = botList.filter((b) => b.status === "running").length;
  const realBots = botList.filter((b) => b.mode === "real").length;
  const mining = workerList.filter((w) => w.status === "mining").length;
  const dailyMining = workerList.reduce((s, w) => s + Number(w.estimated_daily_earnings), 0);
  const alertList = alerts.data ?? [];
  const criticalAlerts = alertList.filter(
    (a) => a.severity === "critical" && !a.acknowledged,
  ).length;
  const stoppedByRisk = botList.filter((b) => b.auto_stop_reason).length;
  const offlineWorkers = workerList.filter((w) => w.status === "offline").length;

  const engineOn = !!engine.data?.engine_enabled;
  const kill = !!engine.data?.kill_switch;
  const ultimoTick = engine.data?.last_heartbeat_at ?? null;
  const intervaloSeg = Number(engine.data?.tick_interval_seconds ?? 60);
  const antiguedadSeg = ultimoTick
    ? Math.max(0, Math.round((Date.now() - Date.parse(ultimoTick)) / 1000))
    : null;
  const motorVivo =
    engineOn && !kill && antiguedadSeg !== null && antiguedadSeg <= intervaloSeg * 3;

  const salud: { label: string; ok: boolean; detail: string; accion?: string | undefined }[] = [
    {
      label: "Motor",
      ok: motorVivo,
      detail: !engineOn
        ? "apagado"
        : kill
          ? "detenido por el kill switch"
          : antiguedadSeg === null
            ? "sin sesión abierta"
            : antiguedadSeg > intervaloSeg * 3
              ? `sin ticks hace ${antiguedadSeg} s`
              : "operando",
      accion: !engineOn
        ? "Enciéndelo en la pestaña Motor."
        : kill
          ? "Revisa el motivo del kill switch y reactívalo cuando quieras."
          : antiguedadSeg !== null && antiguedadSeg > intervaloSeg * 3
            ? "No hay sesión abierta: el motor solo opera con un temporizador iniciado desde la pestaña Motor."
            : undefined,
    },
    {
      label: "Binance",
      ok: binance.data?.connection_status === "ok",
      detail:
        binance.data?.connection_status === "ok"
          ? `conectada · •••• ${binance.data.api_key_last4}`
          : "sin conectar o sin probar",
      accion:
        binance.data?.connection_status === "ok"
          ? undefined
          : "Pega tus API keys y pulsa «Probar». Sin claves verificadas no se opera en Real.",
    },
    {
      label: "Bots",
      ok: stoppedByRisk === 0,
      detail:
        stoppedByRisk === 0
          ? `${running} activos · ${realBots} en Real`
          : `${stoppedByRisk} detenidos por un límite`,
      accion:
        stoppedByRisk === 0
          ? undefined
          : "Un bot se paró porque tocó un límite de riesgo: míralo en «Mis bots» antes de tocar nada.",
    },
    {
      label: "Minería",
      ok: offlineWorkers === 0,
      detail: offlineWorkers === 0 ? `${mining} equipos encendidos` : `${offlineWorkers} apagados`,
      accion:
        offlineWorkers === 0
          ? undefined
          : "Los equipos apagados no están minando: enciéndelos desde «Minería».",
    },
    {
      label: "Avisos",
      ok: criticalAlerts === 0,
      detail: criticalAlerts === 0 ? "ninguno pendiente" : `${criticalAlerts} sin revisar`,
      accion:
        criticalAlerts === 0
          ? undefined
          : "Hay avisos críticos sin revisar: míralos abajo, en «Avisos importantes».",
    },
  ];

  // La base de datos solo se enseña si el usuario puede consultarla.
  if (estado.data) {
    salud.push({
      label: "Base de datos",
      ok: estado.data.todoAplicado,
      detail: estado.data.todoAplicado
        ? "migraciones al día"
        : `${estado.data.pendientes} migraciones sin aplicar`,
      accion: estado.data.todoAplicado
        ? undefined
        : "Aplícalas en el SQL Editor de Supabase (Ajustes → Automatización te dice cuáles).",
    });
  }

  // Pasos siguientes: lo que de verdad falta para que la app rinda. Cada uno
  // mira el estado real, asi que la lista se acorta sola segun avanzas.
  // Se muestran en la ventana de arriba, que va avanzando sola.
  const pasos = [
    {
      hecho: botList.length > 0,
      titulo: "Crea tu primer bot",
      detalle:
        "Un bot es una estrategia con dinero: un par, un capital y los indicadores que decidirán comprar y vender. Sin bots, el motor no tiene nada que operar.",
      to: "/escuadron",
      etiquetaAccion: "Crear bot",
      icono: Bot,
    },
    {
      hecho: binance.data?.connection_status === "ok",
      titulo: "Conecta y verifica tu cuenta de Binance",
      detalle:
        "Pega una API key con permiso de operar (y SIN retiros) y pulsa «Probar». Sin claves verificadas los bots no pueden operar ni en testnet.",
      to: "/binance",
      etiquetaAccion: "Conectar Binance",
      icono: KeyRound,
    },
    {
      hecho: engineOn && (estado.data?.motor.sesionActiva ?? false),
      titulo: "Abre una sesión del motor",
      detalle:
        "El motor abre y cierra posiciones SOLO dentro de una sesión con temporizador que abras tú. Con el 24/7 automático descartado, sin sesión los bots esperan (no operan).",
      to: "/motor",
      etiquetaAccion: "Abrir el motor",
      icono: Gauge,
    },
    {
      hecho: !!estado.data?.motor.tieneConfig,
      titulo: "Configura los indicadores del motor",
      detalle:
        "Los indicadores son los que deciden comprar y vender. Sin ellos el motor se queda quieto a propósito: elige cuáles quieres y guárdalos.",
      to: "/motor",
      etiquetaAccion: "Configurar",
      icono: Wrench,
    },
    {
      hecho: estado.data?.notificaciones.activo ?? false,
      titulo: "Activa los avisos por correo",
      detalle:
        "Los límites de riesgo y los reportes te llegan al correo con el que creaste la cuenta. Puedes desactivarlos cuando quieras (Seguridad > Notificaciones por correo).",
      to: "/acceso",
      etiquetaAccion: "Activar avisos",
      icono: Mail,
    },
    {
      hecho: hayOperaciones,
      titulo: "Mide tu estrategia antes de arriesgar",
      detalle:
        "Mide si tu configuración supera al mercado y a las estrategias aleatorias. Con pocas operaciones, esas cifras son ruido: no las tomes como prueba de rentabilidad.",
      to: "/metricas",
      etiquetaAccion: "Ver métricas",
      icono: ChartNoAxesColumn,
    },
    {
      hecho: !!estado.data?.todoAplicado,
      titulo: "Aplica las migraciones pendientes",
      detalle:
        "Hay cambios de esquema que solo puedes aplicar tú en el SQL Editor de Supabase. Hasta entonces, la app funciona pero se pierde el desglose por indicador y el diario del motor.",
      to: "/automatizacion",
      etiquetaAccion: "Ver cuáles",
      icono: Wrench,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Panel"
        title="Tu taller de trading, de un vistazo"
        subtitle="Lo que hay money en juego, qué está haciendo el motor y lo que te falta por mirar. Sin adornos: las cifras son reales y las alertas no se esconden."
        action={<KillSwitchButton />}
      />

      {/* Aviso grande: el motor encendido pero SIN sesion no hace nada. */}
      {engineOn && !kill && !estado.data?.motor.sesionActiva && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warning">
              El motor está encendido pero no hay sesión: no abrirá ninguna posición.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Con el 24/7 automático descartado, el motor solo opera mientras haya una sesión con
              temporizador abierta en esta app. Los bots que estén "corriendo" esperan, no operan.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => (window.location.href = "/motor")}>
            Abrir una sesión
          </Button>
        </div>
      )}

      {/* Pasos iniciales: ventanita arriba que va avanzando sola. */}
      <PasosIniciales pasos={pasos} />

      {/* Cabecera de cifras: el dinero y el estado, en una sola mirada. */}
      {cargandoDatos ? (
        <SkeletonCifras cantidad={4} />
      ) : (
        <section className="surface accent-top overflow-hidden rounded-xl">
          <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
            <Cifra
              etiqueta="Capital en juego"
              valor={money(Number(funds.data?.available_balance ?? 0))}
              pie={`${money(Number(funds.data?.in_use_balance ?? 0))} asignados a bots`}
              tono="neutral"
            />
            <Cifra
              etiqueta="Resultado acumulado"
              valor={money(pnl)}
              pie={`${running} bots activos · ${realBots} con dinero real`}
              tono={pnl >= 0 ? "positivo" : "negativo"}
            />
            <Cifra
              etiqueta="Estado del motor"
              valor={
                motorVivo ? "Operando" : kill ? "Detenido" : engineOn ? "En espera" : "Apagado"
              }
              pie={
                ultimoTick
                  ? `Último tick ${dateTime(ultimoTick)}`
                  : "Sin sesión abierta: el motor no abre posiciones"
              }
              tono={motorVivo ? "positivo" : "aviso"}
            />
            <Cifra
              etiqueta="Binance"
              valor={
                binance.data
                  ? binance.data.connection_status === "ok"
                    ? "Verificada"
                    : binance.data.connection_status === "failed"
                      ? "Fallida"
                      : "Sin probar"
                  : "Sin configurar"
              }
              pie={
                binance.data
                  ? `Clave •••• ${binance.data.api_key_last4}`
                  : "Conecta tu cuenta para poder operar"
              }
              tono={binance.data?.connection_status === "ok" ? "positivo" : "aviso"}
            />
          </div>
        </section>
      )}

      {/* Gráfica + actividad lado a lado: todo lo importante en la primera pantalla. */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <ComparisonCharts />

        <ActividadPanel
          bots={botList as unknown as ActividadBot[]}
          workers={workerList as unknown as ActividadWorker[]}
          movimientos={(audit.data ?? []) as unknown as ActividadMovimiento[]}
          limite={6}
        />
      </div>

      {/* Salud: cinco comprobaciones, con el detalle de cada una. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">¿Está todo bien?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {salud.map((h) => (
              <div key={h.label} className="row-subtle rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{h.label}</span>
                  <StatusPill tone={h.ok ? "success" : "danger"}>
                    {h.ok ? "bien" : "revisar"}
                  </StatusPill>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{h.detail}</p>
                {h.accion ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-primary/90">{h.accion}</p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <KillSwitchStatus />
          </div>
        </CardContent>
      </Card>

      {/* Pasos siguientes: ahora viven en la ventanita de arriba. */}

      <div className="grid gap-4 lg:grid-cols-2">
        <AlertsPanel title="Avisos importantes" limit={6} />
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Resúmenes de resultados</CardTitle>
              <Button
                size="sm"
                variant="secondary"
                disabled={generandoReporte}
                onClick={async () => {
                  try {
                    setGenerandoReporte(true);
                    await generarReportsFn({ data: { period: "daily" } });
                    toast.success("Reporte diario generado con los datos reales");
                    void qc.invalidateQueries();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte");
                  } finally {
                    setGenerandoReporte(false);
                  }
                }}
              >
                {generandoReporte ? "Generando…" : "Generar diario"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(reports.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aún no hay reportes. El 24/7 automático está descartado, así que el resumen se
                genera a mano con el botón de arriba (sale con los datos reales).
              </p>
            )}
            {(reports.data ?? []).slice(0, 5).map((r) => (
              <div key={r.id} className="row-subtle rounded-lg px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {r.period === "daily" ? "Diario" : "Semanal"} ·{" "}
                    {r.scope === "squad" ? "Escuadrón" : "Enjambre"}
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {r.period_start} → {r.period_end}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.summary}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Email:{" "}
                  {r.email_status === "no_configurado"
                    ? "no configurado"
                    : "pendiente de dominio de envío verificado"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Cifra grande del bloque de cabecera. */
function Cifra({
  etiqueta,
  valor,
  pie,
  tono,
}: {
  etiqueta: string;
  valor: string;
  pie: string;
  tono: "positivo" | "negativo" | "aviso" | "neutral";
}) {
  const color =
    tono === "positivo"
      ? "text-success"
      : tono === "negativo"
        ? "text-destructive"
        : tono === "aviso"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="bg-card px-5 py-4">
      <p className="kicker">{etiqueta}</p>
      <p className={`metric-glow mt-2 text-2xl font-semibold ${color}`}>{valor}</p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{pie}</p>
    </div>
  );
}
