/**
 * CCI - Commodity Channel Index.
 *
 * "Mide la desviacion del precio respecto a la media." Mide cuanto se aleja el
 * precio tipico ((max+min+cierre)/3) de su media movil. >+100 fuerza alcista;
 * <-100 debilidad. Parametros: periodo 20, niveles +-100.
 *
 * Constante 0.015 y desviacion media absoluta, como en TradingView y en `ta`.
 */

import { media, ultimos } from "./helpers";
import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_PERIODO = 20;
export const DEFAULT_CONSTANTE = 0.015;
export const DEFAULT_SOBRECOMPRA = 100;
export const DEFAULT_SOBREVENTA = -100;

/** Precio tipico de una vela: (max + min + cierre) / 3. */
export function tipico(high: number, low: number, close: number): number {
  return (high + low + close) / 3;
}

export type CciPoint = { tipico: number; media: number; cci: number };

/** Serie completa del CCI. Null donde no hay datos suficientes. */
export function cciSerie(
  highs: number[],
  lows: number[],
  closes: number[],
  periodo = DEFAULT_PERIODO,
  constante = DEFAULT_CONSTANTE,
): (CciPoint | null)[] {
  const n = closes.length;
  const out: (CciPoint | null)[] = new Array(n).fill(null);
  if (periodo < 1 || highs.length < n || lows.length < n) return out;

  const tipicos: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (h === undefined || l === undefined || c === undefined) return out;
    tipicos.push(tipico(h, l, c));
  }

  for (let i = periodo - 1; i < n; i++) {
    const ventana = ultimos(tipicos.slice(0, i + 1), periodo);
    const m = media(ventana);
    if (m === null) continue;
    // Desviacion media absoluta (no raiz): es la usada por CCI y por `ta`.
    let acc = 0;
    for (const v of ventana) acc += Math.abs(v - m);
    const mad = acc / ventana.length;
    const t = tipicos[i];
    if (t === undefined) continue;
    // Desviacion cero: el precio no se ha movido, el CCI no significa nada.
    if (mad === 0) {
      out[i] = { tipico: t, media: m, cci: 0 };
      continue;
    }
    const valor = (t - m) / (constante * mad);
    if (Number.isFinite(valor)) out[i] = { tipico: t, media: m, cci: valor };
  }
  return out;
}

export function cciUltimo(
  highs: number[],
  lows: number[],
  closes: number[],
  params: Record<string, number>,
): CciPoint | null {
  const serie = cciSerie(
    highs,
    lows,
    closes,
    params["periodo"] ?? DEFAULT_PERIODO,
    params["constante"] ?? DEFAULT_CONSTANTE,
  );
  for (let i = serie.length - 1; i >= 0; i--) {
    const p = serie[i];
    if (p) return p;
  }
  return null;
}

export const cci: IndicatorDef = {
  id: "cci",
  nombre: "CCI",
  tipo: "reversion",
  descripcionCorta:
    "Mide la desviacion del precio respecto a la media. Mide cuanto se aleja el precio tipico ((max+min+cierre)/3) de su media movil. >+100 fuerza alcista/sobrecompra; <-100 debilidad/sobreventa.",
  detalles: {
    queMide:
      "Cuanto se aparta el precio tipico de su media movil de 20 velas, medido en desviaciones medias. Usa maximos, minimos y cierres.",
    comoSenala:
      "Por encima de +100 se interpreta como sobrecompra; por debajo de -100, sobreventa y posible rebote. La constante 0.015 mantiene el oscilador en un rango comodo alrededor de cero.",
    cuandoFalla:
      "Es ruidoso en mercados laterales: con el precio dando bandos dentro de un rango estrecho, el CCI cruza +100 y -100 muchas veces sin que nada cambie de verdad.",
    aviso:
      "Es un indicador de REVERSION. Mezclado con indicadores de TENDENCIA (MACD, Precio de cierre) las senales se oponen y el motor apenas operara.",
  },
  parametros: [
    { key: "periodo", label: "Periodo", value: DEFAULT_PERIODO, min: 10, max: 50, step: 1 },
    {
      key: "constante",
      label: "Constante",
      value: DEFAULT_CONSTANTE,
      min: 0.005,
      max: 0.05,
      step: 0.001,
    },
    {
      key: "sobrecompra",
      label: "Sobrecompra",
      value: DEFAULT_SOBRECOMPRA,
      min: 50,
      max: 200,
      step: 5,
    },
    {
      key: "sobreventa",
      label: "Sobreventa",
      value: DEFAULT_SOBREVENTA,
      min: -200,
      max: -50,
      step: 5,
    },
  ],
  minSamples: DEFAULT_PERIODO,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    if (series.highs.length === 0 || series.lows.length === 0) return null;
    const p = cciUltimo(series.highs, series.lows, series.closes, params);
    if (!p) return null;
    const sobrecompra = params["sobrecompra"] ?? DEFAULT_SOBRECOMPRA;
    const sobreventa = params["sobreventa"] ?? DEFAULT_SOBREVENTA;
    if (sobreventa >= sobrecompra) return null;
    if (p.cci > sobrecompra) return "sell";
    if (p.cci < sobreventa) return "buy";
    return null;
  },

  diagnose(series: PriceSeries, params: Record<string, number>) {
    if (series.highs.length === 0 || series.lows.length === 0) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: "El CCI necesita maximos, minimos y cierres, y esta serie no los trae.",
      };
    }
    const p = cciUltimo(series.highs, series.lows, series.closes, params);
    if (!p) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: `Hacen falta ${params["periodo"] ?? DEFAULT_PERIODO} velas y hay ${series.closes.length}.`,
      };
    }
    if (Math.abs(p.cci) > 200) {
      return {
        failure: "ruido" as const,
        detalle: "El CCI esta muy fuera de rango: movimiento fuerte, la senal puede ser tardia.",
      };
    }
    return { failure: "ninguno" as const, detalle: `CCI en ${p.cci.toFixed(1)}: zona util.` };
  },
};
