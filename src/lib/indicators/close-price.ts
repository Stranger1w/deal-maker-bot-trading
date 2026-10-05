/**
 * Precio de cierre (indicador por defecto).
 *
 * "Indicador de seguimiento de tendencias de velas japonesas. Compara el cierre
 * de las ultimas N velas: compra con cierres consecutivos al alza, vende/sale con
 * cierres a la baja."
 *
 * Es el mas simple y el mas explicable: no necesita mas que los cierres, y su
 * senal es literalmente "los ultimos N cierres subieron o bajaron".
 */

import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_PERIODO = 3;

/** Serie de N cierres estrictamente crecientes (cada uno > el anterior). */
export function soloSube(cierres: number[], n: number): boolean {
  if (cierres.length < n) return false;
  const cola = cierres.slice(-n);
  for (let i = 1; i < cola.length; i++) {
    const previo = cola[i - 1];
    const actual = cola[i];
    if (previo === undefined || actual === undefined || actual <= previo) return false;
  }
  return true;
}

/** Serie de N cierres estrictamente decrecientes. */
export function soloBaja(cierres: number[], n: number): boolean {
  if (cierres.length < n) return false;
  const cola = cierres.slice(-n);
  for (let i = 1; i < cola.length; i++) {
    const previo = cola[i - 1];
    const actual = cola[i];
    if (previo === undefined || actual === undefined || actual >= previo) return false;
  }
  return true;
}

export const closePrice: IndicatorDef = {
  id: "close_price",
  nombre: "Precio de cierre",
  tipo: "tendencia",
  descripcionCorta:
    "Indicador de seguimiento de tendencias de velas japonesas. Compara el cierre de las ultimas N velas: compra con cierres consecutivos al alza, vende/sale con cierres a la baja.",
  detalles: {
    queMide:
      "Unicamente la direccion del cierre de las ultimas N velas. No mira volumen, ni maximos, ni minimos.",
    comoSenala: `Compra si los ultimos ${DEFAULT_PERIODO} cierres subieron todos respecto al anterior. Vende si los ${DEFAULT_PERIODO} bajaron todos. Cualquier otra situacion (velas mixtas) no genera senal: se mantiene la posicion.`,
    cuandoFalla:
      "Debil en mercados laterales: con precios que suben y bajan alternando nunca se cumple la condicion y se queda quieto todo el rato. Tambien falla tras un salto de precio, porque cuenta el salto como tendencia.",
  },
  parametros: [
    {
      key: "periodo",
      label: "Numero de velas",
      value: DEFAULT_PERIODO,
      min: 2,
      max: 10,
      step: 1,
      help: "Cuantos cierres seguidos deben moverse en el mismo sentido para dar senal.",
    },
  ],
  minSamples: DEFAULT_PERIODO,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    const n = params["periodo"] ?? DEFAULT_PERIODO;
    if (!Number.isFinite(n) || n < 2) return null;
    const c = series.closes;
    if (c.length < n) return null;
    if (soloSube(c, n)) return "buy";
    if (soloBaja(c, n)) return "sell";
    return null;
  },

  diagnose(series: PriceSeries, params: Record<string, number>) {
    const n = params["periodo"] ?? DEFAULT_PERIODO;
    const c = series.closes;
    if (c.length < n) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: `Hacen falta ${n} velas y hay ${c.length}.`,
      };
    }
    const cola = c.slice(-n);
    const rango = Math.max(...cola) - Math.min(...cola);
    const escala = mediaAbsoluta(cola);
    if (escala > 0 && rango / escala < 0.5) {
      return {
        failure: "rango_lateral" as const,
        detalle: `Los ultimos ${n} cierres se mueven en un rango estrecho: mercado lateral, la senal sera intermitente.`,
      };
    }
    if (rango / escala > 5) {
      return {
        failure: "ruido" as const,
        detalle:
          "El ultimo movimiento es muy grande comparado con los anteriores: puede ser un pico de volatilidad.",
      };
    }
    return { failure: "ninguno" as const, detalle: "Los cierres siguen una direccion clara." };
  },
};

/** Desviacion media absoluta respecto a la media, para escalar rangos. */
function mediaAbsoluta(serie: number[]): number {
  if (serie.length === 0) return 0;
  const m = serie.reduce((a, b) => a + b, 0) / serie.length;
  let acc = 0;
  for (const v of serie) acc += Math.abs(v - m);
  return acc / serie.length;
}
