/**
 * AI Indicator.
 *
 * NO es IA predictiva. Lee la tabla de operaciones del PROPIO bot y calcula
 * estadisticas por (par, indicador, hora del dia, horizonte): tasa de acierto,
 * P&L medio, drawdown y numero de muestras. Con eso puntua, filtra los pares y
 * las horas con rendimiento negativo y sugiere el indicador con mejor historico.
 *
 * Sin al menos 30 muestras NO interviene: devuelve null y se explica por que.
 * El rendimiento pasado no garantiza resultados futuros.
 */

import type { IndicatorDef, IndicatorFailure, PriceSeries, SignalDirection } from "./types";

export const MINIMO_MUESTRAS = 30;

/** Una operacion cerrada del bot, tal como se lee de bot_executions. */
export type OperacionHistorica = {
  symbol: string;
  /** Hora del dia en formato 24h "HH:MM" de la zona horaria del bot. */
  hora: string;
  horizonteMin: number;
  indicadorId: string;
  side: "buy" | "sell";
  pnl: number;
};

/** Estadisticas de una combinacion (par x indicador x hora x horizonte). */
export type Estadistica = {
  muestras: number;
  aciertos: number;
  tasaAcierto: number;
  pnlMedio: number;
  drawdown: number;
};

function resumen(op: OperacionHistorica[]): Estadistica | null {
  if (op.length === 0) return null;
  let aciertos = 0;
  let suma = 0;
  let pico = 0;
  let maxDD = 0;
  let acumulado = 0;
  for (const o of op) {
    suma += o.pnl;
    if (o.pnl > 0) aciertos++;
    acumulado += o.pnl;
    if (acumulado > pico) pico = acumulado;
    if (pico - acumulado > maxDD) maxDD = pico - acumulado;
  }
  return {
    muestras: op.length,
    aciertos,
    tasaAcierto: aciertos / op.length,
    pnlMedio: suma / op.length,
    drawdown: maxDD,
  };
}

/** Filtra las operaciones del mismo contexto que la serie actual. */
export function contexto(
  ops: OperacionHistorica[],
  filtro: { symbol: string; hora: string; horizonteMin: number; indicadorId: string },
): OperacionHistorica[] {
  return ops.filter(
    (o) =>
      o.symbol === filtro.symbol &&
      o.hora === filtro.hora &&
      o.horizonteMin === filtro.horizonteMin &&
      o.indicadorId === filtro.indicadorId,
  );
}

/** Hora del dia de la ultima vela, o null si la serie no trae marcas de tiempo. */
export function horaDeLaSerie(series: PriceSeries): string | null {
  const t = series.times?.[series.times.length - 1];
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export const MIN_MUESTRAS = MINIMO_MUESTRAS;

/**
 * Puntuacion 0-1 del AI Indicator para un contexto concreto.
 * Devuelve null si no hay muestras suficientes. Si la tasa de acierto es baja o
 * el P&L medio es negativo, la puntuacion es 0: el AI descarta ese contexto.
 */
export function puntuar(
  ops: OperacionHistorica[],
  filtro: { symbol: string; hora: string; horizonteMin: number; indicadorId: string },
): number | null {
  const est = resumen(contexto(ops, filtro));
  if (!est || est.muestras < MINIMO_MUESTRAS) return null;
  if (est.pnlMedio <= 0) return 0;
  // Pondera acierto (60%) y P&L medio normalizado (40%).
  const escala = Math.min(1, Math.abs(est.pnlMedio) / 1);
  return Math.min(1, est.tasaAcierto * 0.6 + escala * 0.4);
}

/** Indicador con mejor historial, o null si ninguno tiene muestras suficientes. */
export function mejorIndicador(
  ops: OperacionHistorica[],
  filtro: { symbol: string; hora: string; horizonteMin: number },
): { id: string; puntuacion: number } | null {
  const ids = [...new Set(ops.map((o) => o.indicadorId))];
  let mejor: { id: string; puntuacion: number } | null = null;
  for (const id of ids) {
    const p = puntuar(ops, { ...filtro, indicadorId: id });
    if (p === null) continue;
    if (p <= 0) continue;
    if (!mejor || p > mejor.puntuacion) mejor = { id, puntuacion: p };
  }
  return mejor;
}

export const aiIndicator: IndicatorDef = {
  id: "ai_indicator",
  nombre: "AI Indicator",
  tipo: "filtro",
  descripcionCorta: "Analiza automaticamente tus operaciones pasadas y los parametros del mercado.",
  detalles: {
    queMide:
      "No mide el mercado: mide TU historial. Para cada combinacion de par, indicador, hora del dia y horizonte calcula tasa de acierto, P&L medio, drawdown y numero de muestras, y puntua ese contexto de 0 a 1.",
    comoSenala:
      "Si la puntuacion del contexto actual es alta, delega la senal en el resto de indicadores seleccionados. Si es baja o negativa, el AI descarta ese par o esa hora y no interviene.",
    cuandoFalla: `Con menos de ${MINIMO_MUESTRAS} operaciones NO interviene: se muestra "datos insuficientes". Con pocas muestras, un par puede parecer rentable por casualidad. Y el rendimiento pasado no garantiza resultados futuros: es una foto, no una prediccion.`,
    aviso:
      "No es IA predictiva ni un modelo entrenado: son estadisticas descriptivas de tus propias operaciones.",
  },
  parametros: [],
  minSamples: 1,
  requiereHistorial: true,
  minMuestras: MINIMO_MUESTRAS,

  // El AI no produce senal propia: la lógica vive en la Fase 3, donde ya
  // tenemos el historial del bot y la configuracion activa.
  signal(_series: PriceSeries, _params: Record<string, number>): SignalDirection {
    return null;
  },

  diagnose(
    series: PriceSeries,
    _params: Record<string, number>,
  ): { failure: IndicatorFailure; detalle: string } {
    if (horaDeLaSerie(series) === null) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: "La serie no trae marcas de tiempo, asi que no se puede saber la hora del dia.",
      };
    }
    return {
      failure: "datos_insuficientes" as const,
      detalle: `Se necesitan al menos ${MINIMO_MUESTRAS} operaciones propias para que el AI intervenga.`,
    };
  },
};
