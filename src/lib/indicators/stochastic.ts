/**
 * Estocastico - version LENTA (tres pasos).
 *
 * "Diferencia de maximos y minimos con la posicion actual." Oscilador 0-100:
 * <20 sobreventa (compra), >80 sobrecompra (venta).
 *
 * Cadena completa (definicion "Estocastico lento", la de TradingView):
 *   %K rapido = (cierre - minimo14) / (maximo14 - minimo14) * 100
 *   %K lenta  = SMA(3) del %K rapido
 *   %D lenta  = SMA(3) de la %K lenta
 *
 * Usa maximos y minimos, asi que necesita highs/lows. Si high == low en la
 * ventana, el denominador es 0: se devuelve null, nunca NaN.
 */

import { sma, ultimos } from "./helpers";
import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_PERIODO = 14;
export const DEFAULT_SUAVIZADO = 3;
export const DEFAULT_SENAL = 3;
export const DEFAULT_SOBREVENTA = 20;
export const DEFAULT_SOBRECOMPRA = 80;

export type StochPoint = { kRapido: number; kLenta: number; dLenta: number };

/** %K rapido de la vela i, o null si el rango de la ventana es 0. */
function kRapidoEn(highs: number[], lows: number[], closes: number[], i: number, periodo: number) {
  const ventanaH = ultimos(highs.slice(0, i + 1), periodo);
  const ventanaL = ultimos(lows.slice(0, i + 1), periodo);
  const rango = Math.max(...ventanaH) - Math.min(...ventanaL);
  if (rango <= 0) return null; // high == low: no hay posicion que medir
  const cierre = closes[i];
  if (cierre === undefined) return null;
  return ((cierre - Math.min(...ventanaL)) / rango) * 100;
}

/** Serie completa del Estocastico lento. Null donde no hay datos suficientes. */
export function stochSerie(
  highs: number[],
  lows: number[],
  closes: number[],
  periodo = DEFAULT_PERIODO,
  suavizado = DEFAULT_SUAVIZADO,
  senal = DEFAULT_SENAL,
): (StochPoint | null)[] {
  const n = closes.length;
  const out: (StochPoint | null)[] = new Array(n).fill(null);
  if (periodo < 1 || highs.length < n || lows.length < n) return out;

  const kRapido: (number | null)[] = new Array(n).fill(null);
  const kLenta: (number | null)[] = new Array(n).fill(null);
  const dLenta: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const k = kRapidoEn(highs, lows, closes, i, periodo);
    if (k !== null && Number.isFinite(k)) kRapido[i] = k;
  }
  for (let i = 0; i < n; i++) {
    if (kRapido[i] === null) continue;
    const v = ultimos(
      kRapido.slice(0, i + 1).filter((x): x is number => x !== null),
      suavizado,
    );
    if (v.length < suavizado) continue;
    const m = sma(v, suavizado);
    if (m !== null) kLenta[i] = m;
  }
  for (let i = 0; i < n; i++) {
    if (kLenta[i] === null) continue;
    const v = ultimos(
      kLenta.slice(0, i + 1).filter((x): x is number => x !== null),
      senal,
    );
    if (v.length < senal) continue;
    const m = sma(v, senal);
    if (m !== null) dLenta[i] = m;
  }
  for (let i = 0; i < n; i++) {
    const k = kRapido[i];
    const kl = kLenta[i];
    const d = dLenta[i];
    if (k === null || k === undefined || kl === null || kl === undefined) continue;
    if (d === null || d === undefined) continue;
    out[i] = { kRapido: k, kLenta: kl, dLenta: d };
  }
  return out;
}

/** Ultimo punto completo, o null. */
export function stochUltimo(
  highs: number[],
  lows: number[],
  closes: number[],
  params: Record<string, number>,
): StochPoint | null {
  const serie = stochSerie(
    highs,
    lows,
    closes,
    params["periodo"] ?? DEFAULT_PERIODO,
    params["suavizado"] ?? DEFAULT_SUAVIZADO,
    params["senal"] ?? DEFAULT_SENAL,
  );
  for (let i = serie.length - 1; i >= 0; i--) {
    const p = serie[i];
    if (p) return p;
  }
  return null;
}

export const stochastic: IndicatorDef = {
  id: "stochastic",
  nombre: "Estocastico",
  tipo: "reversion",
  descripcionCorta:
    "Diferencia de maximos y minimos con la posicion actual. Oscilador 0-100: <20 sobreventa (compra), >80 sobrecompra (venta).",
  detalles: {
    queMide:
      "Donde esta el cierre dentro del rango de las ultimas 14 velas: pegado al minimo (cerca de 0) o al maximo (cerca de 100). Usa maximos y minimos, no solo cierres.",
    comoSenala:
      "Por debajo de 20 se interpreta como sobreventa y posible rebote al alza; por encima de 80, sobrecompra y posible caida. Se usa la version lenta: %K rapido, %K suavizada de 3 y %D suavizada de 3. La senal usa la %K lenta.",
    cuandoFalla:
      "Falla en tendencias fuertes, que es justo cuando la senal seria mas valiosa: en una subida sostenida el cierre se queda pegado al maximo de la ventana y marca sobrecompra una y otra vez mientras el precio sigue subiendo.",
    aviso:
      "Es un indicador de REVERSION. Mezclado con indicadores de TENDENCIA (MACD, Precio de cierre) las senales se oponen y el motor apenas operara.",
  },
  parametros: [
    { key: "periodo", label: "Periodo", value: DEFAULT_PERIODO, min: 5, max: 30, step: 1 },
    { key: "suavizado", label: "Suavizado %K", value: DEFAULT_SUAVIZADO, min: 1, max: 10, step: 1 },
    { key: "senal", label: "Suavizado %D", value: DEFAULT_SENAL, min: 1, max: 10, step: 1 },
    { key: "sobreventa", label: "Sobreventa", value: DEFAULT_SOBREVENTA, min: 5, max: 40, step: 1 },
    {
      key: "sobrecompra",
      label: "Sobrecompra",
      value: DEFAULT_SOBRECOMPRA,
      min: 60,
      max: 95,
      step: 1,
    },
  ],
  minSamples: DEFAULT_PERIODO + DEFAULT_SUAVIZADO + DEFAULT_SENAL - 2,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    if (series.highs.length === 0 || series.lows.length === 0) return null;
    const p = stochUltimo(series.highs, series.lows, series.closes, params);
    if (!p) return null;
    const sobreventa = params["sobreventa"] ?? DEFAULT_SOBREVENTA;
    const sobrecompra = params["sobrecompra"] ?? DEFAULT_SOBRECOMPRA;
    if (sobreventa >= sobrecompra) return null;
    if (p.kLenta < sobreventa) return "buy";
    if (p.kLenta > sobrecompra) return "sell";
    return null;
  },

  diagnose(series: PriceSeries, params: Record<string, number>) {
    if (series.highs.length === 0 || series.lows.length === 0) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: "El Estocastico necesita maximos y minimos, y esta serie no los trae.",
      };
    }
    const p = stochUltimo(series.highs, series.lows, series.closes, params);
    if (!p) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: "Faltan velas para cerrar el %K rapido, la %K lenta y la %D.",
      };
    }
    if (p.kLenta > 80 || p.kLenta < 20) {
      return {
        failure: "tendencia_fuerte" as const,
        detalle:
          "El cierre se mantiene pegado a un extremo del rango: en tendencia fuerte la senal suele ser prematura.",
      };
    }
    return {
      failure: "ninguno" as const,
      detalle: `%K lenta en ${p.kLenta.toFixed(1)}: zona intermedia.`,
    };
  },
};
