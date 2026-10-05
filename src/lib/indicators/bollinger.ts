/**
 * Bollinger Bands.
 *
 * "Calcula a partir de la desviación típica de una media móvil." Media de 20 con
 * bandas a ±2 desviaciones. Tocar la banda inferior sugiere compra por
 * reversión; la superior, venta.
 *
 * Desviación POBLACIONAL (divide entre N), que es la que usa TradingView y la
 * librería `ta`. Con una muestra seria la diferencia no se nota; con pocas velas
 * sí, y es la causa habitual de "las bandas no me cuadran".
 */

import { desviacionPoblacional, sma } from "./helpers";
import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_PERIODO = 20;
export const DEFAULT_DESVIACIONES = 2;

export type BollingerPoint = { media: number; superior: number; inferior: number };

/** Serie completa de Bollinger. Null mientras no haya periodo completo. */
export function bollingerSerie(
  cierres: number[],
  periodo = DEFAULT_PERIODO,
  desviaciones = DEFAULT_DESVIACIONES,
): (BollingerPoint | null)[] {
  const out: (BollingerPoint | null)[] = [];
  if (periodo < 2 || periodo > cierres.length) return new Array(cierres.length).fill(null);
  for (let i = periodo - 1; i < cierres.length; i++) {
    const ventana = cierres.slice(i - periodo + 1, i + 1);
    const m = sma(ventana, periodo);
    const d = desviacionPoblacional(ventana);
    if (m === null || d === null) continue;
    out[i] = { media: m, superior: m + desviaciones * d, inferior: m - desviaciones * d };
  }
  return out;
}

export function bollingerUltimo(
  cierres: number[],
  params: Record<string, number>,
): BollingerPoint | null {
  const serie = bollingerSerie(
    cierres,
    params["periodo"] ?? DEFAULT_PERIODO,
    params["desviaciones"] ?? DEFAULT_DESVIACIONES,
  );
  for (let i = serie.length - 1; i >= 0; i--) {
    const p = serie[i];
    if (p) return p;
  }
  return null;
}

export const bollinger: IndicatorDef = {
  id: "bollinger",
  nombre: "Bollinger Bands",
  tipo: "reversion",
  descripcionCorta:
    "Calcula a partir de la desviación típica de una media móvil. Media de 20 con bandas a ±2 desviaciones. Tocar la banda inferior sugiere compra por reversión; la superior, venta.",
  detalles: {
    queMide:
      "Cuánto se aparta el precio de su media, medido en desviaciones. Las bandas se estrechan cuando hay poca variabilidad y se abren cuando hay mucha.",
    comoSenala:
      "Si el cierre toca o perfora la banda inferior se interpreta como compra por reversión. Si toca la superior, venta. Por debajo de la media central no se genera ninguna señal.",
    cuandoFalla:
      "En una tendencia sostenida el precio se puede pegar a una banda y seguir en la misma dirección: la señal de reversión llega justo cuando el movimiento continúa. En mercados laterales las bandas se estrechan tanto que cualquier ruido las atraviesa.",
    aviso:
      "Es un indicador de REVERSIÓN. Mezclado con indicadores de TENDENCIA (MACD, Precio de cierre) las señales se oponen y el motor apenas operará.",
  },
  parametros: [
    { key: "periodo", label: "Periodo", value: DEFAULT_PERIODO, min: 10, max: 50, step: 1 },
    {
      key: "desviaciones",
      label: "Desviaciones",
      value: DEFAULT_DESVIACIONES,
      min: 1,
      max: 4,
      step: 0.5,
      help: "Cuántas desviaciones se puts cada banda respecto a la media. Menos de 2 estrecha las bandas.",
    },
  ],
  minSamples: DEFAULT_PERIODO,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    const p = bollingerUltimo(series.closes, params);
    const ultimo = series.closes[series.closes.length - 1];
    if (!p || ultimo === undefined) return null;
    // Desviacion 0 (precio plano): no hay bandas con sentido.
    if (p.superior === p.inferior) return null;
    if (ultimo <= p.inferior) return "buy";
    if (ultimo >= p.superior) return "sell";
    return null;
  },

  diagnose(series: PriceSeries, params: Record<string, number>) {
    const p = bollingerUltimo(series.closes, params);
    const periodo = params["periodo"] ?? DEFAULT_PERIODO;
    if (!p) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: `Hacen falta ${periodo} velas y hay ${series.closes.length}.`,
      };
    }
    const ancho = p.superior - p.inferior;
    if (ancho <= 0) {
      return {
        failure: "ninguno" as const,
        detalle:
          "Desviación cero: el precio lleva ${periodo} velas sin moverse. Las bandas no significan nada.",
      };
    }
    return {
      failure: "ninguno" as const,
      detalle: `Ancho de banda ${ancho.toFixed(4)}: volatilidad ${ancho <= 0 ? "baja" : "normal"}.`,
    };
  },
};
