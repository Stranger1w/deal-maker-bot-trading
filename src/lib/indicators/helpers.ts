/**
 * Utilidades compartidas por los indicadores.
 *
 * Reglas que se respetan en todos:
 *  - Ninguna division por cero: donde el denominador pueda ser 0 se devuelve
 *    `null` o un valor neutral DEFINIDO. Nunca NaN ni Infinity.
 *  - Series mas cortas que el periodo requerido devuelven `null`: no hay senal.
 */

import type { PriceSeries } from "./types";

/**
 * Descarta la vela en curso (la ultima) y devuelve solo velas cerradas.
 *
 * Quien construye la serie desde la API de Binance sabe si la ultima vela esta
 * cerrada; si no lo sabe, es mas seguro descartar una de mas que emitir una
 * senal sobre un cierre provisional.
 */
export function cerradas(series: PriceSeries): PriceSeries {
  const corte = Math.max(0, series.closes.length - 1);
  return {
    open: series.open.slice(0, corte),
    closes: series.closes.slice(0, corte),
    highs: series.highs.slice(0, corte),
    lows: series.lows.slice(0, corte),
    ...(series.volumes ? { volumes: series.volumes.slice(0, corte) } : {}),
    ...(series.times ? { times: series.times.slice(0, corte) } : {}),
  };
}

/** Ultimos `n` valores de una serie, o la serie entera si es mas corta. */
export function ultimos<T>(serie: T[], n: number): T[] {
  return serie.length <= n ? serie.slice() : serie.slice(-n);
}

/** Media aritmetica. Devuelve `null` si la serie esta vacia. */
export function media(serie: number[]): number | null {
  if (serie.length === 0) return null;
  let suma = 0;
  for (const v of serie) suma += v;
  return suma / serie.length;
}

/**
 * Desviacion tipica POBLACIONAL (divide entre N, no entre N-1), que es la que
 * usan las Bollinger Bands de TradingView. Devuelve `null` si no hay datos.
 */
export function desviacionPoblacional(serie: number[]): number | null {
  const m = media(serie);
  if (m === null) return null;
  let acc = 0;
  for (const v of serie) {
    const d = v - m;
    acc += d * d;
  }
  return Math.sqrt(acc / serie.length);
}

/** Media movil simple de `periodo` sobre el final de la serie. */
export function sma(serie: number[], periodo: number): number | null {
  if (periodo <= 0 || serie.length < periodo) return null;
  return media(serie.slice(-periodo));
}

/**
 * Media exponencial con el factor estandar `2/(periodo+1)`, sembrada con SMA
 * de los primeros `periodo` valores (como en TradingView).
 * Devuelve `null` si no hay datos suficientes.
 */
export function ema(serie: number[], periodo: number): number | null {
  if (periodo <= 0 || serie.length < periodo) return null;
  const k = 2 / (periodo + 1);
  let actual = media(serie.slice(0, periodo));
  if (actual === null) return null;
  for (let i = periodo; i < serie.length; i++) {
    const v = serie[i];
    if (v === undefined) continue;
    actual = v * k + actual * (1 - k);
  }
  return actual;
}

/** Marca un numero como no utilizable si no es finito (NaN / Infinity). */
export function finito(v: number | null): number | null {
  if (v === null) return null;
  return Number.isFinite(v) ? v : null;
}
