/**
 * MACD - Moving Average Convergence/Divergence.
 *
 * "Seguimiento de tendencia con medias móviles." EMA 12 y 26 con línea de señal 9.
 * Compra si el MACD cruza hacia arriba la señal; vende si cruza hacia abajo.
 *
 * Cruce, NO nivel: un MACD por encima de cero no es señal de compra por sí solo.
 * La señal solo aparece en el cambio de posición relativo entre macd y señal.
 */

import { ema, finito } from "./helpers";
import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_RAPIDA = 12;
export const DEFAULT_LENTA = 26;
export const DEFAULT_SENAL = 9;

export type MacdPoint = { macd: number; signal: number; histograma: number };

/**
 * Serie completa de MACD. Se exporta para el test de paridad numerica.
 * Devuelve null en las velas donde aun no hay datos suficientes.
 */
export function macdSerie(
  cierres: number[],
  rapida = DEFAULT_RAPIDA,
  lenta = DEFAULT_LENTA,
  senal = DEFAULT_SENAL,
): (MacdPoint | null)[] {
  const n = cierres.length;
  if (rapida >= lenta || lenta < 2) return [];
  // La serie solo empieza cuando la EMA lenta tiene su semilla.
  const inicio = lenta - 1;
  const out: (MacdPoint | null)[] = new Array(n).fill(null);

  let emaRapida = ema(cierres.slice(0, lenta), rapida);
  let emaLenta = ema(cierres.slice(0, lenta), lenta);
  if (emaRapida === null || emaLenta === null) return out;

  const macds: number[] = [emaRapida - emaLenta];
  for (let i = lenta; i < n; i++) {
    const c = cierres[i];
    if (c === undefined) break;
    emaRapida = c * (2 / (rapida + 1)) + emaRapida * (1 - 2 / (rapida + 1));
    emaLenta = c * (2 / (lenta + 1)) + emaLenta * (1 - 2 / (lenta + 1));
    macds.push(emaRapida - emaLenta);
  }

  // La señal es una EMA de 9 sobre el propio MACD.
  const señales: (number | null)[] = new Array(macds.length).fill(null);
  let acc = 0;
  for (let i = senal - 1; i < macds.length; i++) {
    if (i === senal - 1) {
      let suma = 0;
      for (let k = 0; k < senal; k++) suma += macds[k] ?? 0;
      acc = suma / senal;
    } else {
      const m = macds[i];
      if (m === undefined) break;
      acc = m * (2 / (senal + 1)) + acc * (1 - 2 / (senal + 1));
    }
    señales[i] = acc;
  }

  for (let j = 0; j < macds.length; j++) {
    const m = macds[j];
    const s = señales[j];
    if (m === undefined || s === null || s === undefined) continue;
    out[inicio + j] = { macd: m, signal: s, histograma: m - s };
  }
  return out;
}

/** Ultimo punto de MACD con datos completos, o null. */
export function macdUltimo(cierres: number[], params: Record<string, number>): MacdPoint | null {
  const serie = macdSerie(
    cierres,
    params["rapida"] ?? DEFAULT_RAPIDA,
    params["lenta"] ?? DEFAULT_LENTA,
    params["senal"] ?? DEFAULT_SENAL,
  );
  for (let i = serie.length - 1; i >= 0; i--) {
    const p = serie[i];
    if (p) return p;
  }
  return null;
}

export const macd: IndicatorDef = {
  id: "macd",
  nombre: "MACD",
  tipo: "tendencia",
  descripcionCorta:
    "Seguimiento de tendencia con medias móviles. EMA 12 y 26 con línea de señal 9. Compra si el MACD cruza hacia arriba la señal; vende si cruza hacia abajo.",
  detalles: {
    queMide:
      "La distancia entre una media exponencial rápida (12) y otra lenta (26). Cuando esa distancia cambia de signo, el momentum del precio esta cambiando.",
    comoSenala:
      "Compra cuando el MACD cruza por encima de su línea de señal (9). Vende cuando cruza por debajo. El histograma es la diferencia entre ambas líneas.",
    cuandoFalla:
      "Señales tardías: al ser medias de 12 y 26 velas, reacciona con retraso y en mercados laterales da cruces falsos seguidos. Además, como son medias de periodos largos, la serie necesita muchas velas antes de ser fiable.",
    aviso:
      "Es un indicador de TENDENCIA. Mezclado con indicadores de REVERSIÓN (RSI, Bollinger, Estocástico, CCI) las señales se contradicen a menudo y el motor se queda quieto.",
  },
  parametros: [
    { key: "rapida", label: "EMA rápida", value: DEFAULT_RAPIDA, min: 5, max: 20, step: 1 },
    { key: "lenta", label: "EMA lenta", value: DEFAULT_LENTA, min: 20, max: 50, step: 1 },
    { key: "senal", label: "Línea de señal", value: DEFAULT_SENAL, min: 5, max: 15, step: 1 },
  ],
  minSamples: DEFAULT_LENTA + DEFAULT_SENAL - 1,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    const serie = macdSerie(
      series.closes,
      params["rapida"] ?? DEFAULT_RAPIDA,
      params["lenta"] ?? DEFAULT_LENTA,
      params["senal"] ?? DEFAULT_SENAL,
    );
    if (serie.length < 2) return null;
    let previo: MacdPoint | null = null;
    for (let i = serie.length - 1; i >= 0; i--) {
      const p = serie[i];
      if (!p) continue;
      if (previo) {
        if (previo.macd <= previo.signal && p.macd > p.signal) return "buy";
        if (previo.macd >= previo.signal && p.macd < p.signal) return "sell";
        return null; // solo hay senal en el cruce
      }
      previo = p;
    }
    return null;
  },

  diagnose(series: PriceSeries, params: Record<string, number>) {
    const p = macdUltimo(series.closes, params);
    if (!p) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: "Faltan velas para cerrar la EMA lenta y su línea de señal.",
      };
    }
    if (Math.abs(p.histograma) < 0.0001) {
      return {
        failure: "rango_lateral" as const,
        detalle: "El MACD y su señal están prácticamente pegados: mercado sin dirección clara.",
      };
    }
    return {
      failure: "ninguno" as const,
      detalle: `Histograma ${p.histograma.toFixed(4)}: hay separación entre MACD y señal.`,
    };
  },
};

/** Reexportado para los tests. */
export { finito };
